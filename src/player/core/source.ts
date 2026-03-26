import { drive115 } from '../../lib'
import { crypto115 } from '../../lib/crypto'
import { PRO_API_URL } from '../../lib/constants'
import type { DownloadResult } from '../../lib/api/types'
import type { M3u8Item } from '../../lib/types'
import { sendRuntimeMessageSafe } from './runtime'

/**
 * 通过 BG executeScript 在主世界调用 Pro API
 * 确保 Origin: https://115.com
 */
async function fetchProViaMainWorld(pickCode: string): Promise<DownloadResult> {
  const tm = Math.floor(Date.now() / 1000).toString()
  const src = JSON.stringify({ pickcode: pickCode })
  const encoded = crypto115.m115_encode(src, tm)
  const body = `data=${encodeURIComponent(encoded.data)}`
  const url = `${PRO_API_URL}/app/chrome/downurl?t=${tm}`

  const res = await sendRuntimeMessageSafe<{ ok?: boolean, text?: string, error?: string }>({
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

/**
 * 获取无损播放源
 * 优先：Pro API 通过主世界 executeScript（正确 Origin）
 * 降级：Web API 直接 fetch
 */
export async function fetchUltraSource(pickCode: string): Promise<{ url: string, ultraUrl: string }> {
  let result: DownloadResult

  try {
    result = await fetchProViaMainWorld(pickCode)
    console.log('[115m] Pro 主世界获取成功')
  }
  catch (proError) {
    console.warn('[115m] Pro 主世界失败，降级 Web API:', proError)
    result = await drive115.webApiFilesDownload(pickCode)
  }

  const url = result.url?.url
  if (!url) throw new Error('未获取到 Ultra 下载地址')

  if (result.url?.auth_cookie) {
    await sendRuntimeMessageSafe({
      type: 'SET_COOKIE',
      data: {
        name: result.url.auth_cookie.name,
        value: result.url.auth_cookie.value,
        path: '/',
        domain: '.115cdn.net',
        secure: true,
        expirationDate: Number(result.url.auth_cookie.expire),
        sameSite: 'no_restriction',
      },
    })
  }

  return { url, ultraUrl: url }
}

/**
 * 获取 M3U8 列表（通过 BG 代理避免跨域）
 */
export async function fetchM3u8WithRetry(pickCode: string): Promise<M3u8Item[]> {
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
