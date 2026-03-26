/**
 * 播放器页面逻辑
 */

import Artplayer from 'artplayer'
import Hls from 'hls.js'
import type { M3u8Item } from '../lib/types'
import { buildArtplayerQuality, buildQualityOptions, getQualityDisplayName, ORIGINAL_PLACEHOLDER_URL } from './core/quality'
import { fetchM3u8WithRetry, fetchUltraSource } from './core/source'
import { loadPlayHistory, savePlayHistory } from './core/history'
import type { QualityOption, VideoPlaybackQualityLike } from './core/types'
import { clamp, findNearestCover, formatTimeLabel, formatVttTime } from './core/hover-utils'
import { runPlayerSmokeChecks } from './core/smoke'
import { applyTopNavFromQuery, createHoverPreviewElements, findProgressElement, renderPlayerError } from './core/dom'
import { bindKeyboardShortcuts } from './core/keyboard'

interface PlayerConfig {
  pickCode: string
  traceId?: string
  clickTs?: number
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
  private hoverCovers: Array<{ time: number, imgUrl: string }> = []
  private hoverPreviewEl: HTMLDivElement | null = null
  private hoverPreviewImgEl: HTMLImageElement | null = null
  private hoverPreviewTimeEl: HTMLDivElement | null = null
  private hoverProgressEl: HTMLElement | null = null
  private hoverBindRetryTimer: number | null = null
  private ultraSwitchAborted = false
  private thumbnailsLoading = false
  private thumbnailsLoaded = false
  private traceId = ''
  private clickTs = 0
  private initStartTs = 0
  private perfMarks: Partial<Record<'init' | 'ultraReady' | 'loadedmetadata' | 'canplay' | 'playing', number>> = {}
  private firstPlayingReported = false
  private cleanupKeyboard: (() => void) | null = null

  constructor(config: PlayerConfig) {
    this.currentPickCode = config.pickCode
    this.traceId = config.traceId || `${config.pickCode}-${Date.now()}`
    this.clickTs = config.clickTs || 0
    this.initStartTs = performance.now()
    this.perfMarks.init = this.initStartTs
    runPlayerSmokeChecks()
    this.init()
  }

  private perf(stage: string, extra?: Record<string, unknown>) {
    const now = performance.now()
    const payload = {
      stage,
      traceId: this.traceId,
      pickCode: this.currentPickCode,
      clickToNowMs: this.clickTs > 0 ? Math.round(Date.now() - this.clickTs) : -1,
      initCostMs: Math.round(now - this.initStartTs),
      ...extra,
    }
    console.log('[115m][Perf]', payload)
  }

  private reportFirstFrameSummary() {
    if (this.firstPlayingReported) return
    const p = this.perfMarks
    if (!p.playing || !p.init) return
    this.firstPlayingReported = true

    const clickToPlay = this.clickTs > 0 ? Math.round(Date.now() - this.clickTs) : -1
    const initToUltra = p.ultraReady ? Math.round(p.ultraReady - p.init) : -1
    const ultraToMeta = p.ultraReady && p.loadedmetadata ? Math.round(p.loadedmetadata - p.ultraReady) : -1
    const metaToPlay = p.loadedmetadata ? Math.round(p.playing - p.loadedmetadata) : -1
    const initToPlay = Math.round(p.playing - p.init)

    console.log('[115m][首播耗时]', {
      traceId: this.traceId,
      pickCode: this.currentPickCode,
      clickToPlayMs: clickToPlay,
      initToPlayMs: initToPlay,
      initToUltraMs: initToUltra,
      ultraToLoadedmetadataMs: ultraToMeta,
      loadedmetadataToPlayingMs: metaToPlay,
    })
  }

  private async init() {
    try {
      this.perf('player-init-start')
      const loadingTextEl = document.getElementById('loading-text')
      if (loadingTextEl) {
        loadingTextEl.textContent = '正在获取无损播放源...'
      }

      const ultraSource = await fetchUltraSource(this.currentPickCode).catch(() => null)
      const ultraUrl = ultraSource?.url || null
      if (ultraSource?.ultraUrl) {
        this.ultraUrl = ultraSource.ultraUrl
      }
      this.perfMarks.ultraReady = performance.now()
      this.perf('ultra-source-ready', { ok: !!ultraUrl })

      if (ultraUrl) {
        // 默认无损播放
        this.isNativeVideo = true
        this.currentQuality = 9999
        this.currentQualityLabel = '无损'
        this.createArtplayer(ultraUrl, 'native')
        this.perf('create-player-native')
      }
      else {
        // Ultra 不可用，降级到 HLS
        const m3u8List = await this.fetchM3u8WithRetry().catch(() => null)
        if (m3u8List && m3u8List.length > 0) {
          this.isNativeVideo = false
          this.currentQuality = m3u8List[0].quality
          this.currentQualityLabel = getQualityDisplayName(m3u8List[0].quality, true)
          this.createArtplayer(m3u8List[0].url, 'hls')
          this.perf('create-player-hls-fallback')
        }
        else {
          throw new Error('无法获取任何播放源，请检查网络或是否需要人机验证')
        }
      }

      const currentUrl = this.artplayer?.url || ''
      this.qualityOptions = buildQualityOptions(
        currentUrl,
        this.ultraUrl,
        this.m3u8List,
        this.currentQuality,
        this.currentQualityLabel,
      )
      this.updateQualityByUrl(currentUrl)
      this.renderQualityPanel()
      this.updateQualityButton()

      void loadPlayHistory(this.currentPickCode, (time) => {
        if (this.artplayer) {
          this.artplayer.seek = time
        }
      })
    }
    catch (error) {
      this.showError(`播放器初始化失败: ${error instanceof Error ? error.message : String(error)}`)
    }
    finally {
      const loadingEl = document.getElementById('loading')
      if (loadingEl) loadingEl.style.display = 'none'
    }
  }

  private async fetchUltraSource(): Promise<string> {
    const source = await fetchUltraSource(this.currentPickCode)
    this.ultraUrl = source.ultraUrl
    return source.url
  }

  private async fetchM3u8WithRetry(): Promise<M3u8Item[]> {
    const list = await fetchM3u8WithRetry(this.currentPickCode)
    this.m3u8List = list
    return list
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

    this.qualityOptions = buildQualityOptions(
      videoUrl,
      this.ultraUrl,
      this.m3u8List,
      this.currentQuality,
      this.currentQualityLabel,
    )

    this.artplayer = new Artplayer({
      container: container as HTMLDivElement,
      url: videoUrl,
      volume: 1,
      autoplay: true,
      pip: false,
      autoMini: true,
      screenshot: false,
      setting: true,
      quality: buildArtplayerQuality(this.qualityOptions, videoUrl, this.currentQualityLabel),
      loop: true,
      flip: true,
      playbackRate: true,
      aspectRatio: true,
      fullscreen: true,
      fullscreenWeb: true,
      miniProgressBar: true,
      theme: '#1890ff',
      lang: 'zh-cn',
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
    this.setupProgressHoverPreview()

    if (this.artplayer) {
      this.patchArtInfoPanel()

      this.artplayer.on('ready', () => {
        this.perf('art-ready', { type })
        this.renderQualityPanel()
        this.updateQualityButton()
      })

      this.artplayer.on('video:timeupdate', () => {
        savePlayHistory({
          pickCode: this.currentPickCode,
          fileName: this.currentPickCode,
          currentTime: this.artplayer?.currentTime || 0,
          duration: this.artplayer?.duration || 0,
          quality: this.currentQualityLabel,
        })
      })

      this.artplayer.on('video:loadedmetadata', () => {
        this.perfMarks.loadedmetadata = performance.now()
        this.perf('video-loadedmetadata', { type })
        this.updateQualityByUrl(this.artplayer?.url || '')
        this.updateQualityButton()
        this.renderQualityPanel()
      })

      this.artplayer.on('video:canplay', () => {
        this.perfMarks.canplay = performance.now()
        this.perf('video-canplay', { type })
      })

      this.artplayer.on('video:playing', () => {
        this.perfMarks.playing = performance.now()
        this.perf('video-playing', { type })
        this.reportFirstFrameSummary()
      })

      this.artplayer.on('error', () => {
        if (this.isNativeVideo) {
          void this.fallbackToHls()
        }
      })

      if (this.cleanupKeyboard) {
        this.cleanupKeyboard()
      }
      this.cleanupKeyboard = bindKeyboardShortcuts(this.artplayer)
    }
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
    this.updateQualitySetting()
  }

  private updateQualitySetting() {
    if (!this.artplayer) return
    if (!this.artplayer.quality) return

    const qualityList = buildArtplayerQuality(this.qualityOptions, this.artplayer.url, this.currentQualityLabel)
    this.artplayer.quality = qualityList
  }

  private async switchQuality(opt: QualityOption) {
    if (!this.artplayer) return
    this.ultraSwitchAborted = true // 用户手动切换画质，取消自动切换

    if (opt.url === ORIGINAL_PLACEHOLDER_URL) {
      const resolvedUrl = await this.ensureOriginalSourceLoaded()
      if (!resolvedUrl) {
        this.showError('115原画加载失败，请稍后重试')
        return
      }
      opt = { ...opt, url: resolvedUrl }
    }

    if (this.artplayer.url === opt.url) return

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
    applyTopNavFromQuery()
  }

  private async loadThumbnails() {
    if (!this.artplayer) return
    if (this.thumbnailsLoaded || this.thumbnailsLoading) return
    this.thumbnailsLoading = true
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

      this.hoverCovers = covers

      let vtt = 'WEBVTT\n\n'
      covers.forEach((c) => {
        const tDuration = duration / covers.length
        const startTime = formatVttTime(Math.max(0, c.time - tDuration / 2))
        const endTime = formatVttTime(Math.min(duration, c.time + tDuration / 2))
        vtt += `${startTime} --> ${endTime}\n${c.imgUrl}\n\n`
      })

      const blob = new Blob([vtt], { type: 'text/vtt' })
      const vttUrl = URL.createObjectURL(blob)
      this.artplayer.emit('artplayerPluginThumbnail:update', { url: vttUrl })
      this.thumbnailsLoaded = true
    }
    catch {
      // ignore thumbnail errors
    }
    finally {
      this.thumbnailsLoading = false
    }
  }

  private setupProgressHoverPreview() {
    if (!this.artplayer) return
    this.ensureHoverPreviewElements()
    this.bindProgressHoverEventsWithRetry(0)
  }

  private ensureHoverPreviewElements() {
    if (this.hoverPreviewEl || !this.artplayer) return

    const refs = createHoverPreviewElements(this.artplayer)
    this.hoverPreviewEl = refs.preview
    this.hoverPreviewImgEl = refs.image
    this.hoverPreviewTimeEl = refs.time
  }

  private bindProgressHoverEventsWithRetry(retry: number) {
    if (!this.artplayer) return
    const progress = findProgressElement(this.artplayer)
    if (!progress) {
      if (retry >= 20) return
      this.hoverBindRetryTimer = window.setTimeout(() => {
        this.bindProgressHoverEventsWithRetry(retry + 1)
      }, 300)
      return
    }

    this.hoverProgressEl = progress

    progress.addEventListener('mousemove', this.handleProgressMouseMove)
    progress.addEventListener('mouseenter', this.handleProgressMouseEnter)
    progress.addEventListener('mouseleave', this.handleProgressMouseLeave)
  }

  private handleProgressMouseEnter = () => {
    if (!this.thumbnailsLoaded && !this.thumbnailsLoading) {
      void this.loadThumbnails()
    }
    if (this.hoverPreviewEl && this.hoverCovers.length > 0) {
      this.hoverPreviewEl.style.display = 'block'
    }
  }

  private handleProgressMouseLeave = () => {
    if (this.hoverPreviewEl) {
      this.hoverPreviewEl.style.display = 'none'
    }
  }

  private handleProgressMouseMove = (event: MouseEvent) => {
    if (!this.artplayer || !this.hoverProgressEl || !this.hoverPreviewEl || !this.hoverPreviewImgEl || !this.hoverPreviewTimeEl) {
      return
    }
    if (this.hoverCovers.length === 0 || !this.artplayer.duration) return

    const progressRect = this.hoverProgressEl.getBoundingClientRect()
    if (progressRect.width <= 0) return

    const raw = (event.clientX - progressRect.left) / progressRect.width
    const ratio = clamp(raw, 0, 1)
    const hoverTime = ratio * this.artplayer.duration

    const nearest = findNearestCover(this.hoverCovers, hoverTime)
    if (!nearest) return

    if (nearest?.imgUrl) {
      this.hoverPreviewImgEl.src = nearest.imgUrl
    }
    this.hoverPreviewTimeEl.textContent = formatTimeLabel(hoverTime)

    const containerRect = (this.artplayer.template.$player as HTMLElement).getBoundingClientRect()
    const offsetX = event.clientX - containerRect.left
    const minLeft = 96
    const maxLeft = Math.max(minLeft, containerRect.width - 96)
    const clamped = clamp(offsetX, minLeft, maxLeft)
    this.hoverPreviewEl.style.left = `${clamped}px`
  }


  private async fallbackToHls() {
    if (!this.artplayer) {
      this.showError('播放失败，无可用的视频源')
      return
    }

    if (this.m3u8List.length === 0) {
      this.m3u8List = await fetchM3u8WithRetry(this.currentPickCode).catch(() => this.m3u8List)
    }

    if (this.m3u8List.length === 0) {
      this.showError('播放失败，无可用的视频源')
      return
    }

    const bestQuality = this.m3u8List[0]
    this.isNativeVideo = false
    this.currentQuality = bestQuality.quality
    this.currentQualityLabel = getQualityDisplayName(bestQuality.quality, true)
    this.updateQualityButton()
    this.renderQualityPanel()
    this.artplayer.switchUrl(bestQuality.url)
  }

  private async ensureOriginalSourceLoaded(): Promise<string | null> {
    if (this.m3u8List.length === 0) {
      this.m3u8List = await fetchM3u8WithRetry(this.currentPickCode).catch(() => this.m3u8List)
    }
    if (this.m3u8List.length === 0) return null

    const original = this.m3u8List.find(item => item.quality === 9999) || this.m3u8List[0]
    const currentUrl = this.artplayer?.url || ''
    this.qualityOptions = buildQualityOptions(
      currentUrl,
      this.ultraUrl,
      this.m3u8List,
      this.currentQuality,
      this.currentQualityLabel,
    )
    this.renderQualityPanel()
    return original?.url || null
  }


  private showError(message: string) {
    renderPlayerError(message)
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

    let fpsItem = info.querySelector('[data-115m="fps"]') as HTMLElement | null
    if (!fpsItem) {
      fpsItem = document.createElement('div')
      fpsItem.className = 'art-info-item'
      fpsItem.setAttribute('data-115m', 'fps')
      fpsItem.innerHTML = '<div class="art-info-title">当前帧率：</div><div class="art-info-content" data-115m-fps>-- FPS</div>'
      panel.appendChild(fpsItem)
    }

    const fpsTarget = info.querySelector('[data-115m-fps]') as HTMLElement | null
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
    this.ultraSwitchAborted = true
    if (this.hoverBindRetryTimer) {
      window.clearTimeout(this.hoverBindRetryTimer)
      this.hoverBindRetryTimer = null
    }
    if (this.hoverProgressEl) {
      this.hoverProgressEl.removeEventListener('mousemove', this.handleProgressMouseMove)
      this.hoverProgressEl.removeEventListener('mouseenter', this.handleProgressMouseEnter)
      this.hoverProgressEl.removeEventListener('mouseleave', this.handleProgressMouseLeave)
      this.hoverProgressEl = null
    }
    if (this.hoverPreviewEl) {
      this.hoverPreviewEl.remove()
      this.hoverPreviewEl = null
      this.hoverPreviewImgEl = null
      this.hoverPreviewTimeEl = null
    }
    this.hoverCovers = []

    if (this.infoFpsTimer) {
      window.clearInterval(this.infoFpsTimer)
      this.infoFpsTimer = null
    }
    if (this.cleanupKeyboard) {
      this.cleanupKeyboard()
      this.cleanupKeyboard = null
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
  const traceId = urlParams.get('traceId') || undefined
  const clickTsRaw = urlParams.get('clickTs')
  const clickTs = clickTsRaw ? Number(clickTsRaw) : undefined

  if (!pickCode) {
    const el = document.getElementById('artplayer-app')
    if (el) {
      el.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100vh;color:#ff4d4f;font-size:18px;">缺少 pickCode 参数</div>'
    }
    return
  }

  playerManager = new PlayerManager({ pickCode, traceId, clickTs })
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
