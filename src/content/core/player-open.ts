import type { FileInfo } from './types'
import { NORMAL_URL } from '../../lib/constants'
import { sendRuntimeMessageSafe } from './runtime'

export function openPlayer(file: FileInfo) {
  const now = Date.now()
  const traceId = `${file.pickCode}-${now}`
  const url = `${NORMAL_URL}/web/lixian/master/video/?pick_code=${encodeURIComponent(file.pickCode)}&pickCode=${encodeURIComponent(file.pickCode)}&title=${encodeURIComponent(file.fileName)}&traceId=${encodeURIComponent(traceId)}&clickTs=${now}`

  void sendRuntimeMessageSafe({
    type: 'OPEN_TAB',
    url,
  })
}
