export interface MainWorldTextResponse {
  ok: boolean
  text: string
  error?: string
}

const MATCH_115_PAGE_URLS = [
  '*://115.com/*',
  '*://*.115.com/*',
]

const MATCH_115_PLAYER_URLS = [
  '*://115.com/web/lixian/master/video/*',
  '*://*.115.com/web/lixian/master/video/*',
]

async function queryTabsByUrls(urls: string[]) {
  const groups = await Promise.all(urls.map(url => chrome.tabs.query({ url })))
  const seen = new Set<number>()

  return groups.flat().filter((tab) => {
    if (!tab.id || seen.has(tab.id)) {
      return false
    }
    seen.add(tab.id)
    return true
  })
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
    const tabs = await query115Tabs()
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
  return await queryTabsByUrls(MATCH_115_PAGE_URLS)
}

export async function queryPlayerTabs() {
  return await queryTabsByUrls(MATCH_115_PLAYER_URLS)
}
