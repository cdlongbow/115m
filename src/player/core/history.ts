import { sendRuntimeMessageSafe } from './runtime'

/**
 * 画质偏好记录
 */
export interface QualityPreference {
  label: string
  quality: number
}

const QUALITY_PREF_STORAGE_KEY = '115m-quality-preferences'

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
    const response = await sendRuntimeMessageSafe<{ currentTime: number } | null>({
      type: 'GET_HISTORY',
      data: { pickCode },
    })

    if (response && response.currentTime) {
      setTimeout(() => onRestore(response.currentTime), 500)
    }
  }
  catch {
    // ignore history errors
  }
}

export function savePlayHistory(params: {
  pickCode: string
  fileName: string
  currentTime: number
  duration: number
  quality: string
}) {
  const { pickCode, fileName, currentTime, duration, quality } = params
  if (!duration || currentTime < 5) return

  const lastSaveTime = Number.parseInt(sessionStorage.getItem('lastSaveTime') || '0', 10)
  const now = Date.now()
  if (now - lastSaveTime < 10000) return
  sessionStorage.setItem('lastSaveTime', now.toString())

  void sendRuntimeMessageSafe({
    type: 'SET_HISTORY',
    data: {
      pickCode,
      fileName,
      currentTime,
      duration,
      quality,
    },
  })
}
