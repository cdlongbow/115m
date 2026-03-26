import type { FileInfo } from './types'
import { sendRuntimeMessageSafe } from './runtime'

export function openPlayer(file: FileInfo) {
  const now = Date.now()
  const playerUrl = chrome.runtime.getURL('src/player/index.html')
  const traceId = `${file.pickCode}-${now}`
  const url = `${playerUrl}?pickCode=${encodeURIComponent(file.pickCode)}&title=${encodeURIComponent(file.fileName)}&traceId=${encodeURIComponent(traceId)}&clickTs=${now}`

  void sendRuntimeMessageSafe({
    type: 'PREFETCH_VIDEO_SOURCE',
    data: { pickCode: file.pickCode },
  })

  void sendRuntimeMessageSafe({
    type: 'OPEN_TAB',
    url,
  })
}
