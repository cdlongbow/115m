/**
 * Background handlers: 播放列表、M3U8、移动文件等
 */
import type {
  MsgFetchM3u8, MsgFetchPlaylist, MsgMoveFile,
  MsgMoveSuccessRefresh,
} from '../shared/messages'
import { parseM3u8Text } from '../lib/m3u8-parser'
import { find115TabId } from './helpers'

// ─── FETCH_M3U8 ───
export async function handleFetchM3u8(message: MsgFetchM3u8) {
  try {
    const pickCode = message.data.pickCode
    const url = `https://115.com/api/video/m3u8/${pickCode}.m3u8`

    const res = await fetch(url, {
      credentials: 'include',
      headers: { 'Accept': '*/*' },
    })
    const htmlText = await res.text()

    const m3u8List = parseM3u8Text(htmlText)
    return { list: m3u8List }
  } catch (e: any) {
    return { error: e?.message || String(e) }
  }
}

// ─── FETCH_PLAYLIST ───
export async function handleFetchPlaylist(message: MsgFetchPlaylist) {
  try {
    const tabs = await chrome.tabs.query({ url: '*://*.115.com/*' })
    const tabId = tabs[0]?.id
    if (!tabId) return { error: 'no 115.com tab found', list: [], path: [] }

    let { cid, pickCode } = message.data

    // 如果没有 cid，先通过 files/video API 获取 parent_id
    if (!cid && pickCode) {
      const videoInfoUrl = `https://webapi.115.com/files/video?pickcode=${pickCode}&share_id=0&local=1`
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
      if (videoResult?.state) {
        cid = videoResult.parent_id || videoResult.data?.parent_id || ''
      }
      if (!cid) {
        console.warn('[115m] FETCH_PLAYLIST: could not get parent_id from video info')
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

// ─── MOVE_FILE ───
export async function handleMoveFile(
  message: MsgMoveFile,
  sender?: chrome.runtime.MessageSender,
) {
  const tabId = await find115TabId(sender)
  if (!tabId) {
    return { ok: false, error: 'no 115.com tab found' }
  }

  const { fileId, parentId, cid } = message.data
  const injected = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: async (payload: { fileId: string, parentId: string, cid: string }) => {
      const win = window as any

      // 1. Dynamically load Core SDK if missing
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

      // Initialize UDataAPI if not set
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
          callback: (result: any) => {
            console.log('[115m] TreeDG callback triggered, result:', result)
            if (result !== false) {
              console.log('[115m] Move success, dispatching event')
              window.dispatchEvent(new CustomEvent('115m-move-success'))
              try {
                chrome.runtime.sendMessage({ type: 'MOVE_SUCCESS_REFRESH' })
              } catch (e) {
                console.log('[115m] chrome.runtime.sendMessage failed in MAIN world:', e)
              }
            }
          },
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
  if (result?.ok && tabId) {
    await chrome.tabs.update(tabId, { active: true })
  }
  return result ?? { ok: false, error: 'move executeScript empty' }
}

// ─── MOVE_SUCCESS_REFRESH ───
export async function handleMoveSuccessRefresh() {
  // 广播给所有播放器页面
  const playerTabs = await chrome.tabs.query({ url: '*://*.115.com/web/lixian/master/video/*' })
  for (const tab of playerTabs) {
    if (tab.id) {
      chrome.tabs.sendMessage(tab.id, { type: 'MOVE_SUCCESS_REFRESH' }).catch(() => {})
    }
  }

  // 刷新所有115网盘列表页面
  const allTabs = await chrome.tabs.query({ url: '*://*.115.com/*' })
  for (const tab of allTabs) {
    if (tab.id && !playerTabs.some(pt => pt.id === tab.id)) {
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          world: 'MAIN',
          func: () => {
            try {
              const frame = document.querySelector('iframe[name="wangpan"]') as HTMLIFrameElement | null;
              const win = frame ? (frame.contentWindow as any) : (window as any);
              if (win && win.Core && win.Core.FileConfig && win.Core.FileConfig.DataAPI && win.Core.FileConfig.DataAPI.Refresh) {
                win.Core.FileConfig.DataAPI.Refresh();
              } else if ((window as any).Core && (window as any).Core.FileConfig && (window as any).Core.FileConfig.DataAPI && (window as any).Core.FileConfig.DataAPI.Refresh) {
                (window as any).Core.FileConfig.DataAPI.Refresh();
              }
            } catch (e) {
              console.log('[115m] trigger refresh failed:', e);
            }
          }
        });
      } catch (e) {
        console.log('[115m] executeScript refresh failed:', e);
      }
    }
  }
  return { success: true }
}
