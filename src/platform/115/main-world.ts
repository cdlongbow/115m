export interface MainWorldTextResponse {
  ok: boolean
  text: string
  error?: string
}

interface RunIn115MainWorldOptions<TArgs extends unknown[], TResult> {
  sender?: chrome.runtime.MessageSender
  tabId?: number
  args: TArgs
  func: (...args: TArgs) => Promise<TResult> | TResult
}

export async function find115TabId(sender?: chrome.runtime.MessageSender): Promise<number | undefined> {
  let tabId = sender?.tab?.id
  if (!tabId) {
    const tabs = await chrome.tabs.query({ url: '*://*.115.com/*' })
    tabId = tabs[0]?.id
  }
  return tabId
}

export async function runIn115MainWorld<TArgs extends unknown[], TResult>(
  options: RunIn115MainWorldOptions<TArgs, TResult>,
): Promise<TResult | undefined> {
  const tabId = options.tabId ?? await find115TabId(options.sender)
  if (!tabId) {
    return undefined
  }

  const injected = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: options.func,
    args: options.args,
  })

  return injected?.[0]?.result as TResult | undefined
}

export async function fetchTextIn115MainWorld(
  sender: chrome.runtime.MessageSender | undefined,
  url: string,
  body?: string,
): Promise<MainWorldTextResponse> {
  const safeBody = body ?? ''

  try {
    const result = await runIn115MainWorld({
      sender,
      args: [url, safeBody],
      func: async (fetchUrl: string, fetchBody: string) => {
        try {
          const isPost = fetchBody.length > 0
          const options: RequestInit = {
            method: isPost ? 'POST' : 'GET',
            credentials: 'include',
          }
          if (isPost) {
            options.headers = { 'Content-Type': 'application/x-www-form-urlencoded' }
            options.body = fetchBody
          }

          const res = await fetch(fetchUrl, options)
          const text = await res.text()
          return { ok: res.ok, text, status: res.status }
        }
        catch (error) {
          return { ok: false, text: '', status: 0, error: String(error) }
        }
      },
    })

    if (!result) {
      return { ok: false, text: '', error: 'no 115.com tab found' }
    }

    return result as MainWorldTextResponse
  }
  catch (error) {
    return { ok: false, text: '', error: String(error) }
  }
}

export async function query115Tabs() {
  return await chrome.tabs.query({ url: '*://*.115.com/*' })
}

export async function queryPlayerTabs() {
  return await chrome.tabs.query({ url: '*://*.115.com/web/lixian/master/video/*' })
}
