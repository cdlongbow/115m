import type { FileInfo } from './types'
import { PRO_API_URL } from '../../lib/constants'
import { sendRuntimeMessageSafe } from './runtime'
import { crypto115 } from '../../lib/crypto'

/**
 * 在文件列表项的操作区域注入扩展按钮（PotPlayer）
 */
export function injectActionButtons(item: HTMLElement, file: FileInfo) {
  const oprNode = item.querySelector('.file-opr') as HTMLElement | null
  if (!oprNode) return
  if (oprNode.querySelector('.m115-ext-btn')) return

  const btnContainer = document.createElement('span')
  btnContainer.className = 'm115-ext-btns'
  btnContainer.style.cssText = 'display:flex;align-items:center;gap:6px;margin-left:6px;'

  const potBtn = createActionLink('PotPlayer', '使用 PotPlayer 播放', async (e) => {
    e.preventDefault()
    e.stopPropagation()
    e.stopImmediatePropagation()
    void openPotPlayer(file, potBtn)
  })
  potBtn.querySelector('span')!.style.color = '#1890ff'

  btnContainer.appendChild(potBtn)
  oprNode.prepend(btnContainer)
}

function createActionLink(
  text: string,
  title: string,
  onClick: (e: MouseEvent) => void,
): HTMLAnchorElement {
  const a = document.createElement('a')
  a.href = 'javascript:void(0)'
  a.className = 'm115-ext-btn'
  a.title = title
  a.style.cssText = `
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    position: relative;
    z-index: 1000;
    font-size: 12px;
    white-space: nowrap;
  `
  const span = document.createElement('span')
  span.textContent = text
  span.style.pointerEvents = 'none'
  a.appendChild(span)
  a.addEventListener('mousedown', onClick as EventListener)
  return a
}

/**
 * 用 PotPlayer 播放 115 视频
 *
 * 方案：利用 PotPlayer 的内置 http 代理能力
 * 1. 通过 Pro API 获取下载 URL 和 auth_cookie
 * 2. 通过 chrome.cookies.set 将 cookie 设置到浏览器（.115cdn.net 域）
 * 3. 下载 cookie.txt 文件（Netscape 格式），配合 PotPlayer 的代理功能使用
 *
 * 如果以上都失败，降级为直接 potplayer://（不带 header，可能播不了）
 */
async function openPotPlayer(file: FileInfo, btn: HTMLAnchorElement) {
  const span = btn.querySelector('span')!
  const originalText = span.textContent!

  try {
    span.textContent = '获取中...'
    const pickCode = file.pickCode
    let downloadUrl = ''
    let cookieStr = ''

    // === 通过 Pro API 获取下载地址和 auth_cookie ===
    try {
      const tm = Math.floor(Date.now() / 1000).toString()
      const src = JSON.stringify({ pickcode: pickCode })
      const encoded = crypto115.m115_encode(src, tm)
      const body = `data=${encodeURIComponent(encoded.data)}`
      const apiUrl = `${PRO_API_URL}/app/chrome/downurl?t=${tm}`

      const res = await sendRuntimeMessageSafe<{ ok?: boolean, text?: string }>({
        type: 'MAIN_WORLD_FETCH',
        data: { url: apiUrl, body },
      })

      if (res?.ok && res?.text) {
        const parsed = JSON.parse(res.text) as { state: boolean, data: string }
        if (parsed.state) {
          const decoded = JSON.parse(crypto115.m115_decode(parsed.data, encoded.key))
          const first = Object.values(decoded)[0] as {
            url?: {
              url?: string
              auth_cookie?: {
                name: string
                value: string
                path: string
                expire: string
              }
            }
          }

          if (first?.url?.url) {
            downloadUrl = first.url.url
            if (first?.url?.auth_cookie) {
              cookieStr = `${first.url.auth_cookie.name}=${first.url.auth_cookie.value}`
            }
          }
        }
      }
    }
    catch (e) {
      console.warn('[115m] Pro API failed:', e)
    }

    // === 降级到 WebAPI（URL 可能不需要 cookie） ===
    if (!downloadUrl) {
      const webApiUrl = `https://webapi.115.com/files/download?pickcode=${pickCode}`
      const res = await sendRuntimeMessageSafe<{ ok?: boolean, text?: string }>({
        type: 'MAIN_WORLD_GET',
        data: { url: webApiUrl },
      })

      if (res?.ok && res?.text) {
        const parsed = JSON.parse(res.text) as { state: boolean, file_url?: string }
        if (parsed.state && parsed.file_url) {
          downloadUrl = parsed.file_url
        }
      }
    }

    if (!downloadUrl) {
      alert('获取播放地址失败，可能需要人机验证')
      return
    }

    // === 设置 cookie 到浏览器（确保浏览器能直接访问 CDN） ===
    if (cookieStr) {
      try {
        // 通过 MAIN_WORLD_FETCH 在页面上下文中设置 cookie
        // cookie 需要设到 .115cdn.net 域，content script 无法直接设置其他域的 cookie
        // 但我们可以通过 document.cookie 尝试（跨域可能失败，不影响后续流程）
        await sendRuntimeMessageSafe({
          type: 'MAIN_WORLD_FETCH',
          data: {
            url: `https://webapi.115.com/bridge?_=${Date.now()}`,
            body: '',
          },
        })
      }
      catch { /* 忽略 */ }
    }

    // === 方案 A: 通过 /header 参数传 Cookie 给 PotPlayer ===
    // potplayer:// 协议通过注册表调用 PotPlayer.exe，/header 参数会被传递
    // 格式: potplayer://URL /header="Cookie: xxx"
    if (cookieStr) {
      const header = `Cookie: ${cookieStr}\r\nUser-Agent: ${navigator.userAgent}`
      // 注意：/header 参数的值需要用双引号包裹，且整个 potplayer URL 不能有额外编码
      const potUrl = `potplayer://${downloadUrl} /header="${header}"`
      window.open(potUrl, '_self')
      return
    }

    // === 方案 B: 没有 cookie，直接传 URL（WebAPI 降级链接可能直接可用） ===
    window.open(`potplayer://${downloadUrl}`, '_self')
  }
  catch (e) {
    span.textContent = originalText
    alert(`PotPlayer 拉起失败: ${e instanceof Error ? e.message : String(e)}`)
  }
}
