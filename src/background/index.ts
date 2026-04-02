/**
 * Background Service Worker
 * 消息路由分发 + 生命周期管理
 */

import type { RuntimeMessage } from '../shared/messages'
import { executeInMainWorld } from './helpers'
import {
  handleFetchM3u8,
  handleFetchPlaylist,
  handleMoveFile,
  handleMoveSuccessRefresh,
} from './handlers'

console.log('[115m] Service Worker starting...')

// 安装时初始化
chrome.runtime.onInstalled.addListener((details) => {
  console.log('[115m] Extension installed', details.reason)
  registerEarlyOverrideScript()
})

// 浏览器启动时，确保 early script 已注册
chrome.runtime.onStartup.addListener(() => {
  console.log('[115m] Browser startup')
  registerEarlyOverrideScript()
})

/**
 * 注册一个极轻量的 content script，在 document_start 阶段同步覆盖 115 视频页面
 * 脚本放在 public/ 目录下，Vite 原样复制不打包，确保同步执行
 * 这样能在 115 原生行内脚本执行之前接管页面，避免 "undefined action!" 闪现
 */
async function registerEarlyOverrideScript() {
  try {
    await chrome.scripting.registerContentScripts([{
      id: 'video-page-early-override',
      matches: [
        'https://115.com/web/lixian/master/video/*',
        'https://*.115.com/web/lixian/master/video/*',
      ],
      js: ['video-page-early.js'],
      runAt: 'document_start',
      world: 'ISOLATED' as any,
    }])
  }
  catch (e) {
    console.warn('[115m] Failed to register early override script:', e)
  }
}

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
    case 'PING':
      return { pong: true }

    case 'MAIN_WORLD_FETCH':
      return executeInMainWorld(sender, message.data.url, message.data.body)

    case 'MAIN_WORLD_GET':
      return executeInMainWorld(sender, message.data.url)

    case 'OPEN_TAB': {
      const now = Date.now()
      if (lastOpenTabMeta && lastOpenTabMeta.url === message.url && now - lastOpenTabMeta.ts < 2500) {
        return { success: true, deduped: true }
      }
      lastOpenTabMeta = { url: message.url, ts: now }
      await chrome.tabs.create({ url: message.url })
      return { success: true }
    }

    case 'MOVE_SUCCESS_REFRESH':
      return handleMoveSuccessRefresh()

    case 'FETCH_M3U8':
      return handleFetchM3u8(message)

    case 'FETCH_PLAYLIST':
      return handleFetchPlaylist(message)

    case 'MOVE_FILE':
      return handleMoveFile(message, sender)

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
