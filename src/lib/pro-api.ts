import { drive115 } from './drive115'
import { crypto115 } from './crypto'
import { PRO_API_URL } from './constants'
import type { DownloadResult } from './api/types'

type RuntimeSender = <T = unknown>(message: unknown) => Promise<T | null>

export async function fetchProDownloadResult(
  sendMessage: RuntimeSender,
  pickCode: string,
): Promise<DownloadResult> {
  const tm = Math.floor(Date.now() / 1000).toString()
  const src = JSON.stringify({ pickcode: pickCode })
  const encoded = crypto115.m115_encode(src, tm)
  const body = `data=${encodeURIComponent(encoded.data)}`
  const url = `${PRO_API_URL}/app/chrome/downurl?t=${tm}`

  const res = await sendMessage<{ ok?: boolean, text?: string, error?: string }>({
    type: 'MAIN_WORLD_FETCH',
    data: { url, body },
  })

  if (!res?.ok || !res.text) {
    throw new Error(res?.error || 'main world fetch failed')
  }

  const parsed = JSON.parse(res.text) as { state: boolean, data: string }
  if (!parsed.state) {
    throw new Error(`Pro API state=false: ${res.text}`)
  }

  const decoded = JSON.parse(crypto115.m115_decode(parsed.data, encoded.key))
  const first = Object.values(decoded)[0] as DownloadResult
  if (!first?.url?.url) throw new Error('empty downurl result')
  return first
}

export async function fetchBestDownloadResult(
  sendMessage: RuntimeSender,
  pickCode: string,
): Promise<DownloadResult> {
  try {
    return await fetchProDownloadResult(sendMessage, pickCode)
  }
  catch (error) {
    console.warn('[115m] Pro API failed, fallback to Web API:', error)
    return await drive115.webApiFilesDownload(pickCode)
  }
}
