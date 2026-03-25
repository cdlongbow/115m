/**
 * 播放器页面逻辑
 * 功能：
 * - Artplayer 初始化
 * - Ultra 画质播放（原生硬解）
 * - hls.js 降级播放
 * - 多画质切换
 * - 播放历史记录
 * - 调试模式
 */

import Artplayer from 'artplayer'
import Hls from 'hls.js'
import { drive115 } from '../lib'
import type { M3u8Item } from '../lib/types'

/**
 * 播放器配置
 */
interface PlayerConfig {
  pickCode: string
}

/**
 * 画质选项接口
 */
interface QualityOption {
  html: string
  quality: number
  url: string
}

/**
 * 播放器管理器
 */
class PlayerManager {
  private artplayer: Artplayer | null = null
  private hlsInstance: Hls | null = null
  private m3u8List: M3u8Item[] = []
  private currentPickCode: string
  private isNativeVideo: boolean = false

  constructor(config: PlayerConfig) {
    this.currentPickCode = config.pickCode
    this.init()
  }

  /**
   * 初始化播放器
   */
  private async init() {
    try {
      console.log('[115Master Player] 初始化播放器, pickCode:', this.currentPickCode)

      // 获取 M3U8 列表
      this.m3u8List = await drive115.getM3u8(this.currentPickCode)
      console.log('[115Master Player] M3U8 列表:', this.m3u8List)

      if (this.m3u8List.length === 0) {
        throw new Error('未找到可播放的视频源')
      }

      // 获取 Ultra 画质下载地址
      const downloadResult = await drive115.getFileDownloadUrl(this.currentPickCode)
      const ultraUrl = downloadResult.url?.url

      if (ultraUrl) {
        // 有 Ultra 下载地址，优先使用原生视频播放
        this.isNativeVideo = true
        console.log('[115Master Player] 使用 Ultra 画质（原生视频）:', ultraUrl)

        // 设置 cookie
        if (downloadResult.url?.auth_cookie) {
          await drive115.setDownloadCookie(downloadResult.url.auth_cookie)
        }

        this.createArtplayer(ultraUrl, 'native')
      }
      else {
        // 没有 Ultra 下载地址，使用 hls.js 播放 M3U8
        this.isNativeVideo = false
        const bestQuality = this.m3u8List[0]
        console.log('[115Master Player] 使用 hls.js 播放, 画质:', bestQuality.name)

        this.createArtplayer(bestQuality.url, 'hls')
      }

      // 加载播放历史
      this.loadPlayHistory()
    }
    catch (error) {
      console.error('[115Master Player] 初始化失败:', error)
      this.showError(`播放器初始化失败: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      const loadingEl = document.getElementById('loading')
      if (loadingEl) loadingEl.style.display = 'none'
    }
  }

  /**
   * 初始化 HLS 实例
   */
  private initHls(video: HTMLVideoElement, url: string): Hls {
    const hls = new Hls({
      enableWorker: true,
      lowLatencyMode: true,
      backBufferLength: 90,
    })
    hls.loadSource(url)
    hls.attachMedia(video)
    this.hlsInstance = hls
    return hls
  }

  /**
   * 创建 Artplayer 实例
   */
  private createArtplayer(videoUrl: string, type: 'native' | 'hls') {
    const container = document.getElementById('artplayer-app')
    if (!container) {
      throw new Error('找不到播放器容器')
    }

    // 获取 URL 参数中的 pickCode
    const urlParams = new URLSearchParams(window.location.search)
    const pickCode = urlParams.get('pickCode') || ''

    // 构建画质切换选项
    const qualityOptions = this.buildQualityOptions(videoUrl, type)

    this.artplayer = new Artplayer({
      container: container as HTMLDivElement,
      url: videoUrl,
      volume: 1,
      isLive: false,
      muted: false,
      autoplay: true,
      pip: true,
      autoSize: true,
      autoMini: true,
      screenshot: true,
      setting: true,
      loop: true,
      flip: true,
      playbackRate: true,
      aspectRatio: true,
      fullscreen: true,
      fullscreenWeb: true,
      miniProgressBar: true,
      theme: '#1890ff',
      lang: 'zh-cn',
      controls: [
        {
          position: 'right',
          html: '画质',
          index: 10,
          tooltip: '画质切换',
          style: {
            marginRight: '20px',
          },
          click: async () => {
            this.showQualitySelector()
          },
        },
      ],
      customType: {
        m3u8: async (video, url) => {
          if (this.artplayer && Hls.isSupported()) {
            const hls = this.initHls(video as HTMLVideoElement, url)
            console.log('[115Master Player] HLS 播放器初始化成功')
          }
          else {
            console.error('[115Master Player] HLS 不支持')
            this.showError('您的浏览器不支持 HLS 播放')
          }
        },
      },
    })

    // 监听播放进度，保存历史
    if (this.artplayer) {
      this.artplayer.on('video:timeupdate', () => {
        this.savePlayHistory()
      })

      // 播放错误处理
      this.artplayer.on('error', (error) => {
        console.error('[115Master Player] 播放错误:', error)
        if (this.isNativeVideo) {
          // 如果原生播放失败，尝试降级到 hls.js
          console.log('[115Master Player] 原生播放失败，尝试降级到 hls.js')
          this.fallbackToHls()
        }
      })

      // 添加键盘快捷键
      this.setupKeyboardShortcuts()
    }

    console.log('[115Master Player] Artplayer 创建成功, type:', type)
  }

  /**
   * 构建画质切换选项
   */
  private buildQualityOptions(currentUrl: string, currentType: 'native' | 'hls'): QualityOption[] {
    const options: QualityOption[] = []

    // 添加 Ultra 画质（如果可用）
    if (currentType === 'native') {
      options.push({
        html: '<span style="color: #ff4d4f;">Ultra</span>',
        quality: 9999,
        url: currentUrl,
      })
    }

    // 添加 M3U8 画质选项
    this.m3u8List.forEach((item) => {
      const qualityName = this.getQualityDisplayName(item.quality)
      options.push({
        html: qualityName,
        quality: item.quality,
        url: item.url,
      })
    })

    return options
  }

  /**
   * 获取画质显示名称
   */
  private getQualityDisplayName(quality: number): string {
    const map: Record<number, string> = {
      9999: 'Ultra',
      2160: '4K',
      1080: '1080P',
      720: '720P',
      480: '480P',
      360: '360P',
    }
    return map[quality] || `${quality}P`
  }

  /**
   * 显示画质选择器
   */
  private showQualitySelector() {
    if (!this.artplayer) return

    const options = this.buildQualityOptions(
      this.artplayer.url || '',
      this.isNativeVideo ? 'native' : 'hls',
    )

    // 简单的画质切换 UI
    const currentQuality = (this.artplayer as any).qualityIndex ?? -1
    const nextIndex = (currentQuality + 1) % options.length
    const nextQuality = options[nextIndex]

    console.log('[115Master Player] 切换画质:', nextQuality)

    // 切换视频源
    this.artplayer.switchUrl(nextQuality.url)
  }

  /**
   * 降级到 hls.js
   */
  private fallbackToHls() {
    if (!this.artplayer || this.m3u8List.length === 0) {
      this.showError('播放失败，无可用的视频源')
      return
    }

    console.log('[115Master Player] 降级到 hls.js')

    this.isNativeVideo = false
    const bestQuality = this.m3u8List[0]

    if (this.artplayer) {
      this.artplayer.switchUrl(bestQuality.url)
      console.log('[115Master Player] 降级成功')
    }
  }

  /**
   * 加载播放历史
   */
  private async loadPlayHistory() {
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'GET_HISTORY',
        data: { pickCode: this.currentPickCode },
      })

      if (response && response.currentTime) {
        console.log('[115Master Player] 加载播放历史:', response.currentTime)
        // 跳转到上次播放位置
        setTimeout(() => {
          if (this.artplayer) {
            this.artplayer.seek = response.currentTime
          }
        }, 500)
      }
    }
    catch (error) {
      console.error('[115Master Player] 加载播放历史失败:', error)
    }
  }

  /**
   * 保存播放历史
   */
  private savePlayHistory() {
    if (!this.artplayer) return

    const currentTime = this.artplayer.currentTime
    const duration = this.artplayer.duration

    // 只在视频加载完成后保存
    if (!duration || currentTime < 5) return

    // 每 10 秒保存一次
    const lastSaveTime = Number.parseInt(sessionStorage.getItem('lastSaveTime') || '0', 10)
    const now = Date.now()
    if (now - lastSaveTime < 10000) return

    sessionStorage.setItem('lastSaveTime', now.toString())

    chrome.runtime.sendMessage({
      type: 'SET_HISTORY',
      data: {
        pickCode: this.currentPickCode,
        fileName: this.currentPickCode,
        currentTime,
        duration,
        quality: this.isNativeVideo ? 'Ultra' : 'HLS',
      },
    }).catch((error) => {
      console.error('[115Master Player] 保存播放历史失败:', error)
    })
  }

  /**
   * 设置键盘快捷键
   */
  private setupKeyboardShortcuts() {
    if (!this.artplayer) return

    document.addEventListener('keydown', (e) => {
      // 空格：播放/暂停
      if (e.code === 'Space') {
        e.preventDefault()
        this.artplayer!.toggle()
      }
      // 左右箭头：快退/快进
      else if (e.code === 'ArrowLeft') {
        this.artplayer!.seek = this.artplayer!.currentTime - 5
      }
      else if (e.code === 'ArrowRight') {
        this.artplayer!.seek = this.artplayer!.currentTime + 5
      }
      // 上下箭头：音量调节
      else if (e.code === 'ArrowUp') {
        e.preventDefault()
        this.artplayer!.volume = Math.min(1, this.artplayer!.volume + 0.1)
      }
      else if (e.code === 'ArrowDown') {
        e.preventDefault()
        this.artplayer!.volume = Math.max(0, this.artplayer!.volume - 0.1)
      }
      // F 键：全屏
      else if (e.code === 'KeyF') {
        this.artplayer!.fullscreen = !this.artplayer!.fullscreen
      }
      // P 键：画中画
      else if (e.code === 'KeyP') {
        this.artplayer!.pip = !this.artplayer!.pip
      }
    })
  }

  /**
   * 显示错误
   */
  private showError(message: string) {
    const container = document.getElementById('artplayer-app')
    if (container) {
      container.innerHTML = `
        <div style="
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          height: 100vh;
          color: #ff4d4f;
          font-size: 18px;
        ">
          <div style="font-size: 48px; margin-bottom: 20px;">⚠️</div>
          <div>${message}</div>
        </div>
      `
    }
  }

  /**
   * 销毁播放器
   */
  destroy() {
    if (this.hlsInstance) {
      this.hlsInstance.destroy()
      this.hlsInstance = null
    }
    if (this.artplayer) {
      this.artplayer.destroy()
      this.artplayer = null
    }
  }
}

/**
 * 初始化播放器
 */
let playerManager: PlayerManager | null = null

function initPlayer() {
  const urlParams = new URLSearchParams(window.location.search)
  const pickCode = urlParams.get('pickCode')

  if (!pickCode) {
    console.error('[115Master Player] 缺少 pickCode 参数')
    document.getElementById('artplayer-app')!.innerHTML = `
      <div style="
        display: flex;
        align-items: center;
        justify-content: center;
        height: 100vh;
        color: #ff4d4f;
        font-size: 18px;
      ">
        缺少 pickCode 参数
      </div>
    `
    return
  }

  playerManager = new PlayerManager({ pickCode })
}

// 页面加载完成后初始化
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initPlayer)
}
else {
  initPlayer()
}

// 页面卸载时清理
window.addEventListener('beforeunload', () => {
  playerManager?.destroy()
})

// 导出供调试使用
;(window as any).playerManager = playerManager
