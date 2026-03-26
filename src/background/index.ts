/**
 * Background Service Worker
 */

import { drive115 } from '../lib'
import type { M3u8Item } from '../lib/types'
import type { RuntimeMessage } from '../shared/messages'

// 安装时初始化
chrome.runtime.onInstalled.addListener((details) => {
  console.log('[115m] Extension installed', details.reason)
})

// 监听来自 content script 和 player 页面的消息
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleMessage(message).then(sendResponse).catch((err) => {
    console.error('[115m] BG error:', err)
    sendResponse({ error: err.message })
  })
  return true // 保持 sendResponse 有效
})

interface PrefetchUltraCache {
  url: string
  updatedAt: number
}

interface PrefetchM3u8Cache {
  list: M3u8Item[]
  updatedAt: number
}

const PREFETCH_TTL = 2 * 60 * 1000
const PREFETCH_SESSION_KEY = 'prefetchUltraCacheV1'
const PREFETCH_M3U8_SESSION_KEY = 'prefetchM3u8CacheV1'
const ULTRA_WARMUP_TIMEOUT = 1500
const prefetchUltraCache = new Map<string, PrefetchUltraCache>()
const prefetchUltraInflight = new Map<string, Promise<PrefetchUltraCache | null>>()
const prefetchM3u8Cache = new Map<string, PrefetchM3u8Cache>()
const prefetchM3u8Inflight = new Map<string, Promise<PrefetchM3u8Cache | null>>()
const ultraWarmupInflight = new Map<string, Promise<void>>()
let lastOpenTabMeta: { url: string, ts: number } | null = null

function warmupUltraStream(url: string): Promise<void> {
  const inflight = ultraWarmupInflight.get(url)
  if (inflight) return inflight

  const task = (async () => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), ULTRA_WARMUP_TIMEOUT)
    try {
      await fetch(url, {
        method: 'GET',
        credentials: 'include',
        cache: 'no-store',
        headers: {
          Range: 'bytes=0-32767',
        },
        signal: controller.signal,
      })
    }
    catch {
      // ignore warmup errors
    }
    finally {
      clearTimeout(timer)
      ultraWarmupInflight.delete(url)
    }
  })()

  ultraWarmupInflight.set(url, task)
  return task
}

async function readSessionCache(pickCode: string): Promise<PrefetchUltraCache | null> {
  try {
    const payload = await chrome.storage.session.get(PREFETCH_SESSION_KEY)
    const table = (payload?.[PREFETCH_SESSION_KEY] || {}) as Record<string, PrefetchUltraCache>
    const hit = table[pickCode]
    if (!hit) return null
    if (Date.now() - hit.updatedAt >= PREFETCH_TTL) return null
    return hit
  }
  catch {
    return null
  }
}

async function readSessionM3u8Cache(pickCode: string): Promise<PrefetchM3u8Cache | null> {
  try {
    const payload = await chrome.storage.session.get(PREFETCH_M3U8_SESSION_KEY)
    const table = (payload?.[PREFETCH_M3U8_SESSION_KEY] || {}) as Record<string, PrefetchM3u8Cache>
    const hit = table[pickCode]
    if (!hit || !Array.isArray(hit.list) || hit.list.length === 0) return null
    if (Date.now() - hit.updatedAt >= PREFETCH_TTL) return null
    return hit
  }
  catch {
    return null
  }
}

async function writeSessionCache(pickCode: string, data: PrefetchUltraCache): Promise<void> {
  try {
    const payload = await chrome.storage.session.get(PREFETCH_SESSION_KEY)
    const table = (payload?.[PREFETCH_SESSION_KEY] || {}) as Record<string, PrefetchUltraCache>
    table[pickCode] = data
    await chrome.storage.session.set({ [PREFETCH_SESSION_KEY]: table })
  }
  catch {
    // ignore session cache failure
  }
}

async function writeSessionM3u8Cache(pickCode: string, data: PrefetchM3u8Cache): Promise<void> {
  try {
    const payload = await chrome.storage.session.get(PREFETCH_M3U8_SESSION_KEY)
    const table = (payload?.[PREFETCH_M3U8_SESSION_KEY] || {}) as Record<string, PrefetchM3u8Cache>
    table[pickCode] = data
    await chrome.storage.session.set({ [PREFETCH_M3U8_SESSION_KEY]: table })
  }
  catch {
    // ignore session cache failure
  }
}

async function prefetchUltraSource(pickCode: string): Promise<PrefetchUltraCache | null> {
  const cached = prefetchUltraCache.get(pickCode)
  if (cached && Date.now() - cached.updatedAt < PREFETCH_TTL) {
    return cached
  }

  const sessionCached = await readSessionCache(pickCode)
  if (sessionCached) {
    prefetchUltraCache.set(pickCode, sessionCached)
    void warmupUltraStream(sessionCached.url)
    return sessionCached
  }

  const inflight = prefetchUltraInflight.get(pickCode)
  if (inflight) {
    return inflight
  }

  const request = (async () => {
    try {
      const downloadResult = await drive115.getFileDownloadUrl(pickCode)
      const url = downloadResult.url?.url
      if (!url) return null

      const authCookie = downloadResult.url?.auth_cookie
      if (authCookie) {
        await chrome.cookies.set({
          url: 'https://dl.115cdn.net',
          name: authCookie.name,
          value: authCookie.value,
          path: authCookie.path,
          domain: '.115cdn.net',
          secure: true,
          expirationDate: Number(authCookie.expire),
          sameSite: 'no_restriction',
        })
      }

      const data = {
        url,
        updatedAt: Date.now(),
      }
      prefetchUltraCache.set(pickCode, data)
      await writeSessionCache(pickCode, data)
      void warmupUltraStream(url)
      return data
    }
    catch (error) {
      console.warn('[115m] 预热视频地址失败:', pickCode, error)
      return null
    }
    finally {
      prefetchUltraInflight.delete(pickCode)
    }
  })()

  prefetchUltraInflight.set(pickCode, request)
  return request
}

async function prefetchM3u8Source(pickCode: string): Promise<PrefetchM3u8Cache | null> {
  const cached = prefetchM3u8Cache.get(pickCode)
  if (cached && Date.now() - cached.updatedAt < PREFETCH_TTL && cached.list.length > 0) {
    return cached
  }

  const sessionCached = await readSessionM3u8Cache(pickCode)
  if (sessionCached) {
    prefetchM3u8Cache.set(pickCode, sessionCached)
    return sessionCached
  }

  const inflight = prefetchM3u8Inflight.get(pickCode)
  if (inflight) {
    return inflight
  }

  const request = (async () => {
    try {
      const list = await drive115.getM3u8(pickCode)
      if (!Array.isArray(list) || list.length === 0) return null

      const data = {
        list,
        updatedAt: Date.now(),
      }
      prefetchM3u8Cache.set(pickCode, data)
      await writeSessionM3u8Cache(pickCode, data)
      return data
    }
    catch (error) {
      console.warn('[115m] 预热 m3u8 失败:', pickCode, error)
      return null
    }
    finally {
      prefetchM3u8Inflight.delete(pickCode)
    }
  })()

  prefetchM3u8Inflight.set(pickCode, request)
  return request
}

async function handleMessage(message: RuntimeMessage): Promise<any> {
  switch (message.type) {
    case 'OPEN_TAB': {
      const now = Date.now()
      if (lastOpenTabMeta && lastOpenTabMeta.url === message.url && now - lastOpenTabMeta.ts < 2500) {
        return { success: true, deduped: true }
      }
      lastOpenTabMeta = { url: message.url, ts: now }
      await chrome.tabs.create({ url: message.url })
      return { success: true }
    }

    case 'PREFETCH_VIDEO_SOURCE': {
      void prefetchUltraSource(message.data.pickCode)
      return { success: true }
    }

    case 'GET_PREFETCH_VIDEO_SOURCE': {
      const result = await prefetchUltraSource(message.data.pickCode)
      if (!result) return null
      return {
        url: result.url,
        fromCache: true,
      }
    }

    case 'SET_PREFETCH_VIDEO_SOURCE': {
      const { pickCode, url, authCookie } = message.data
      if (!pickCode || !url) return { success: false }

      const data = {
        url,
        updatedAt: Date.now(),
      }
      prefetchUltraCache.set(pickCode, data)
      await writeSessionCache(pickCode, data)

      if (authCookie) {
        await chrome.cookies.set({
          url: 'https://dl.115cdn.net',
          name: authCookie.name,
          value: authCookie.value,
          path: authCookie.path,
          domain: '.115cdn.net',
          secure: true,
          expirationDate: Number(authCookie.expire),
          sameSite: 'no_restriction',
        })
      }

      return { success: true }
    }

    case 'GET_PREFETCH_M3U8': {
      const result = await prefetchM3u8Source(message.data.pickCode)
      if (!result) return null
      return {
        list: result.list,
        fromCache: true,
      }
    }

    case 'FETCH_M3U8': {
      try {
        const list = await drive115.getM3u8(message.data.pickCode)
        return { list }
      } catch (e) {
        return { error: String(e) }
      }
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
