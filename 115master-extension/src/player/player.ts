/**
 * 播放器页面逻辑
 */

import Artplayer from 'artplayer'
import Hls from 'hls.js'
import { drive115 } from '../lib'
import type { M3u8Item } from '../lib/types'

interface PlayerConfig {
  pickCode: string
}

interface QualityOption {
  label: string
  quality: number
  url: string
}

interface VideoPlaybackQualityLike {
  droppedVideoFrames?: number
  totalVideoFrames?: number
}

class PlayerManager {
  private artplayer: Artplayer | null = null
  private hlsInstance: Hls | null = null
  private m3u8List: M3u8Item[] = []
  private currentPickCode: string
  private isNativeVideo = false
  private ultraUrl: string | null = null
  private qualityOptions: QualityOption[] = []
  private currentQuality = 0
  private currentQualityLabel = '加载中'
  private infoFpsTimer: number | null = null

  constructor(config: PlayerConfig) {
    this.currentPickCode = config.pickCode
    this.init()
  }

  private getPrefetchUltraUrl() {
    return chrome.runtime.sendMessage({
      type: 'GET_PREFETCH_VIDEO_SOURCE',
      data: { pickCode: this.currentPickCode },
    }) as Promise<{ url: string, fromCache: boolean } | null>
  }

  private async init() {
    try {
      const loadingTextEl = document.getElementById('loading-text')
      if (loadingTextEl) {
        loadingTextEl.textContent = '正在优先获取无损画质...'
      }

      const m3u8Promise = drive115.getM3u8(this.currentPickCode)
        .then((list) => {
          this.m3u8List = list
          return list
        })

      const ultraPromise = this.getPrefetchUltraUrl()
        .then((prefetched) => {
          if (prefetched?.url) {
            this.ultraUrl = prefetched.url
            return prefetched.url
          }
          throw new Error('miss')
        })
        .catch(async () => {
          const downloadResult = await drive115.getFileDownloadUrl(this.currentPickCode)
          const url = downloadResult.url?.url
          const authCookie = downloadResult.url?.auth_cookie
          if (!url) throw new Error('未获取到 Ultra 下载地址')

          this.ultraUrl = url
          if (authCookie) {
            await drive115.setDownloadCookie(authCookie)
          }
          return url
        })

      let firstPlayable: { type: 'native' | 'hls', url: string }
      try {
        const ultraUrl = await ultraPromise
        firstPlayable = { type: 'native', url: ultraUrl }
      }
      catch {
        const list = await m3u8Promise
        if (!list[0]) {
          throw new Error('M3U8 empty')
        }
        firstPlayable = { type: 'hls', url: list[0].url }
      }

      this.isNativeVideo = firstPlayable.type === 'native'
      this.currentQuality = this.isNativeVideo ? 9999 : (this.m3u8List[0]?.quality ?? 0)
      this.currentQualityLabel = this.isNativeVideo
        ? '无损'
        : this.getQualityDisplayName(this.m3u8List[0]?.quality ?? 0, true)
      this.createArtplayer(firstPlayable.url, firstPlayable.type)

      void Promise.allSettled([m3u8Promise, ultraPromise]).then(() => {
        this.qualityOptions = this.buildQualityOptions(this.artplayer?.url || firstPlayable.url)
        this.updateQualityByUrl(this.artplayer?.url || firstPlayable.url)
        this.renderQualityPanel()
        this.updateQualityButton()
      })

      void this.loadPlayHistory()
    }
    catch (error) {
      this.showError(`播放器初始化失败: ${error instanceof Error ? error.message : String(error)}`)
    }
    finally {
      const loadingEl = document.getElementById('loading')
      if (loadingEl) loadingEl.style.display = 'none'
    }
  }

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

  private createArtplayer(videoUrl: string, type: 'native' | 'hls') {
    const container = document.getElementById('artplayer-app')
    if (!container) throw new Error('找不到播放器容器')

    this.qualityOptions = this.buildQualityOptions(videoUrl)

    this.artplayer = new Artplayer({
      container: container as HTMLDivElement,
      url: videoUrl,
      volume: 1,
      autoplay: true,
      pip: false,
      autoMini: true,
      screenshot: false,
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
          name: 'quality-label',
          position: 'right',
          html: '<span id="quality-control-label">画质: 加载中</span>',
          index: 10,
          tooltip: '选择画质',
          style: {
            marginRight: '20px',
          },
          click: () => {
            const panel = document.getElementById('quality-panel')
            panel?.classList.toggle('hidden')
          },
        },
      ],
      contextmenu: [],
      customType: {
        m3u8: async (video, url) => {
          if (this.artplayer && Hls.isSupported()) {
            this.initHls(video as HTMLVideoElement, url)
          }
          else {
            this.showError('您的浏览器不支持 HLS 播放')
          }
        },
      },
    })

    if (type === 'native') {
      this.currentQuality = 9999
      this.currentQualityLabel = '无损'
    }

    this.setupTopNav()
    this.renderQualityPanel()
    this.updateQualityButton()
    void this.loadThumbnails()

    if (this.artplayer) {
      this.patchArtInfoPanel()

      this.artplayer.on('video:timeupdate', () => {
        this.savePlayHistory()
      })

      this.artplayer.on('video:loadedmetadata', () => {
        this.updateQualityByUrl(this.artplayer?.url || '')
        this.updateQualityButton()
        this.renderQualityPanel()
      })

      this.artplayer.on('error', () => {
        if (this.isNativeVideo) {
          this.fallbackToHls()
        }
      })

      this.setupKeyboardShortcuts()
    }
  }

  private buildQualityOptions(currentUrl: string): QualityOption[] {
    const options: QualityOption[] = []

    if (this.ultraUrl) {
      options.push({
        label: '无损',
        quality: 9999,
        url: this.ultraUrl,
      })
    }

    this.m3u8List.forEach((item) => {
      options.push({
        label: this.getQualityDisplayName(item.quality, true),
        quality: item.quality,
        url: item.url,
      })
    })

    if (options.length === 0 && currentUrl) {
      options.push({
        label: this.currentQualityLabel,
        quality: this.currentQuality,
        url: currentUrl,
      })
    }

    const dedup = new Map<string, QualityOption>()
    options.forEach((opt) => {
      if (!dedup.has(opt.url)) {
        dedup.set(opt.url, opt)
      }
    })

    return Array.from(dedup.values()).sort((a, b) => {
      const rank = (label: string, quality: number) => {
        if (label === '无损') return 10000
        if (label === '115原画') return 9999
        return quality
      }
      return rank(b.label, b.quality) - rank(a.label, a.quality)
    })
  }

  private updateQualityByUrl(url: string) {
    const hit = this.qualityOptions.find(opt => opt.url === url)
    if (hit) {
      this.currentQuality = hit.quality
      this.currentQualityLabel = hit.label
      this.isNativeVideo = !!this.ultraUrl && hit.url === this.ultraUrl
    }
  }

  private updateQualityButton() {
    const labelEl = document.getElementById('quality-control-label')
    if (!labelEl) return
    labelEl.textContent = `画质: ${this.currentQualityLabel}`
  }

  private renderQualityPanel() {
    const list = document.getElementById('quality-list')
    if (!list) return
    list.innerHTML = ''

    this.qualityOptions.forEach((opt) => {
      const btn = document.createElement('button')
      const active = this.artplayer?.url === opt.url
      btn.className = `text-left px-3 py-2 rounded-lg text-sm transition-colors ${active ? 'bg-white/20 text-white' : 'text-white/80 hover:bg-white/10'}`
      btn.textContent = opt.label
      btn.addEventListener('click', async (e) => {
        e.stopPropagation()
        await this.switchQuality(opt)
        document.getElementById('quality-panel')?.classList.add('hidden')
      })
      list.appendChild(btn)
    })
  }

  private async switchQuality(opt: QualityOption) {
    if (!this.artplayer || this.artplayer.url === opt.url) return

    const currentTime = this.artplayer.currentTime || 0
    const wasPlaying = !this.artplayer.video.paused

    this.currentQuality = opt.quality
    this.currentQualityLabel = opt.label
    this.isNativeVideo = !!this.ultraUrl && opt.url === this.ultraUrl
    this.updateQualityButton()
    this.renderQualityPanel()

    this.artplayer.switchUrl(opt.url)
    this.artplayer.once('video:loadedmetadata', () => {
      if (!this.artplayer) return
      this.artplayer.seek = currentTime
      if (wasPlaying) {
        void this.artplayer.play()
      }
    })
  }

  private setupTopNav() {
    const urlParams = new URLSearchParams(window.location.search)
    const title = urlParams.get('title') || '视频播放'

    const titleEl = document.getElementById('video-title')
    const backBtn = document.getElementById('btn-back')
    const qualityPanel = document.getElementById('quality-panel')

    if (titleEl) {
      titleEl.textContent = title
    }
    document.title = title

    backBtn?.addEventListener('click', () => {
      if (window.history.length > 1) {
        window.history.back()
      }
      else {
        window.close()
      }
    })

    document.addEventListener('click', () => {
      qualityPanel?.classList.add('hidden')
    })
  }

  private async loadThumbnails() {
    if (!this.artplayer) return
    try {
      const { getVideoCovers } = await import('../lib/videoThumbnail')

      let duration = this.artplayer.duration
      if (!duration || duration < 5) {
        await new Promise<void>((resolve) => {
          this.artplayer!.once('video:loadedmetadata', () => resolve())
          setTimeout(resolve, 5000)
        })
        duration = this.artplayer.duration
      }

      if (!duration) return

      const covers = await getVideoCovers(this.currentPickCode, duration, 30)
      if (covers.length === 0 || !this.artplayer) return

      let vtt = 'WEBVTT\n\n'
      covers.forEach((c) => {
        const tDuration = duration / covers.length
        const startTime = this.formatVttTime(Math.max(0, c.time - tDuration / 2))
        const endTime = this.formatVttTime(Math.min(duration, c.time + tDuration / 2))
        vtt += `${startTime} --> ${endTime}\n${c.imgUrl}\n\n`
      })

      const blob = new Blob([vtt], { type: 'text/vtt' })
      const vttUrl = URL.createObjectURL(blob)
      this.artplayer.emit('artplayerPluginThumbnail:update', { url: vttUrl })
    }
    catch {
      // ignore thumbnail errors
    }
  }

  private formatVttTime(seconds: number) {
    const h = Math.floor(seconds / 3600).toString().padStart(2, '0')
    const m = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0')
    const s = (seconds % 60).toFixed(3).padStart(6, '0')
    return `${h}:${m}:${s}`
  }

  private getQualityDisplayName(quality: number, fromM3u8 = false): string {
    const map: Record<number, string> = {
      9999: fromM3u8 ? '115原画' : '无损',
      2160: '4K',
      1080: '1080P',
      720: '720P',
      480: '480P',
      360: '360P',
    }
    return map[quality] || '自动'
  }

  private fallbackToHls() {
    if (!this.artplayer || this.m3u8List.length === 0) {
      this.showError('播放失败，无可用的视频源')
      return
    }

    const bestQuality = this.m3u8List[0]
    this.isNativeVideo = false
    this.currentQuality = bestQuality.quality
    this.currentQualityLabel = this.getQualityDisplayName(bestQuality.quality, true)
    this.updateQualityButton()
    this.renderQualityPanel()
    this.artplayer.switchUrl(bestQuality.url)
  }

  private async loadPlayHistory() {
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'GET_HISTORY',
        data: { pickCode: this.currentPickCode },
      })

      if (response && response.currentTime) {
        setTimeout(() => {
          if (this.artplayer) {
            this.artplayer.seek = response.currentTime
          }
        }, 500)
      }
    }
    catch {
      // ignore history errors
    }
  }

  private savePlayHistory() {
    if (!this.artplayer) return

    const currentTime = this.artplayer.currentTime
    const duration = this.artplayer.duration
    if (!duration || currentTime < 5) return

    const lastSaveTime = Number.parseInt(sessionStorage.getItem('lastSaveTime') || '0', 10)
    const now = Date.now()
    if (now - lastSaveTime < 10000) return
    sessionStorage.setItem('lastSaveTime', now.toString())

    void chrome.runtime.sendMessage({
      type: 'SET_HISTORY',
      data: {
        pickCode: this.currentPickCode,
        fileName: this.currentPickCode,
        currentTime,
        duration,
        quality: this.currentQualityLabel,
      },
    })
  }

  private setupKeyboardShortcuts() {
    if (!this.artplayer) return

    document.addEventListener('keydown', (e) => {
      if (e.code === 'Space') {
        e.preventDefault()
        this.artplayer!.toggle()
      }
      else if (e.code === 'ArrowLeft') {
        this.artplayer!.seek = this.artplayer!.currentTime - 5
      }
      else if (e.code === 'ArrowRight') {
        this.artplayer!.seek = this.artplayer!.currentTime + 5
      }
      else if (e.code === 'ArrowUp') {
        e.preventDefault()
        this.artplayer!.volume = Math.min(1, this.artplayer!.volume + 0.1)
      }
      else if (e.code === 'ArrowDown') {
        e.preventDefault()
        this.artplayer!.volume = Math.max(0, this.artplayer!.volume - 0.1)
      }
      else if (e.code === 'KeyF') {
        this.artplayer!.fullscreen = !this.artplayer!.fullscreen
      }
      else if (e.code === 'KeyP') {
        // reserved for future PIP feature
      }
    })
  }

  private showError(message: string) {
    const container = document.getElementById('artplayer-app')
    if (container) {
      container.innerHTML = `
        <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;color:#ff4d4f;font-size:18px;">
          <div style="font-size:48px;margin-bottom:20px;">⚠️</div>
          <div>${message}</div>
        </div>
      `
    }
  }

  private patchArtInfoPanel() {
    if (!this.artplayer) return

    const template = this.artplayer.template
    const info = template.$info
    const titleNodes = info.querySelectorAll('.art-info-title')

      const map = [
        '播放器版本：',
        '视频地址：',
        '音量：',
        '当前时间：',
        '总时长：',
        '分辨率：',
      ]

    titleNodes.forEach((node, index) => {
      const text = map[index]
      if (text) {
        node.textContent = text
      }
    })

    const urlField = info.querySelector('[data-video="currentSrc"]') as HTMLElement | null
    if (urlField) {
      const raw = (urlField.textContent || '').replace(/\s*（[^）]+）\s*$/, '')
      const isBlob = raw.startsWith('blob:')
      const sourceMark = isBlob
        ? (this.isNativeVideo ? '（无损链路）' : '（115原画链路）')
        : (this.isNativeVideo ? '（无损链路）' : '（115原画链路）')
      urlField.textContent = `${raw} ${sourceMark}`
    }

    const closeBtn = info.querySelector('.art-info-close') as HTMLElement | null
    if (closeBtn) {
      closeBtn.textContent = '关闭'
    }

    const panel = info.querySelector('.art-info-panel')
    if (!panel) return

    let fpsItem = info.querySelector('[data-115master="fps"]') as HTMLElement | null
    if (!fpsItem) {
      fpsItem = document.createElement('div')
      fpsItem.className = 'art-info-item'
      fpsItem.setAttribute('data-115master', 'fps')
      fpsItem.innerHTML = '<div class="art-info-title">当前帧率：</div><div class="art-info-content" data-115master-fps>-- FPS</div>'
      panel.appendChild(fpsItem)
    }

    const fpsTarget = info.querySelector('[data-115master-fps]') as HTMLElement | null
    const video = this.artplayer.video as HTMLVideoElement

    const getTotalFrames = () => {
      const qualityInfo = (video.getVideoPlaybackQuality?.() || {}) as VideoPlaybackQualityLike
      if (qualityInfo.totalVideoFrames && qualityInfo.totalVideoFrames > 0) {
        return qualityInfo.totalVideoFrames
      }
      const decoded = (video as HTMLVideoElement & { webkitDecodedFrameCount?: number }).webkitDecodedFrameCount
      if (typeof decoded === 'number' && decoded > 0) {
        return decoded
      }
      return 0
    }

    let lastTime = performance.now()
    let lastFrame = getTotalFrames()

    const update = () => {
      if (!this.artplayer) return

      const total = getTotalFrames()
      const now = performance.now()
      const dt = (now - lastTime) / 1000
      const df = total - lastFrame
      let fps = dt > 0 ? Math.max(0, df / dt) : 0

      if (fps <= 0 && total > 0 && video.currentTime > 0) {
        fps = total / video.currentTime
      }

      if (fpsTarget) {
        fpsTarget.textContent = `${fps.toFixed(1)} FPS`
      }
      lastTime = now
      lastFrame = total
    }

    update()
    if (this.infoFpsTimer) {
      window.clearInterval(this.infoFpsTimer)
    }
    this.infoFpsTimer = window.setInterval(update, 1000)
  }

  destroy() {
    if (this.infoFpsTimer) {
      window.clearInterval(this.infoFpsTimer)
      this.infoFpsTimer = null
    }
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

let playerManager: PlayerManager | null = null

function initPlayer() {
  const urlParams = new URLSearchParams(window.location.search)
  const pickCode = urlParams.get('pickCode')

  if (!pickCode) {
    const el = document.getElementById('artplayer-app')
    if (el) {
      el.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100vh;color:#ff4d4f;font-size:18px;">缺少 pickCode 参数</div>'
    }
    return
  }

  playerManager = new PlayerManager({ pickCode })
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initPlayer)
}
else {
  initPlayer()
}

window.addEventListener('beforeunload', () => {
  playerManager?.destroy()
})

;(window as any).playerManager = playerManager
