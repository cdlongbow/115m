/**
 * Background Service Worker
 * 精简版：仅保留必要的消息代理功能
 */

import { drive115 } from '../lib'
import type { RuntimeMessage } from '../shared/messages'

// 安装时初始化
chrome.runtime.onInstalled.addListener((details) => {
  console.log('[115m] Extension installed', details.reason)
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
        // 必须在 115.com 标签页主世界中 fetch，否则没有 cookie
        const tabs = await chrome.tabs.query({ url: '*://*.115.com/*' })
        const tabId = tabs[0]?.id
        if (!tabId) return { error: 'no 115.com tab found', list: [], path: [] }

        let { cid, pickCode } = message.data

        // 如果没有 cid，先通过 files/video API 获取 parent_id
        if (!cid && pickCode) {
          const videoInfoUrl = `https://webapi.115.com/files/video?pick_code=${pickCode}`
          const videoInjected = await chrome.scripting.executeScript({
            target: { tabId },
            world: 'MAIN',
            func: async (url: string) => {
              try {
                const res = await fetch(url, { credentials: 'include' })
                return await res.json()
              }
              catch (e) {
                return { state: false, error: String(e) }
              }
            },
            args: [videoInfoUrl],
          })
          const videoResult = videoInjected?.[0]?.result as any
          if (videoResult?.state && videoResult?.data) {
            cid = videoResult.data.parent_id || ''
          }
          if (!cid) {
            console.warn('[115m] FETCH_PLAYLIST: could not get parent_id from video info', videoResult)
            return { error: 'no cid available', list: [], path: [] }
          }
        }

        if (!cid) return { error: 'no cid provided', list: [], path: [] }
        const params = new URLSearchParams({
          aid: '1', cid, offset: '0', limit: '1150',
          show_dir: '0', nf: '', qid: '0', type: '4',
          source: '', format: 'json', star: '', is_q: '',
          is_share: '', r_all: '1', o: 'file_name',
          asc: '1', cur: '1', natsort: '1',
        })
        const apiUrl = `https://webapi.115.com/files?${params}`

        const injected = await chrome.scripting.executeScript({
          target: { tabId },
          world: 'MAIN',
          func: async (url: string) => {
            try {
              const res = await fetch(url, { credentials: 'include' })
              return await res.json()
            }
            catch (e) {
              return { state: false, error: String(e) }
            }
          },
          args: [apiUrl],
        })

        const result = injected?.[0]?.result as any
        if (!result?.state) {
          return { error: result?.error || 'API error', list: [], path: [] }
        }
        return {
          list: result.data ?? [],
          path: result.path ?? [],
        }
      }
      catch (e) {
        return { error: String(e), list: [], path: [] }
      }
    }

    case 'MOVE_FILE': {
      let tabId = sender?.tab?.id
      if (!tabId) {
        const tabs = await chrome.tabs.query({ url: '*://*.115.com/*' })
        tabId = tabs[0]?.id
      }
      if (!tabId) {
        return { ok: false, error: 'no 115.com tab found' }
      }

      const { fileId, parentId, cid } = message.data
      const injected = await chrome.scripting.executeScript({
        target: { tabId },
        world: 'MAIN',
        func: async (payload: { fileId: string, parentId: string, cid: string }) => {
          const win = window as any

          // 1. Dynamically load Core SDK if missing, just like the reference project
          if (!win.Core) {
            console.log('[115m] Core SDK missing, injecting scripts dynamically...')
            const loadScript = (url: string) => new Promise((resolve, reject) => {
              const s = document.createElement('script')
              s.src = url
              s.onload = resolve
              s.onerror = () => reject(new Error('Failed to load ' + url))
              document.head.appendChild(s)
            })

            try {
              await loadScript('https://cdnres.115.com/site/static/js/jquery.js?_vh=ddb84c1_91')
              await loadScript('https://cdnassets.115.com/??libs/jquery-1.7.2.js,jquery-extend.js,libs/json2.js,oofUtil.js,paths.js,oofUtil/subscribe.js,commonFrame/urlMaintain.js,ajax/bridge.js?v=1767951162')
              await loadScript('https://cdnres.115.com/site/static/js/min/util-min.js?_vh=be49060_91')
              await loadScript('https://cdnres.115.com/site/static/js/wl_disk2014/min/core-min.js?_vh=d376e38_91')
              
              // Wait for Core object to be fully attached
              await new Promise<void>((resolve) => {
                const check = () => { if (win.Core) resolve(); else setTimeout(check, 50) }
                check()
              })
              console.log('[115m] Core SDK dynamically injected!')
            } catch (e: any) {
              return { ok: false, error: 'Failed to inject Core SDK: ' + e?.message }
            }
          }

          const Core = win.Core
          const $ = win.$ || win.jQuery

          if (!Core?.TreeDG?.Show) {
            return { ok: false, error: 'Core.TreeDG not available after loading' }
          }

          // Ensure dialog CSS is loaded
          if (!document.querySelector('link[href*="dialog_box.css"]')) {
            const link = document.createElement('link')
            link.rel = 'stylesheet'
            link.href = 'https://cdnres.115.com/site/static/style_v11.2/common/css/dialog_box.css?_vh=f17e241_91'
            document.head.appendChild(link)
          }

          // Initialize UDataAPI if not set (required for TreeDG to make AJAX calls)
          if (!Core.DataAccess?.UDataAPI && $?.ajax) {
            console.log('[115m] Initializing Core.DataAccess.UDataAPI')
            if (!Core.DataAccess) Core.DataAccess = {}
            Core.DataAccess.UDataAPI = {
              ajax: (settings: any) => {
                let url = settings.url || ''
                if (url.startsWith('/')) url = '//webapi.115.com' + url
                return $.ajax({ ...settings, url, xhrFields: { withCredentials: true } })
              },
            }
          }

          if (Core.FileConfig) {
            Core.FileConfig.aid = Number(payload.parentId) || 0
            Core.FileConfig.cid = payload.cid || '0'
          }

          // Create jQuery-like mock object (Core SDK expects attr() method)
          const fileAttrs: Record<string, string> = {
            file_type: '1',
            file_id: payload.fileId,
            cate_id: payload.parentId || '',
            area_id: '0',
          }
          const mockJQueryObject = { attr: (key: string) => fileAttrs[key] || '' }

          console.log('[115m] Calling Core.TreeDG.Show with fileId:', payload.fileId)
          try {
            Core.TreeDG.Show({
              list: [mockJQueryObject],
              type: 'move',
              has_dir: false,
            })
          } catch (e: any) {
            console.error('[115m] TreeDG.Show error:', e)
            return { ok: false, error: 'TreeDG.Show threw: ' + e?.message }
          }

          return { ok: true }
        },
        args: [{ fileId, parentId, cid }],
      })

      const result = injected?.[0]?.result as { ok?: boolean } | undefined
      // Switch to the 115 tab so user can see the dialog
      if (result?.ok && tabId) {
        await chrome.tabs.update(tabId, { active: true })
      }
      return result ?? { ok: false, error: 'move executeScript empty' }
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
