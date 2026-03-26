/**
 * 115 Drive API 核心 - 从原项目移植，适配扩展环境
 */
import {
  NORMAL_URL, WEB_API_URL, PRO_API_URL, VOD_URL, APS_URL, DL_URL,
} from './constants'
import { qualityCodeMap } from './types'
import type { M3u8Item } from './types'
import type {
  DownloadResult,
  FilesDownloadRes, ProDownurlRes, VideoM3u8Res,
  FilesRes, FilesVideoRes,
} from './api/types'
import { crypto115 } from './crypto'

export class Drive115Error extends Error {
  static NotFoundM3u8 = class extends Error {
    constructor() { super('Not found m3u8 file') }
  }
}

/**
 * 网络请求封装（替代 GM_xmlhttpRequest）
 */
class Request {
  async get(url: string, options?: RequestInit): Promise<Response> {
    return fetch(url, {
      credentials: 'include',
      ...options,
    })
  }

  async post(url: string, options?: RequestInit): Promise<Response> {
    return fetch(url, {
      method: 'POST',
      credentials: 'include',
      ...options,
    })
  }

  async getJson<T>(url: string): Promise<T> {
    const res = await this.get(url)
    return res.json()
  }

  async postJson<T>(url: string, data: string): Promise<T> {
    const res = await this.post(url, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: data,
    })
    return res.json()
  }
}

const request = new Request()
const PICKCODE_URL_CACHE_TTL = 5 * 60 * 1000
const pickCodeUrlCache = new Map<string, { value: DownloadResult, updatedAt: number }>()
const pickCodeInflight = new Map<string, Promise<DownloadResult>>()
const WEB_API_DEFER_MS = 300

/**
 * 获取 URL 的绝对路径
 */
function getXUrl(url: string): string {
  if (url.startsWith('http')) return url
  return `${NORMAL_URL}${url}`
}

/**
 * 115 Drive 核心类
 */
export class Drive115 {
  private req = request

  /**
   * 普通下载接口（有限制大小）
   */
  async webApiFilesDownload(pickcode: string): Promise<DownloadResult> {
    const res = await this.req.getJson<FilesDownloadRes>(
      `${WEB_API_URL}/files/download?pickcode=${pickcode}`,
    )

    if (res.errNo === 990001) {
      throw new Error('登录已过期，请重新登录 115')
    }

    if (!res.state || !res.file_url) {
      throw new Error(`获取下载地址失败: ${JSON.stringify(res)}`)
    }

    return { url: { url: res.file_url } }
  }

  /**
   * Pro 下载接口（无限制大小，Ultra 画质）
   */
  async proPostAppChromeDownurl(pickcode: string): Promise<DownloadResult> {
    const tm = Math.floor(Date.now() / 1000).toString()
    const src = JSON.stringify({ pickcode })
    const encoded = crypto115.m115_encode(src, tm)
    const data = `data=${encodeURIComponent(encoded.data)}`

    const res = await this.req.postJson<ProDownurlRes>(
      `${PRO_API_URL}/app/chrome/downurl?t=${tm}`,
      data,
    )

    if (!res.state) {
      throw new Error(`Pro API 获取下载地址失败: ${JSON.stringify(res)}`)
    }

    const result = JSON.parse(
      crypto115.m115_decode(res.data, encoded.key),
    )
    const downloadInfo = Object.values(result)[0] as DownloadResult
    return downloadInfo
  }

  /**
   * 获取文件下载地址（先尝试 Pro，失败降级普通）
   */
  async getFileDownloadUrl(pickcode: string): Promise<DownloadResult> {
    const trace = `${pickcode.slice(0, 8)}-${Date.now()}`
    const startAt = performance.now()
    const cached = pickCodeUrlCache.get(pickcode)
    if (cached && Date.now() - cached.updatedAt < PICKCODE_URL_CACHE_TTL) {
      console.log('[115m][Downurl]', {
        trace,
        pickCode: pickcode,
        source: 'memory-cache',
        totalMs: Math.round(performance.now() - startAt),
      })
      return cached.value
    }

    const inflight = pickCodeInflight.get(pickcode)
    if (inflight) {
      console.log('[115m][Downurl]', {
        trace,
        pickCode: pickcode,
        source: 'inflight-reuse',
        totalMs: Math.round(performance.now() - startAt),
      })
      return inflight
    }

    const task = (async () => {
      let webStarted = false
      const proAt = performance.now()
      const proTask = this.proPostAppChromeDownurl(pickcode)
        .then(result => ({ ok: true as const, result, from: 'pro' as const, costMs: Math.round(performance.now() - proAt) }))
        .catch(error => ({ ok: false as const, error, from: 'pro' as const, costMs: Math.round(performance.now() - proAt) }))

      const startWebTask = () => {
        webStarted = true
        const webAt = performance.now()
        return this.webApiFilesDownload(pickcode)
          .then(result => ({ ok: true as const, result, from: 'web' as const, costMs: Math.round(performance.now() - webAt) }))
          .catch(error => ({ ok: false as const, error, from: 'web' as const, costMs: Math.round(performance.now() - webAt) }))
      }

      const deferredWebTask = (async () => {
        await new Promise(resolve => setTimeout(resolve, WEB_API_DEFER_MS))
        return startWebTask()
      })()

      const first = await Promise.race([proTask, deferredWebTask])
      if (first.ok) {
        pickCodeUrlCache.set(pickcode, { value: first.result, updatedAt: Date.now() })
        console.log('[115m][Downurl]', {
          trace,
          pickCode: pickcode,
          source: first.from,
          sourceMs: first.costMs,
          totalMs: Math.round(performance.now() - startAt),
        })
        return first.result
      }

      const second = await (first.from === 'pro'
        ? (webStarted ? deferredWebTask : startWebTask())
        : proTask)
      if (second.ok) {
        pickCodeUrlCache.set(pickcode, { value: second.result, updatedAt: Date.now() })
        console.log('[115m][Downurl]', {
          trace,
          pickCode: pickcode,
          source: second.from,
          fallbackFrom: first.from,
          sourceMs: second.costMs,
          firstFailMs: first.costMs,
          totalMs: Math.round(performance.now() - startAt),
        })
        return second.result
      }

      console.warn('[Drive115] Pro/Web API 均失败', { pro: first.from === 'pro' ? first.error : second.error, web: first.from === 'web' ? first.error : second.error })
      throw (first.from === 'pro' ? second.error : first.error)
    })()

    pickCodeInflight.set(pickcode, task)
    try {
      return await task
    }
    finally {
      pickCodeInflight.delete(pickcode)
    }
  }

  /**
   * 获取 M3U8 根 URL
   */
  getM3u8Url(pickcode: string): string {
    return `${NORMAL_URL}/api/video/m3u8/${pickcode}.m3u8`
  }

  /**
   * 解析 M3U8 列表
   */
  async getM3u8Info(url: string, pickcode: string): Promise<M3u8Item[]> {
    const response = await this.req.get(url, {
      headers: { 
        'Accept': '*/*'
      },
    })

    const htmlText = await response.text()

    if (!htmlText.startsWith('#')) {
      let res: VideoM3u8Res | undefined
      try {
        res = JSON.parse(htmlText) as VideoM3u8Res
      }
      catch {
        throw new Drive115Error.NotFoundM3u8()
      }

      if (res && res.state === false) {
        if (res.code === 911) {
          console.warn('[Drive115] 需要人机验证')
          // 跳转验证页
          window.open(`${VOD_URL}/?pickcode=${pickcode}`, '_blank')
        }
        throw new Error(`获取 m3u8 失败: ${res.error}`)
      }
    }

    const lines = htmlText.split('\n')
    const m3u8List: M3u8Item[] = []

    lines.forEach((line, index) => {
      if (line.includes('NAME="')) {
        if (line.match(/#EXT-X-STREAM-INF/)) {
          const name = line.match(/NAME="([^"]*)"/)?.[1] ?? ''
          const url = lines[index + 1]?.trim()
          m3u8List.push({
            name,
            quality: qualityCodeMap[name] ?? 0,
            url: getXUrl(url),
          })
        }
      }
    })

    // 按画质从高到低排序
    m3u8List.sort((a, b) => b.quality - a.quality)
    return m3u8List
  }

  /**
   * 获取 M3U8 列表
   */
  async getM3u8(pickcode: string): Promise<M3u8Item[]> {
    const url = this.getM3u8Url(pickcode)
    return this.getM3u8Info(url, pickcode)
  }

  /**
   * 获取文件列表
   */
  async getFiles(params: Record<string, string | number>): Promise<FilesRes> {
    try {
      const query = new URLSearchParams(params as Record<string, string>).toString()
      const res = await this.req.getJson<FilesRes>(
        `${WEB_API_URL}/files?${query}`,
      )
      if (res.state) return res
      throw new Error('获取文件列表失败')
    }
    catch {
      // 降级到旧接口
      const query = new URLSearchParams(params as Record<string, string>).toString()
      const res = await this.req.getJson<FilesRes>(
        `${APS_URL}/natsort/files.php?${query}`,
      )
      if (res.state) return res
      throw new Error(`获取文件列表失败: ${JSON.stringify(res)}`)
    }
  }

  /**
   * 获取播放列表
   */
  async getPlaylist(cid: string, offset = 0) {
    return this.getFiles({
      aid: 1,
      cid,
      offset,
      limit: 1150,
      show_dir: 0,
      nf: '',
      qid: 0,
      type: 4,
      source: '',
      format: 'json',
      star: '',
      is_q: '',
      is_share: '',
      r_all: 1,
      o: 'file_name',
      asc: 1,
      cur: 1,
      natsort: 1,
    })
  }

  /**
   * 获取视频文件信息
   */
  async getFilesVideo(params: Record<string, string>) {
    const query = new URLSearchParams(params).toString()
    return this.req.getJson<FilesVideoRes>(
      `${WEB_API_URL}/files/video?${query}`,
    )
  }

  /**
   * 设置下载 cookie（用于播放鉴权）
   */
  async setDownloadCookie(cookie: NonNullable<DownloadResult['url']['auth_cookie']>): Promise<void> {
    if (typeof chrome !== 'undefined' && chrome.cookies) {
      await chrome.cookies.set({
        url: DL_URL,
        name: cookie.name,
        value: cookie.value,
        path: cookie.path,
        domain: '.115cdn.net',
        secure: true,
        expirationDate: Number(cookie.expire),
        sameSite: 'no_restriction',
      })
    }
  }
}

export const drive115 = new Drive115()
