import { drive115 } from '../../lib'
import type { M3u8Item } from '../../lib/types'
import { sendRuntimeMessageSafe } from './runtime'
import type { PrefetchM3u8Response, PrefetchVideoSourceResponse } from '../../shared/messages'

export async function fetchUltraSource(pickCode: string): Promise<{ url: string, ultraUrl: string }> {
  const prefetched = await sendRuntimeMessageSafe<PrefetchVideoSourceResponse | null>({
    type: 'GET_PREFETCH_VIDEO_SOURCE',
    data: { pickCode },
  }).catch(() => null)

  if (prefetched?.url) {
    return { url: prefetched.url, ultraUrl: prefetched.url }
  }

  const downloadResult = await drive115.getFileDownloadUrl(pickCode)
  const url = downloadResult.url?.url
  const authCookie = downloadResult.url?.auth_cookie
  if (!url) throw new Error('未获取到 Ultra 下载地址')

  if (authCookie) {
    await drive115.setDownloadCookie(authCookie)
  }
  return { url, ultraUrl: url }
}

export async function fetchM3u8WithRetry(pickCode: string): Promise<M3u8Item[]> {
  const prefetched = await sendRuntimeMessageSafe<PrefetchM3u8Response | null>({
    type: 'GET_PREFETCH_M3U8',
    data: { pickCode },
  }).catch(() => null)

  if (prefetched?.list?.length) {
    return prefetched.list
  }

  let lastError: unknown
  for (let i = 0; i < 2; i++) {
    try {
      const res = await sendRuntimeMessageSafe<{ list?: M3u8Item[], error?: string }>({
        type: 'FETCH_M3U8',
        data: { pickCode },
      })
      if (res?.list && res.list[0]) {
        return res.list
      }
      if (res?.error) {
        throw new Error(res.error)
      }
    }
    catch (error) {
      lastError = error
    }
    await new Promise(resolve => setTimeout(resolve, 250 * (i + 1)))
  }
  throw lastError ?? new Error('M3U8 empty')
}
