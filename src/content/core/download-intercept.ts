import type { FileInfo } from './types'
import { sendRuntimeMessageSafe } from './runtime'
import { crypto115 } from '../../lib/crypto'
import { PRO_API_URL } from '../../lib/constants'
import type { DownloadResult } from '../../lib/api/types'
import { drive115 } from '../../lib/drive115'

/**
 * 通过 BG 主世界调用 Pro API 获取下载直链（无文件大小限制）
 */
async function fetchDownloadUrl(pickCode: string): Promise<DownloadResult> {
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
 * 获取文件下载地址（Pro API 优先，Web API 降级）
 */
async function getFileDownloadUrl(pickCode: string): Promise<DownloadResult> {
  try {
    return await fetchDownloadUrl(pickCode)
  } catch (proError) {
    console.warn('[115m] Pro API 下载链接获取失败，降级 Web API:', proError)
    return await drive115.webApiFilesDownload(pickCode)
  }
}

/**
 * 拦截列表中原生下载按钮，替换为扩展下载（可被 IDM/aria2 等下载器自动接管）
 */
export function addDownloadIntercept(item: HTMLElement, file: FileInfo) {
  const downloadNode = item.querySelector('.file-opr a[menu="download_one"]') as HTMLElement | null
  if (!downloadNode) return

  downloadNode.addEventListener('click', async (e) => {
    e.preventDefault()
    e.stopPropagation()
    e.stopImmediatePropagation()

    try {
      downloadNode.style.opacity = '0.5'

      const res = await getFileDownloadUrl(file.pickCode)

      if (res.url?.url) {
        // 前台打开直链，IDM/aria2 等下载器可正常拦截
        window.open(res.url.url, '_blank')
        console.log('[115m] 下载直链已打开，等待下载器接管')
      } else {
        throw new Error('未获取到真实下载地址')
      }
    } catch (error) {
      console.error('[115m] 解析下载直链失败:', error)
      alert('解析下载直链失败: ' + (error instanceof Error ? error.message : String(error)))
    } finally {
      downloadNode.style.opacity = '1'
    }
  }, true)
}
