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
  watchEnd?: boolean
}

interface PendingPlayHistoryWrite {
  params: {
    pickCode: string
    fileName: string
    currentTime: number
    duration: number
    quality: string
  }
  timer: number | null
}

const pendingPlayHistoryWrites = new Map<string, PendingPlayHistoryWrite>()
const lastPlayHistoryWriteAt = new Map<string, number>()

export interface PlayHistoryMap {
  [pickCode: string]: PlayHistoryRecord | undefined
}

export interface PlaylistProgressSnapshot {
  progressSec: number
  progressPercent: number
}

const QUALITY_PREF_STORAGE_KEY = '115m-quality-preferences'
const VIDEO_ROTATION_STORAGE_KEY = '115m-video-rotations'
const PLAY_HISTORY_COMPLETED_REMAINING_SEC = 15
const PLAY_HISTORY_COMPLETED_RATIO = 0.98
const PLAY_HISTORY_WRITE_DEBOUNCE_MS = 3000
const PLAY_HISTORY_MIN_WRITE_INTERVAL_MS = 15000
const NATIVE_PLAY_HISTORY_ENABLED = true
const LOCAL_PLAY_HISTORY_ENABLED = false

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

function readVideoRotationMap(): Record<string, number> {
  try {
    const raw = localStorage.getItem(VIDEO_ROTATION_STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, number>
    return parsed && typeof parsed === 'object' ? parsed : {}
  }
  catch {
    return {}
  }
}

function writeVideoRotationMap(map: Record<string, number>) {
  try {
    localStorage.setItem(VIDEO_ROTATION_STORAGE_KEY, JSON.stringify(map))
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

export function loadVideoRotation(pickCode: string): number {
  if (!pickCode) return 0
  const rotations = readVideoRotationMap()
  const value = rotations[pickCode]
  return typeof value === 'number' ? value : 0
}

export function saveVideoRotation(pickCode: string, rotation: number) {
  if (!pickCode) return
  const rotations = readVideoRotationMap()
  rotations[pickCode] = rotation
  writeVideoRotationMap(rotations)
}

export async function loadPlayHistory(pickCode: string, onRestore: (time: number) => void) {
  try {
    const response = await loadNativePlayHistory(pickCode)

    if (response && shouldRestorePlayHistory(response.currentTime, response.duration, response.watchEnd)) {
      setTimeout(() => onRestore(response.currentTime), 500)
    }
  }
  catch {
    // ignore history errors
  }
}

export async function loadPlayHistoryMap(): Promise<PlayHistoryMap> {
  if (!LOCAL_PLAY_HISTORY_ENABLED) return {}

  try {
    return await sendRuntimeMessageSafe<PlayHistoryMap>({
      type: 'GET_HISTORY_MAP',
    }) ?? {}
  }
  catch {
    return {}
  }
}

export async function loadNativePlayHistory(pickCode: string): Promise<PlayHistoryRecord | null> {
  if (!NATIVE_PLAY_HISTORY_ENABLED || !pickCode) return null

  const response = await sendRuntimeMessageSafe<PlayHistoryRecord | null>({
    type: 'GET_NATIVE_HISTORY',
    data: { pickCode, shareId: '0' },
  })
  if (!response?.currentTime || response.currentTime <= 0 || response.watchEnd) return null

  return response
}

export async function loadNativePlayHistoryMap(pickCodes: string[]): Promise<PlayHistoryMap> {
  if (!NATIVE_PLAY_HISTORY_ENABLED || pickCodes.length === 0) return {}

  try {
    const nativeMap = await sendRuntimeMessageSafe<Record<string, PlayHistoryRecord>>({
      type: 'GET_NATIVE_HISTORY_MAP',
      data: { pickCodes, shareId: '0' },
    })
    return nativeMap ?? {}
  }
  catch {
    return {}
  }
}

export async function deletePlayHistory(pickCode: string): Promise<void> {
  if (!pickCode) return
  try {
    await sendRuntimeMessageSafe({
      type: 'DELETE_HISTORY',
      data: { pickCode },
    })
  }
  catch {
    // ignore delete errors
  }
}

export function shouldRestorePlayHistory(currentTime: number, duration?: number, watchEnd = false): boolean {
  if (watchEnd) return false
  if (!currentTime || currentTime <= 0) return false
  if (!duration || duration <= 0) return true

  return !isCompletedPlayback(currentTime, duration)
}

export function isCompletedPlayback(currentTime: number, duration: number): boolean {
  if (!duration || duration <= 0) return false
  const remaining = Math.max(0, duration - currentTime)
  return remaining <= PLAY_HISTORY_COMPLETED_REMAINING_SEC || currentTime / duration >= PLAY_HISTORY_COMPLETED_RATIO
}

export function buildPlaylistProgressSnapshot(history?: PlayHistoryRecord): PlaylistProgressSnapshot | null {
  if (!history?.currentTime || !history.duration || history.duration <= 0) {
    return null
  }

  if (!shouldRestorePlayHistory(history.currentTime, history.duration)) {
    return null
  }

  const progressPercent = Math.max(0, Math.min(100, (history.currentTime / history.duration) * 100))
  if (progressPercent <= 0) {
    return null
  }

  return {
    progressSec: history.currentTime,
    progressPercent,
  }
}

function clearPendingPlayHistoryWrite(pickCode: string) {
  const pending = pendingPlayHistoryWrites.get(pickCode)
  if (pending?.timer) {
    window.clearTimeout(pending.timer)
  }
  pendingPlayHistoryWrites.delete(pickCode)
}

async function flushPlayHistoryWrite(pickCode: string) {
  const pending = pendingPlayHistoryWrites.get(pickCode)
  if (!pending) return

  pendingPlayHistoryWrites.delete(pickCode)
  lastPlayHistoryWriteAt.set(pickCode, Date.now())
  await persistPlayHistory(pending.params)
}

function schedulePlayHistoryWrite(params: {
  pickCode: string
  fileName: string
  currentTime: number
  duration: number
  quality: string
}) {
  const now = Date.now()
  const lastWriteAt = lastPlayHistoryWriteAt.get(params.pickCode) || 0
  const delay = Math.max(PLAY_HISTORY_WRITE_DEBOUNCE_MS, PLAY_HISTORY_MIN_WRITE_INTERVAL_MS - (now - lastWriteAt))
  const previous = pendingPlayHistoryWrites.get(params.pickCode)

  if (previous?.timer) {
    window.clearTimeout(previous.timer)
  }

  pendingPlayHistoryWrites.set(params.pickCode, {
    params,
    timer: window.setTimeout(() => {
      void flushPlayHistoryWrite(params.pickCode)
    }, delay),
  })
}

async function persistPlayHistory(params: {
  pickCode: string
  fileName: string
  currentTime: number
  duration: number
  quality: string
}) {
  await sendRuntimeMessageSafe({
    type: 'SET_NATIVE_HISTORY',
    data: {
      pickCode: params.pickCode,
      currentTime: params.currentTime,
      definition: params.quality === '无损' ? 1 : 0,
      shareId: '0',
    },
  })

  if (!LOCAL_PLAY_HISTORY_ENABLED) return

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

  clearPendingPlayHistoryWrite(pickCode)
  lastPlayHistoryWriteAt.set(pickCode, Date.now())
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
  if (!pickCode || !duration) return
  if (isCompletedPlayback(currentTime, duration)) {
    resetPlayHistory({ pickCode, fileName, duration, quality })
    return
  }
  if (currentTime < 5) return

  schedulePlayHistoryWrite({ pickCode, fileName, currentTime, duration, quality })
}
