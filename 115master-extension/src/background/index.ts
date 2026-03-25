/**
 * Background Service Worker
 */

// 安装时初始化
chrome.runtime.onInstalled.addListener((details) => {
  console.log('[115Master] Extension installed', details.reason)
})

// 监听来自 content script 和 player 页面的消息
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleMessage(message).then(sendResponse).catch((err) => {
    console.error('[115Master] BG error:', err)
    sendResponse({ error: err.message })
  })
  return true // 保持 sendResponse 有效
})

interface MsgSetCookie {
  type: 'SET_COOKIE'
  data: {
    name: string
    value: string
    path: string
    domain: string
    secure: boolean
    expirationDate: number
    sameSite: string
  }
}

interface MsgDownload {
  type: 'DOWNLOAD'
  data: {
    url: string
    filename: string
  }
}

interface MsgGetHistory {
  type: 'GET_HISTORY'
  data: { pickCode: string }
}

interface MsgSetHistory {
  type: 'SET_HISTORY'
  data: {
    pickCode: string
    fileName: string
    currentTime: number
    duration: number
    quality: string
  }
}

type Message = MsgSetCookie | MsgDownload | MsgGetHistory | MsgSetHistory

async function handleMessage(message: Message): Promise<any> {
  switch (message.type) {
    case 'SET_COOKIE': {
      const { data } = message
      await chrome.cookies.set({
        url: 'https://dl.115cdn.net',
        name: data.name,
        value: data.value,
        path: data.path,
        domain: data.domain,
        secure: data.secure,
        expirationDate: data.expirationDate,
        sameSite: data.sameSite as chrome.cookies.SameSiteStatus,
      })
      return { success: true }
    }

    case 'DOWNLOAD': {
      const { url, filename } = message.data
      chrome.downloads.download({
        url,
        filename: filename || undefined,
        saveAs: true,
      })
      return { success: true }
    }

    case 'GET_HISTORY': {
      const result = await chrome.storage.local.get('data')
      if (result.data) {
        try {
          const parsed = JSON.parse(result.data)
          return parsed.playHistory?.[message.data.pickCode] ?? null
        }
        catch { return null }
      }
      return null
    }

    case 'SET_HISTORY': {
      const { pickCode, fileName, currentTime, duration, quality } = message.data
      const result = await chrome.storage.local.get('data')
      let data: any = {}
      try {
        data = result.data ? JSON.parse(result.data) : {}
      }
      catch { data = {} }

      if (!data.playHistory) data.playHistory = {}
      data.playHistory[pickCode] = {
        pickCode,
        fileName,
        currentTime,
        duration,
        quality,
        updatedAt: Date.now(),
      }

      // 保留最近 200 条
      const entries = Object.entries(data.playHistory)
      if (entries.length > 200) {
        entries.sort((a: any, b: any) => b[1].updatedAt - a[1].updatedAt)
        data.playHistory = Object.fromEntries(entries.slice(0, 200))
      }

      await chrome.storage.local.set({ data: JSON.stringify(data) })
      return { success: true }
    }

    default:
      return { error: 'Unknown message type' }
  }
}
