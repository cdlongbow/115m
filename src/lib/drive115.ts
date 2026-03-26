/**
 * 115 Drive API 核心 - 从原项目移植，适配扩展环境
 */
import {
  NORMAL_URL, WEB_API_URL, VOD_URL, APS_URL, DL_URL,
} from './constants'
import { qualityCodeMap } from './types'
import type { M3u8Item } from './types'
import type {
  DownloadResult,
  FilesDownloadRes, VideoM3u8Res,
  FilesRes, FilesVideoRes,
} from './api/types'

export class Drive115Error extends Error {
  static NotFoundM3u8 = class extends Error {
    constructor() { super('Not found m3u8 file') }
  }
}

/**
 * 网络请求封装
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
