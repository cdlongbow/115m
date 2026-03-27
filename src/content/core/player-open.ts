import type { FileInfo } from './types'
import { NORMAL_URL } from '../../lib/constants'
import { sendRuntimeMessageSafe } from './runtime'

export async function openPlayer(file: FileInfo) {
  const now = Date.now()
  const traceId = `${file.pickCode}-${now}`

  const params = new URLSearchParams({
    pick_code: file.pickCode,
    pickCode: file.pickCode,
    title: file.fileName,
    traceId,
    clickTs: String(now),
  })

  if (file.fileId) params.set('fileId', file.fileId)
  if (file.parentId) params.set('cid', file.parentId)
  if (file.fileSize) params.set('fileSize', file.fileSize)
  if (typeof file.isMarked === 'boolean') params.set('marked', file.isMarked ? '1' : '0')

  const url = `${NORMAL_URL}/web/lixian/master/video/?${params.toString()}`

  await sendRuntimeMessageSafe({
    type: 'OPEN_TAB',
    url,
  })
}
