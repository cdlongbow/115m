import type { FileInfo } from './types'
import { sendRuntimeMessageSafe } from './runtime'
import { fetchBestDownloadResult } from '../../lib/pro-api'

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

        const res = await fetchBestDownloadResult(sendRuntimeMessageSafe, file.pickCode)

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
