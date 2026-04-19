/**
 * Background handlers: 播放列表、M3U8、移动文件等
 */
import type {
  MsgDeleteFile,
  MsgDeleteSuccessRefresh,
  MsgFetchM3u8,
  MsgFetchPlaylist,
  MsgMoveFile,
  MsgTranscode,
} from '../shared/messages'
import { parseM3u8Text } from '../lib/m3u8-parser'
import {
  deleteFileIn115Page,
  fetchPlaylistIn115Page,
  fetchVideoInfoByPickCode,
  refreshListPageIn115Tab,
  removeDeletedNodeIn115Tab,
  showMoveFileDialogIn115Page,
} from '../platform/115/file-actions'
import { find115TabId, query115Tabs, queryPlayerTabs, runIn115MainWorld } from '../platform/115/main-world'

// ─── FETCH_M3U8 ───
export async function handleFetchM3u8(message: MsgFetchM3u8) {
  try {
    const pickCode = message.data.pickCode
    const url = `https://115.com/api/video/m3u8/${pickCode}.m3u8`

    const res = await fetch(url, {
      credentials: 'include',
      headers: { Accept: '*/*' },
    })
    const htmlText = await res.text()

    const m3u8List = parseM3u8Text(htmlText)
    return { list: m3u8List }
  }
  catch (e: any) {
    return { error: e?.message || String(e) }
  }
}

// ─── FETCH_PLAYLIST ───
export async function handleFetchPlaylist(message: MsgFetchPlaylist) {
  try {
    const tabs = await query115Tabs()
    const tabId = tabs[0]?.id
    if (!tabId) return { error: 'no 115.com tab found', list: [], path: [] }

    let { cid, pickCode } = message.data

    if (!cid && pickCode) {
      const videoResult = await fetchVideoInfoByPickCode(tabId, pickCode) as any
      if (videoResult?.state) {
        cid = videoResult.parent_id || videoResult.data?.parent_id || ''
      }
      if (!cid) {
        console.warn('[115m] FETCH_PLAYLIST: could not get parent_id from video info')
        return { error: 'no cid available', list: [], path: [] }
      }
    }

    if (!cid) return { error: 'no cid provided', list: [], path: [] }
    const result = await fetchPlaylistIn115Page(tabId, cid) as any
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
  const result = await showMoveFileDialogIn115Page(tabId, { fileId, parentId, cid }) as { ok?: boolean, error?: string } | undefined
  if (result?.ok) {
    await chrome.tabs.update(tabId, { active: true })
  }
  return result ?? { ok: false, error: 'move executeScript empty' }
}

// ─── MOVE_SUCCESS_REFRESH ───
export async function handleMoveSuccessRefresh() {
  const playerTabs = await queryPlayerTabs()
  for (const tab of playerTabs) {
    if (tab.id) {
      chrome.tabs.sendMessage(tab.id, { type: 'MOVE_SUCCESS_REFRESH' }).catch(() => {})
    }
  }

  const allTabs = await query115Tabs()
  for (const tab of allTabs) {
    if (tab.id && !playerTabs.some(pt => pt.id === tab.id)) {
      try {
        await refreshListPageIn115Tab(tab.id)
      }
      catch (e) {
        console.log('[115m] executeScript refresh failed:', e)
      }
    }
  }
  return { success: true }
}

export async function handleDeleteFile(
  message: MsgDeleteFile,
  sender?: chrome.runtime.MessageSender,
) {
  const tabId = await find115TabId(sender)
  if (!tabId) {
    return { ok: false, error: 'no 115.com tab found' }
  }

  const { fileId, parentId, pickCode } = message.data
  const result = await deleteFileIn115Page(tabId, { fileId, parentId }) as { ok?: boolean, error?: string } | undefined
  if (result?.ok) {
    await handleDeleteSuccessRefresh({
      type: 'DELETE_SUCCESS_REFRESH',
      data: { fileId, parentId, pickCode },
    })
  }
  return result ?? { ok: false, error: 'delete executeScript empty' }
}

export async function handleDeleteSuccessRefresh(message: MsgDeleteSuccessRefresh) {
  const { fileId, parentId, pickCode } = message.data

  const playerTabs = await queryPlayerTabs()
  for (const tab of playerTabs) {
    if (tab.id) {
      chrome.tabs.sendMessage(tab.id, { type: 'DELETE_SUCCESS_REFRESH', data: { fileId, parentId, pickCode } }).catch(() => {})
    }
  }

  const allTabs = await query115Tabs()
  for (const tab of allTabs) {
    if (tab.id && !playerTabs.some(pt => pt.id === tab.id)) {
      chrome.tabs.sendMessage(tab.id, { type: 'DELETE_SUCCESS_REFRESH', data: { fileId, parentId, pickCode } }).catch(() => {})
      try {
        await removeDeletedNodeIn115Tab(tab.id, { fileId, pickCode })
      }
      catch {
        // ignore per-tab sync failures
      }
    }
  }

  return { ok: true }
}

// ─── TRANSCODE_ACCELERATE ───
export async function handleTranscode(message: MsgTranscode) {
  try {
    const { pickCode } = message.data

    const tabs = await query115Tabs()
    const tabId = tabs[0]?.id
    if (!tabId) return { ok: false, error: '未找到 115.com 页面' }

    const videoResult = await fetchVideoInfoByPickCode(tabId, pickCode) as any
    if (!videoResult?.state) {
      return { ok: false, error: '获取视频信息失败' }
    }

    const sha1 = videoResult.sha1
    if (!sha1) return { ok: false, error: '无法获取 SHA1' }

    const pushFormData = new URLSearchParams()
    pushFormData.append('op', 'vip_push')
    pushFormData.append('pickcode', pickCode)
    pushFormData.append('sha1', sha1)

    const result = await runIn115MainWorld({
      tabId,
      args: [pickCode, sha1, pushFormData.toString()],
      func: async (currentPickCode: string, currentSha1: string, pushBody: string) => {
        const parseJsonSafely = async (res: Response) => {
          const text = await res.text()
          if (!text) return null
          try {
            return JSON.parse(text)
          }
          catch {
            return { raw: text }
          }
        }

        const referer = `https://115vod.com/?pickcode=${currentPickCode}&share_id=0`

        const pushRes = await fetch('https://115vod.com/site/?ct=play&ac=push', {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: pushBody,
          referrer: referer,
        })
        const pushResult = await parseJsonSafely(pushRes)

        const transcodeRes = await fetch(`https://115vod.com/transcode/api/1.0/web/1.0/trans_code/check_transcode_job?sha1=${currentSha1}&priority=100`, {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ fid: currentSha1, priority: 1 }),
          referrer: referer,
        })
        const data = await parseJsonSafely(transcodeRes)

        return {
          pushResult,
          data,
          pushStatus: pushRes.status,
          transcodeStatus: transcodeRes.status,
        }
      },
    }) as any

    if (!result) {
      return { ok: false, error: '未找到可用的 115 页面上下文' }
    }

    console.log('[115m] vip_push result:', result.pushResult)
    if (!result.pushResult || !result.pushResult.state) {
      console.warn('[115m] vip_push failed or returned false state:', result.pushResult)
    }

    console.log('[115m] transcode check result:', result)
    return { ok: true, data: result.data, pushResult: result.pushResult }
  }
  catch (e: any) {
    console.error('[115m] transcode error:', e)
    return { ok: false, error: e?.message || String(e) }
  }
}
