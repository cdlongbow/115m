import { sendRuntimeMessageSafe } from './runtime'

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
