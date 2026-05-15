/**
 * Background handlers: 播放列表、M3U8、移动文件等
 */
import type {
  MsgDeleteFile,
  MsgDeleteSuccessRefresh,
  MsgFetchM3u8,
  MsgFetchPlaylist,
  MsgFetchSubtitles,
  MsgMoveFile,
  MsgTranscode,
  MsgTranscodeStatus,
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
import { executeInMainWorld } from './helpers'

interface TranscodeCheckResult {
  result?: number
  status?: number
  count?: number
  time?: number
  priority?: number
}

interface TranscodePushResult {
  state?: boolean
  msg?: string
  msg_code?: number
}

interface IsTranscodedResult {
  state?: number
  message?: string
  code?: number
  data?: string
  count?: number
}

const TRANSCODE_COOLDOWN_MS = 45_000
const transcodeCooldown = new Map<string, { ts: number, response: unknown }>()

function getTranscodeCooldown(pickCode: string) {
  const cached = transcodeCooldown.get(pickCode)
  if (!cached) return null
  if (Date.now() - cached.ts > TRANSCODE_COOLDOWN_MS) {
    transcodeCooldown.delete(pickCode)
    return null
  }
  return cached.response
}

function setTranscodeCooldown(pickCode: string, response: unknown) {
  transcodeCooldown.set(pickCode, { ts: Date.now(), response })
}

function buildQueuedResponse(job: TranscodeCheckResult | null | undefined, detail: string, pushAccepted?: boolean) {
  return {
    ok: true,
    state: 'queued' as const,
    queueCount: job?.count,
    etaSeconds: job?.time,
    priority: job?.priority,
    pushAccepted,
    detail,
  }
}

async function getTranscodeContext(pickCode: string) {
  const tabs = await query115Tabs()
  const tabId = tabs[0]?.id
  if (!tabId) return { error: '未找到 115.com 页面' }

  const videoResult = await fetchVideoInfoByPickCode(tabId, pickCode) as any
  if (!videoResult?.state) {
    return { error: '获取视频信息失败' }
  }

  const sha1 = videoResult.sha1
  if (!sha1) {
    return { error: '无法获取 SHA1' }
  }

  return { pickCode, sha1 }
}

export async function handleTranscodeStatus(message: MsgTranscodeStatus) {
  try {
    const context = await getTranscodeContext(message.data.pickCode)
    if ('error' in context) {
      return { ok: false, state: 'failed', error: context.error }
    }

    const job = await checkTranscodeJob(context.sha1, context.pickCode)
    if (job?.status === 3) {
      return buildQueuedResponse(job, 'queue status refreshed')
    }

    const transcoded = await checkIsTranscoded(context.pickCode)
    if (transcoded?.state === 1) {
      return {
        ok: true,
        state: 'completed_refresh',
        detail: 'VIP 加速已完成，刷新页面后可预览',
      }
    }

    return {
      ok: true,
      state: 'pending_check',
      detail: '等待队列状态更新',
    }
  }
  catch (e: any) {
    console.error('[115m] transcode status error:', e)
    return { ok: false, state: 'failed', error: e?.message || String(e) }
  }
}

async function parseJsonResponse<T>(response: Response): Promise<T | null> {
  const text = await response.text()
  if (!text) return null
  try {
    return JSON.parse(text) as T
  }
  catch {
    return null
  }
}

async function checkTranscodeJob(sha1: string, pickCode: string): Promise<TranscodeCheckResult | null> {
  const response = await fetch(`https://115vod.com/transcode/api/1.0/web/1.0/trans_code/check_transcode_job?sha1=${sha1}&priority=100`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
      'Accept': 'application/json, text/javascript, */*; q=0.01',
    },
    referrer: `https://115vod.com/?pickcode=${pickCode}&share_id=0`,
    body: JSON.stringify({ fid: sha1, priority: 1 }),
  })
  return await parseJsonResponse<TranscodeCheckResult>(response)
}

async function pushVipTranscode(sha1: string, pickCode: string): Promise<TranscodePushResult | null> {
  const body = new URLSearchParams()
  body.append('op', 'vip_push')
  body.append('pickcode', pickCode)
  body.append('sha1', sha1)

  const response = await fetch('https://115vod.com/site/?ct=play&ac=push', {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'X-Requested-With': 'XMLHttpRequest',
      'Accept': 'application/json, text/javascript, */*; q=0.01',
    },
    referrer: `https://115vod.com/?pickcode=${pickCode}&share_id=0`,
    body: body.toString(),
  })
  return await parseJsonResponse<TranscodePushResult>(response)
}

async function checkIsTranscoded(pickCode: string): Promise<IsTranscodedResult | null> {
  const body = new URLSearchParams()
  body.append('pick_code', pickCode)

  const response = await fetch('https://115vod.com/webapi/files/is_transcoded', {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'X-Requested-With': 'XMLHttpRequest',
      'Accept': 'application/json, text/javascript, */*; q=0.01',
    },
    referrer: `https://115vod.com/?pickcode=${pickCode}&share_id=0`,
    body: body.toString(),
  })
  return await parseJsonResponse<IsTranscodedResult>(response)
}

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

export async function handleFetchSubtitles(message: MsgFetchSubtitles, sender?: chrome.runtime.MessageSender) {
  try {
    const pickCode = encodeURIComponent(message.data.pickCode)
    
    // 经查阅 115master-main 参考项目，获取字幕应直接请求 webapi.115.com
    const url = `https://webapi.115.com/movies/subtitle?pickcode=${pickCode}`
    const legacyUrl = `https://115.com/webapi/movies/subtitle?pickcode=${pickCode}`
    
    // 注入简单的 fetch 逻辑，确保最纯粹的请求环境
    const script = `
      (async () => {
        try {
          const res = await fetch("${url}", { credentials: "include" });
          const text = await res.text();
          return { ok: true, text };
        } catch (e) {
          return { ok: false, error: e.message };
        }
      })()
    `

    try {
      const mainWorldResult = await executeInMainWorld(sender, script)
      if (mainWorldResult?.ok && mainWorldResult.text) {
        let parsed: any = null
        try {
          parsed = JSON.parse(mainWorldResult.text)
        } catch (e) {}

        if (parsed) {
          console.log('[115m][bg] fetch subtitles via script injection success', parsed)
          return parsed
        }
      }
    } catch (e) {
      console.log('[115m][bg] script injection fetch failed', e)
    }

    // 备用 fallback: 直接在 background fetch
    const res = await fetch(url, {
      credentials: 'include',
      headers: { 
        'Accept': 'application/json, text/javascript, */*; q=0.01',
        'X-Requested-With': 'XMLHttpRequest',
      },
    })
    
    const text = await res.text()
    let result: any = null
    try {
      result = JSON.parse(text)
    } catch (e) {}
    
    console.log('[115m][bg] fetch subtitles fallback result:', result)
    
    if (result) {
      return result
    }
    
    return { data: [], error: 'empty' }
  }
  catch (e: any) {
    console.warn('[115m][bg] fetch subtitles failed', e)
    return { data: [], error: e?.message || String(e) }
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
  const pickCodeForCooldown = message.data.pickCode
  const cached = getTranscodeCooldown(pickCodeForCooldown)
  if (cached) {
    return { ...(cached as object), deduped: true }
  }

  try {
    const context = await getTranscodeContext(pickCodeForCooldown)
    if ('error' in context) {
      return { ok: false, state: 'failed', error: context.error }
    }

    const { pickCode, sha1 } = context

    const before = await checkTranscodeJob(sha1, pickCode)
    if (before?.status === 3) {
      const response = buildQueuedResponse(before, 'already queued')
      setTranscodeCooldown(pickCode, response)
      return response
    }

    const pushResult = await pushVipTranscode(sha1, pickCode)
    const after = await checkTranscodeJob(sha1, pickCode)
    const transcoded = await checkIsTranscoded(pickCode)

    if (after?.status === 3 || (typeof before?.priority === 'number' && typeof after?.priority === 'number' && after.priority > before.priority)) {
      const response = buildQueuedResponse(after, pushResult?.msg || 'queued after vip push', !!pushResult?.state)
      setTranscodeCooldown(pickCode, response)
      return response
    }

    if (transcoded?.state === 1 && after?.status !== 3) {
      const response = {
        ok: true,
        state: 'manual_required',
        pushAccepted: !!pushResult?.state,
        detail: pushResult?.msg || 'transcode not queued automatically',
      }
      setTranscodeCooldown(pickCode, response)
      return response
    }

    if (pushResult?.state) {
      const response = {
        ok: true,
        state: 'pending_check',
        pushAccepted: true,
        detail: pushResult.msg || 'vip push accepted',
      }
      setTranscodeCooldown(pickCode, response)
      return response
    }

    const response = {
      ok: true,
      state: 'manual_required',
      pushAccepted: false,
      detail: pushResult?.msg || 'vip push rejected',
    }
    setTranscodeCooldown(pickCode, response)
    return response
  }
  catch (e: any) {
    console.error('[115m] transcode error:', e)
    return { ok: false, state: 'failed', error: e?.message || String(e) }
  }
}
