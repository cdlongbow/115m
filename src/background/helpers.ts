/**
 * 在 115.com 页面的主世界中执行 fetch 请求
 * 统一处理 tab 查找、executeScript 注入和错误处理
 */

/**
 * 查找可用的 115.com 标签页 ID
 */
export async function find115TabId(sender?: chrome.runtime.MessageSender): Promise<number | undefined> {
  let tabId = sender?.tab?.id
  if (!tabId) {
    const tabs = await chrome.tabs.query({ url: '*://*.115.com/*' })
    tabId = tabs[0]?.id
  }
  return tabId
}

/**
 * 在 115.com 页面的主世界中执行 fetch 请求
 * @param body - 有值时发 POST，否则发 GET
 */
export async function executeInMainWorld(
  sender: chrome.runtime.MessageSender | undefined,
  url: string,
  body?: string,
): Promise<{ ok: boolean, text: string, error?: string }> {
  const tabId = await find115TabId(sender)
  if (!tabId) {
    return { ok: false, text: '', error: 'no 115.com tab found' }
  }

  try {
    const injected = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: async (fetchUrl: string, fetchBody: string | undefined) => {
        try {
          const options: RequestInit = {
            method: fetchBody !== undefined ? 'POST' : 'GET',
            credentials: 'include',
          }
          if (fetchBody !== undefined) {
            options.headers = { 'Content-Type': 'application/x-www-form-urlencoded' }
            options.body = fetchBody
          }
          const res = await fetch(fetchUrl, options)
          const text = await res.text()
          return { ok: res.ok, status: res.status, text }
        }
        catch (error) {
          return { ok: false, status: 0, text: '', error: String(error) }
        }
      },
      args: [url, body],
    })

    const result = injected?.[0]?.result as { ok: boolean, text: string, error?: string } | undefined
    if (!result) {
      return { ok: false, text: '', error: 'executeScript returned empty' }
    }
    return result
  }
  catch (error) {
    return { ok: false, text: '', error: String(error) }
  }
}
