/**
 * Background Service Worker
 * 精简版：仅保留必要的消息代理功能
 */

import { drive115 } from '../lib'
import type { RuntimeMessage } from '../shared/messages'

// 安装时初始化
chrome.runtime.onInstalled.addListener((details) => {
  console.log('[115m] Extension installed', details.reason)
})

// 监听来自 content script 和 player 页面的消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender).then(sendResponse).catch((err) => {
    console.error('[115m] BG error:', err)
    sendResponse({ error: err.message })
  })
  return true // 保持 sendResponse 有效
})

let lastOpenTabMeta: { url: string, ts: number } | null = null

async function handleMessage(message: RuntimeMessage, sender?: chrome.runtime.MessageSender): Promise<any> {
  switch (message.type) {
    case 'MAIN_WORLD_FETCH': {
      // 通过 executeScript 在页面主世界执行 fetch
      // 确保 Origin: https://115.com，和原项目一致
      let tabId = sender?.tab?.id
      if (!tabId) {
        // 没有 sender tab，找一个 115.com 的 tab
        const tabs = await chrome.tabs.query({ url: '*://*.115.com/*' })
        tabId = tabs[0]?.id
      }
      if (!tabId) {
        return { ok: false, error: 'no 115.com tab found' }
      }

      try {
        const injected = await chrome.scripting.executeScript({
          target: { tabId },
          world: 'MAIN',
          func: async (url: string, body: string) => {
            try {
              const res = await fetch(url, {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body,
              })
              const text = await res.text()
              return { ok: res.ok, status: res.status, text }
            }
            catch (error) {
              return { ok: false, status: 0, text: '', error: String(error) }
            }
          },
          args: [message.data.url, message.data.body],
        })

        const result = injected?.[0]?.result as { ok: boolean, text: string, error?: string } | undefined
        if (!result) {
          return { ok: false, error: 'executeScript returned empty' }
        }
        return result
      }
      catch (error) {
        return { ok: false, error: String(error) }
      }
    }

    case 'OPEN_TAB': {
      const now = Date.now()
      if (lastOpenTabMeta && lastOpenTabMeta.url === message.url && now - lastOpenTabMeta.ts < 2500) {
        return { success: true, deduped: true }
      }
      lastOpenTabMeta = { url: message.url, ts: now }
      await chrome.tabs.create({ url: message.url })
      return { success: true }
    }

    case 'FETCH_M3U8': {
      try {
        const list = await drive115.getM3u8(message.data.pickCode)
        return { list }
      } catch (e) {
        return { error: String(e) }
      }
    }

    case 'FETCH_PLAYLIST': {
      try {
        const result = await drive115.getPlaylist(message.data.cid)
        return {
          list: result.data?.list ?? [],
          path: result.path ?? [],
        }
      }
      catch (e) {
        return { error: String(e) }
      }
    }

    case 'MOVE_FILE': {
      const tabId = sender?.tab?.id
      if (!tabId) {
        return { error: 'missing sender tab' }
      }

      const { fileId, parentId, cid } = message.data
      const injected = await chrome.scripting.executeScript({
        target: { tabId },
        world: 'MAIN',
        func: (payload: { fileId: string, parentId: string, cid: string }) => {
          const win = window as any
          const Core = win.Core
          if (!Core?.TreeDG?.Show) {
            return { ok: false, error: 'Core.TreeDG unavailable' }
          }

          if (Core.FileConfig) {
            Core.FileConfig.aid = Number(payload.parentId) || 0
            Core.FileConfig.cid = payload.cid || '0'
          }

          Core.TreeDG.Show({
            list: [{
              file_type: '1',
              file_id: payload.fileId,
              cate_id: payload.parentId || '',
              area_id: '0',
            }],
            type: 'move',
            has_dir: false,
          })

          return { ok: true }
        },
        args: [{ fileId, parentId, cid }],
      })

      return injected?.[0]?.result ?? { ok: false, error: 'move executeScript empty' }
    }

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
