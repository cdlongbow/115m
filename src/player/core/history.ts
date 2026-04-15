import { sendRuntimeMessageSafe } from './runtime'

/**
 * 画质偏好记录
 */
export interface QualityPreference {
  label: string
  quality: number
}

interface PlayHistoryRecord {
  currentTime: number
  duration?: number
}

export interface PlayHistoryMap {
  [pickCode: string]: PlayHistoryRecord | undefined
}

const QUALITY_PREF_STORAGE_KEY = '115m-quality-preferences'
const PLAY_HISTORY_COMPLETED_REMAINING_SEC = 15
const PLAY_HISTORY_COMPLETED_RATIO = 0.98

function readQualityPreferenceMap(): Record<string, QualityPreference> {
  try {
    const raw = localStorage.getItem(QUALITY_PREF_STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, QualityPreference>
    return parsed && typeof parsed === 'object' ? parsed : {}
  }
  catch {
    return {}
  }
}

function writeQualityPreferenceMap(map: Record<string, QualityPreference>) {
  try {
    localStorage.setItem(QUALITY_PREF_STORAGE_KEY, JSON.stringify(map))
  }
  catch {
    // ignore storage errors
  }
}

/**
 * 保存用户手动选择的画质偏好（仅手动切换时调用）
 */
export function saveQualityPreference(pickCode: string, label: string, quality: number) {
  if (!pickCode) return
  const prefs = readQualityPreferenceMap()
  prefs[pickCode] = { label, quality }
  writeQualityPreferenceMap(prefs)
  console.log('[115m] saveQualityPreference saved:', pickCode, label, quality)
}

/**
 * 加载用户之前为该视频选择的画质偏好
 * 返回 null 表示用户从未手动选择过（使用默认无损）
 */
export async function loadQualityPreference(pickCode: string): Promise<QualityPreference | null> {
  if (!pickCode) return null
  const prefs = readQualityPreferenceMap()
  console.log('[115m] loadQualityPreference all prefs:', JSON.stringify(prefs))
  return prefs[pickCode] ?? null
}

export async function loadPlayHistory(pickCode: string, onRestore: (time: number) => void) {
  try {
    const response = await sendRuntimeMessageSafe<PlayHistoryRecord | null>({
      type: 'GET_HISTORY',
      data: { pickCode },
    })

    if (response && shouldRestorePlayHistory(response.currentTime, response.duration)) {
      setTimeout(() => onRestore(response.currentTime), 500)
    }
  }
  catch {
    // ignore history errors
  }
}

export async function loadPlayHistoryMap(): Promise<PlayHistoryMap> {
  try {
    return await sendRuntimeMessageSafe<PlayHistoryMap>({
      type: 'GET_HISTORY_MAP',
    }) ?? {}
  }
  catch {
    return {}
  }
}

export function shouldRestorePlayHistory(currentTime: number, duration?: number): boolean {
  if (!currentTime || currentTime <= 0) return false
  if (!duration || duration <= 0) return true

  return !isCompletedPlayback(currentTime, duration)
}

export function isCompletedPlayback(currentTime: number, duration: number): boolean {
  if (!duration || duration <= 0) return false
  const remaining = Math.max(0, duration - currentTime)
  return remaining <= PLAY_HISTORY_COMPLETED_REMAINING_SEC || currentTime / duration >= PLAY_HISTORY_COMPLETED_RATIO
}

async function persistPlayHistory(params: {
  pickCode: string
  fileName: string
  currentTime: number
  duration: number
  quality: string
}) {
  await sendRuntimeMessageSafe({
    type: 'SET_HISTORY',
    data: params,
  })
}

export function resetPlayHistory(params: {
  pickCode: string
  fileName: string
  duration: number
  quality: string
}) {
  const { pickCode, fileName, duration, quality } = params
  if (!pickCode) return

  sessionStorage.removeItem('lastSaveTime')
  void persistPlayHistory({
    pickCode,
    fileName,
    currentTime: 0,
    duration,
    quality,
  })
}

export function savePlayHistory(params: {
  pickCode: string
  fileName: string
  currentTime: number
  duration: number
  quality: string
}) {
  const { pickCode, fileName, currentTime, duration, quality } = params
  if (!duration) return
  if (isCompletedPlayback(currentTime, duration)) {
    resetPlayHistory({ pickCode, fileName, duration, quality })
    return
  }
  if (currentTime < 5) return

  const lastSaveTime = Number.parseInt(sessionStorage.getItem('lastSaveTime') || '0', 10)
  const now = Date.now()
  if (now - lastSaveTime < 10000) return
  sessionStorage.setItem('lastSaveTime', now.toString())

  void persistPlayHistory({ pickCode, fileName, currentTime, duration, quality })
}
