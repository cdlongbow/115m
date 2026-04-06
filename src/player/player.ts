/**
 * 播放器页面逻辑
 */

console.log('[115m] player.ts loading...')

import Artplayer from 'artplayer'
import type HlsType from 'hls.js'
import type { M3u8Item } from '../lib/types'
import { buildArtplayerQuality, buildQualityOptions, getQualityDisplayName, ORIGINAL_PLACEHOLDER_URL } from './core/quality'
import { fetchM3u8WithRetry, fetchUltraSource } from './core/source'
import { loadPlayHistory, loadQualityPreference, saveQualityPreference } from './core/history'
import type { QualityOption } from './core/types'
import { runPlayerSmokeChecks } from './core/smoke'
import { renderPlayerError } from './core/dom'
import { createHlsInstance, isHlsSupported } from './core/hls'
import type { VideoPlaybackQualityLike } from './core/types'
import { HoverPreviewController } from './core/hover-preview'
import { bindPlayerEvents } from './core/events'
import { PlayerOverlayController, readOverlayMetaFromQuery, type OverlayPlaylistItem } from './core/overlay'
import { MoveDialog } from './core/move-dialog'
import {
  applyFallbackToHlsState,
  applySelectedQualityOption,
  isOriginalPlaceholderOption,
  type PlaybackState,
  refreshPlaybackQualityState,
  resolveOriginalPlaceholderUrl,
  syncPlaybackStateByUrl,
} from './core/playback-state'
import { ensureServiceWorkerReady, sendRuntimeMessageSafe } from './core/runtime'
import { WEB_API_URL } from '../lib/constants'
import type { FileItem } from '../lib/api/types'
import type { MsgFetchPlaylistResponse } from '../shared/messages'

interface PlayerConfig {
  pickCode: string
  traceId?: string
  clickTs?: number
}

class PlayerManager {
  private static readonly QUALITY_CONTROL_NAME = 'm115-quality-control'
  private artplayer: Artplayer | null = null
  private hlsInstance: HlsType | null = null
  private m3u8List: M3u8Item[] = []
  private currentPickCode: string
  private isNativeVideo = false
  private ultraUrl: string | null = null
  private qualityOptions: QualityOption[] = []
  private currentQuality = 0
  private currentQualityLabel = '加载中'
  private infoMenuTimer: number | null = null
  private infoMenuEl: HTMLElement | null = null
  private hoverPreview: HoverPreviewController | null = null
  private overlay: PlayerOverlayController | null = null
  private playlistItemsCache: OverlayPlaylistItem[] = []
  private playlistLoadingPromise: Promise<OverlayPlaylistItem[]> | null = null
  private autoNextTimer: number | null = null
  private traceId = ''
  private clickTs = 0
  private initStartTs = 0
  private perfMarks: Partial<Record<'init' | 'ultraReady' | 'loadedmetadata' | 'canplay' | 'playing', number>> = {}
  private firstPlayingReported = false
  private _initUrl = ''
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

      // 确保 Service Worker 已就绪（冷启动时可能需要等待）
      const loadingTextEl = document.getElementById('loading-text')
      if (loadingTextEl) {
        loadingTextEl.textContent = '正在初始化...'
      }
      await ensureServiceWorkerReady()

      // 1. 先读取画质偏好（纯本地 localStorage，瞬间完成）
      const qualityPref = await loadQualityPreference(this.currentPickCode)
      console.log('[115m] init qualityPref:', this.currentPickCode, qualityPref)
      const wantsHls = qualityPref && qualityPref.label !== '无损'

      // 2. 获取播放源（总是并行获取 HLS 和无损源，以确保画质列表完整）
      if (loadingTextEl) {
        loadingTextEl.textContent = '正在获取播放源...'
      }

      const m3u8Promise = fetchM3u8WithRetry(this.currentPickCode).catch((e) => {
        console.warn('[115m] fetchM3u8WithRetry failed:', e)
        return null as unknown as M3u8Item[]
      })

      const ultraPromise = fetchUltraSource(this.currentPickCode).catch((e) => {
        console.warn('[115m] fetchUltraSource failed:', e)
        return null
      })

      const [ultraSource, m3u8List] = await Promise.all([ultraPromise, m3u8Promise])

      console.log('[115m] Source fetch result:', {
        ultraOk: !!ultraSource,
        m3u8Ok: !!m3u8List,
        m3u8Count: m3u8List?.length || 0,
        qualityPref,
      })
      const ultraUrl = ultraSource?.url || null
      if (ultraSource?.ultraUrl) {
        this.ultraUrl = ultraSource.ultraUrl
      }
      if (m3u8List && m3u8List.length > 0) {
        this.m3u8List = m3u8List
      }

      this.perfMarks.ultraReady = performance.now()
      this.perf('ultra-source-ready', { ok: !!ultraUrl, m3u8Count: this.m3u8List.length })

      // 先构建画质选项列表
      this.qualityOptions = buildQualityOptions(
        '', // 初始化时还没有播放器 URL
        ultraUrl,
        this.m3u8List,
        this.currentQuality,
        this.currentQualityLabel,
      )

      if (qualityPref) {
        console.log('[115m] init applying qualityPref:', qualityPref)
        if (qualityPref.label === '无损' && ultraUrl) {
          // 偏好无损
          this.isNativeVideo = true
          this.currentQuality = 9999
          this.currentQualityLabel = '无损'
          this.createArtplayer(ultraUrl, 'native')
          this.perf('create-player-ultra-pref')
        }
        else {
          // 偏好 HLS 画质（115原画、1080P等）
          let m3u8Match: M3u8Item | undefined
          if (qualityPref.label === '115原画') {
            m3u8Match = this.m3u8List.find(item => item.quality === 9999) || this.m3u8List[0]
          }
          else {
            m3u8Match = this.m3u8List.find(item => item.quality === qualityPref.quality)
          }

          if (m3u8Match) {
            this.isNativeVideo = false
            this.currentQuality = m3u8Match.quality
            this.currentQualityLabel = qualityPref.label
            this.createArtplayer(m3u8Match.url, 'hls')
            this.perf('create-player-hls-pref', { label: qualityPref.label })
          }
          else {
            console.warn('[115m] qualityPref match failed, fallback to default', qualityPref)
            this.initWithDefaultQuality(ultraUrl)
          }
        }
      }
      else {
        // 无偏好记录
        this.initWithDefaultQuality(ultraUrl)
      }

      const currentUrl = this.artplayer?.url || ''
      this.refreshQualityState(currentUrl)
      this.renderQualityPanel()

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


  /**
   * 默认画质初始化逻辑（无损优先，降级 HLS）
   */
  private initWithDefaultQuality(ultraUrl: string | null) {
    if (ultraUrl) {
      this.isNativeVideo = true
      this.currentQuality = 9999
      this.currentQualityLabel = '无损'
      this.createArtplayer(ultraUrl, 'native')
      this.perf('create-player-native')
    }
    else if (this.m3u8List.length > 0) {
      this.isNativeVideo = false
      this.currentQuality = this.m3u8List[0].quality
      this.currentQualityLabel = getQualityDisplayName(this.m3u8List[0].quality, true)
      this.createArtplayer(this.m3u8List[0].url, 'hls')
      this.perf('create-player-hls-fallback')
    }
    else {
      throw new Error('无法获取任何播放源，请检查网络或是否需要人机验证')
    }
  }

  private async initHls(video: HTMLVideoElement, url: string): Promise<HlsType> {
    const hls = await createHlsInstance(video, url)
    this.hlsInstance = hls
    return hls
  }

  private createArtplayer(videoUrl: string, type: 'native' | 'hls') {
    const container = document.getElementById('artplayer-app')
    if (!container) throw new Error('找不到播放器容器')

    // 记录初始 URL，用于区分初始化和用户手动切换
    this._initUrl = videoUrl

    this.refreshQualityState(videoUrl)

    this.artplayer = new Artplayer({
      container: container as HTMLDivElement,
      url: videoUrl,
      volume: 1,
      autoplay: true,
      pip: false,
      autoMini: true,
      screenshot: false,
      setting: true,
      controls: [this.buildQualityControlItem()],
      loop: false,
      flip: true,
      playbackRate: true,
      aspectRatio: true,
      fullscreen: true,
      miniProgressBar: true,
      theme: '#1890ff',
      lang: 'zh-cn',
      contextmenu: [],
      customType: {
        m3u8: async (video, url) => {
          if (url === ORIGINAL_PLACEHOLDER_URL) {
            saveQualityPreference(this.currentPickCode, '115原画', 9999)
            // 立即更新内部状态，以便后续 UI 同步正常工作
            const opt = this.qualityOptions.find(o => o.url === url)
            if (opt) {
              this.applyPlaybackStatePatch(applySelectedQualityOption(this.getPlaybackState(), opt))
              this.renderQualityPanel()
            }

            const resolvedUrl = await this.ensureOriginalSourceLoaded()
            if (!resolvedUrl) {
              this.showError('115原画加载失败，请稍后重试')
              return
            }
            url = resolvedUrl
          }
          else {
            const opt = this.qualityOptions.find(o => o.url === url)
            if (opt) {
              // 只要是手动切换（非首次加载且已就绪），就记录偏好
              if (this.perfMarks.loadedmetadata) {
                saveQualityPreference(this.currentPickCode, opt.label, opt.quality)
              }
              this.applyPlaybackStatePatch(applySelectedQualityOption(this.getPlaybackState(), opt))
              this.renderQualityPanel()
            }
          }

          if (this.artplayer && await isHlsSupported()) {
            await this.initHls(video as HTMLVideoElement, url)
          }
          else {
            this.showError('您的浏览器不支持 HLS 播放')
          }
        },
      },
    })

    // Don't use ArtPlayer's fullscreenWeb — it uses position:fixed + moves to body,
    // which covers #playlist-sidebar. Instead the player fills its flex container naturally.
    Artplayer.FULLSCREEN_WEB_IN_BODY = false

    this.artplayer.on('restart', (url) => {
      if (typeof url !== 'string' || url === ORIGINAL_PLACEHOLDER_URL) return
      const opt = this.qualityOptions.find(o => o.url === url)
      if (opt && this.perfMarks.loadedmetadata) {
        saveQualityPreference(this.currentPickCode, opt.label, opt.quality)
        this.applyPlaybackStatePatch(applySelectedQualityOption(this.getPlaybackState(), opt))
        this.renderQualityPanel()
      }
    })

    if (type === 'native') {
      this.currentQuality = 9999
      this.currentQualityLabel = '无损'
    }

    this.setupTopNav()
    this.setupProgressHoverPreview()
    void this.fetchBreadcrumbs()

    if (this.artplayer) {
      this.setupStatsMenu()

      if (this.cleanupKeyboard) {
        this.cleanupKeyboard()
      }
      this.cleanupKeyboard = bindPlayerEvents({
        art: this.artplayer,
        type,
        pickCode: this.currentPickCode,
        getQualityLabel: () => this.currentQualityLabel,
        onPerf: (stage, extra) => this.perf(stage, extra),
        onReady: () => {
          this.artplayer!.contextmenu.remove('playbackRate')
          this.artplayer!.contextmenu.remove('aspectRatio')
          this.artplayer!.contextmenu.remove('flip')
          this.artplayer!.contextmenu.remove('info')
          this.artplayer!.contextmenu.remove('close')
          this.artplayer!.contextmenu.add({
            name: 'videoStats',
            index: 40,
            html: this.buildStatsHtml(),
            mounted: ($el: HTMLElement) => { this.infoMenuEl = $el },
          })
          this.renderQualityPanel()
        },
        onLoadedmetadata: () => {
          this.perfMarks.loadedmetadata = performance.now()
          this.updateQualityByUrl(this.artplayer?.url || '')
          this.renderQualityPanel()
          this.hoverPreview?.updateSize()
        },
        onCanplay: () => {
          this.perfMarks.canplay = performance.now()
        },
        onPlaying: () => {
          this.clearPlaybackEndState()
          this.perfMarks.playing = performance.now()
          this.reportFirstFrameSummary()
        },
        onEnded: () => {
          this.handlePlaybackEnded()
        },
        onError: () => {
          if (this.isNativeVideo) {
            void this.fallbackToHls()
          }
        },
      })
    }
  }


  private updateQualityByUrl(url: string) {
    this.applyPlaybackStatePatch(syncPlaybackStateByUrl(this.getPlaybackState(), url))
  }

  private refreshQualityState(currentUrl: string) {
    this.applyPlaybackStatePatch(refreshPlaybackQualityState(this.getPlaybackState(), currentUrl))
  }

  private getPlaybackState(): PlaybackState {
    return {
      ultraUrl: this.ultraUrl,
      m3u8List: this.m3u8List,
      qualityOptions: this.qualityOptions,
      currentQuality: this.currentQuality,
      currentQualityLabel: this.currentQualityLabel,
      isNativeVideo: this.isNativeVideo,
    }
  }

  private applyPlaybackStatePatch(state: Partial<PlaybackState>) {
    Object.assign(this, state)
  }

  private buildQualityControlItem(): any {
    return {
      name: PlayerManager.QUALITY_CONTROL_NAME,
      position: 'right' as const,
      index: 10,
      style: {
        marginRight: '10px',
        minWidth: '52px',
        textAlign: 'center' as const,
      },
      html: this.currentQualityLabel,
      selector: buildArtplayerQuality(this.qualityOptions, this.artplayer?.url || '', this.currentQualityLabel).map(item => ({
        ...item,
      })),
      onSelect: async (item: any) => {
        const label = item.html || ''
        const target = this.qualityOptions.find(opt => opt.label === label || opt.url === item.url)
        if (!target) return label
        await this.switchQuality(target)
        return target.label
      },
    }
  }

  private renderQualityPanel() {
    this.updateQualityControl()
  }

  private updateQualityControl() {
    if (!this.artplayer) return
    const controlsApi = (this.artplayer as any).controls
    if (!controlsApi) return
    const nextItem = this.buildQualityControlItem()

    if (typeof controlsApi.update === 'function') {
      controlsApi.update(nextItem)
      return
    }

    if (typeof controlsApi.remove === 'function') {
      controlsApi.remove(PlayerManager.QUALITY_CONTROL_NAME)
    }
    if (typeof controlsApi.add === 'function') {
      controlsApi.add(nextItem)
    }
  }

  private async switchQuality(opt: QualityOption) {
    if (!this.artplayer) return

    if (isOriginalPlaceholderOption(opt)) {
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

    this.applyPlaybackStatePatch(applySelectedQualityOption(this.getPlaybackState(), opt))
    this.renderQualityPanel()

    // 记住用户手动选择的画质
    saveQualityPreference(this.currentPickCode, opt.label, opt.quality)

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
    if (!this.artplayer) return
    this.overlay?.destroy()
    const meta = readOverlayMetaFromQuery()
    this.overlay = new PlayerOverlayController({
      art: this.artplayer,
      meta,
      onMoveFile: async (fileId, cid) => await this.moveFile(fileId, cid),
      onToggleFavorite: async (fileId, nextMarked) => await this.toggleFavorite(fileId, nextMarked),
      onPlaylistToggle: async (open) => {
        if (!open) return []
        const items = await this.fetchPlaylistItems()
        this.syncOverlayPlaybackNav()
        return items
      },
      onPlaylistPlay: (pickCode) => {
        if (pickCode && pickCode !== this.currentPickCode) {
          this.navigateToVideo(pickCode)
        }
      },
      onPlayPrevious: () => this.playPrevious(),
      onPlayNext: () => this.playNext(),
      onReplay: () => this.replayCurrent(),
      onRefreshBreadcrumbs: () => this.refreshBreadcrumbs(),
      getCurrentPickCode: () => this.currentPickCode,
    })
    this.overlay.init()
    this.syncOverlayPlaybackNav()
    void this.prefetchPlaylistItems()
    // 异步获取最新的收藏状态
    if (meta.fileId) {
      void this.fetchFileFavoriteStatus(meta.fileId)
    }
  }

  private async fetchFileFavoriteStatus(fileId: string): Promise<void> {
    try {
      // 使用 /files/video API 获取文件信息（包含 is_mark 字段）
      // 注意：这个 API 使用 GET 请求，参数放在 URL 中
      const url = `${WEB_API_URL}/files/video?pickcode=${encodeURIComponent(this.currentPickCode)}&share_id=0&local=1`
      const res = await sendRuntimeMessageSafe<{ ok?: boolean, text?: string }>({
        type: 'MAIN_WORLD_GET',
        data: { url },
      })

      if (res?.ok && res.text) {
        const parsed = JSON.parse(res.text) as { is_mark?: string }
        // is_mark 是字符串 '1'（已收藏）或 '0'（未收藏）
        this.overlay?.updateFavoriteStatus(parsed.is_mark === '1')
      }
    } catch (e) {
      console.warn('[115m] fetchFileFavoriteStatus failed:', e)
    }
  }

  private setupProgressHoverPreview() {
    if (!this.artplayer) return
    this.hoverPreview?.destroy()
    this.hoverPreview = new HoverPreviewController(this.artplayer, this.currentPickCode)
    this.hoverPreview.setup()
  }

  private buildStatsHtml(): string {
    const video = this.artplayer?.video
    if (!video) return '统计信息'
    const w = video.videoWidth
    const h = video.videoHeight
    const res = w && h ? `${w}×${h}` : '--'
    const fps = this.calcFps()
    return `统计信息 <span style="opacity:.5;margin-left:8px">${res}${fps ? ` · ${fps}fps` : ''}</span>`
  }

  private calcFps(): string {
    const video = this.artplayer?.video
    if (!video) return ''
    const q = (video.getVideoPlaybackQuality?.() || {}) as VideoPlaybackQualityLike
    let total = q.totalVideoFrames ?? 0
    if (!total) {
      total = (video as HTMLVideoElement & { webkitDecodedFrameCount?: number }).webkitDecodedFrameCount ?? 0
    }
    if (total > 0 && video.currentTime > 0) {
      return (total / video.currentTime).toFixed(1)
    }
    return ''
  }

  private setupStatsMenu() {
    if (!this.artplayer) return
    if (this.infoMenuTimer != null) window.clearInterval(this.infoMenuTimer)
    this.infoMenuTimer = window.setInterval(() => {
      if (this.infoMenuEl) {
        this.infoMenuEl.innerHTML = this.buildStatsHtml()
      }
    }, 2000)
  }


  private async fallbackToHls() {
    console.log('[115m] fallbackToHls triggered, current m3u8List length:', this.m3u8List.length)
    
    if (!this.artplayer) {
      this.showError('播放失败，无可用的视频源')
      return
    }

    // 确保有 m3u8 列表
    if (this.m3u8List.length === 0) {
      console.log('[115m] m3u8List empty, fetching...')
      const fetched = await fetchM3u8WithRetry(this.currentPickCode).catch((e) => {
        console.error('[115m] fetchM3u8WithRetry failed:', e)
        return null
      })
      if (fetched && fetched.length > 0) {
        this.m3u8List = fetched
      }
    }

    if (this.m3u8List.length === 0) {
      console.error('[115m] fallbackToHls: no m3u8 sources available')
      this.showError('播放失败，无可用的视频源')
      return
    }

    const { url: bestQualityUrl, patch } = applyFallbackToHlsState(this.getPlaybackState())
    this.applyPlaybackStatePatch(patch)
    if (!bestQualityUrl) {
      this.showError('播放失败，无可用的视频源')
      return
    }
    
    console.log('[115m] fallbackToHls: switching to', bestQualityUrl.substring(0, 80) + '...')
    this.renderQualityPanel()
    this.artplayer.switchUrl(bestQualityUrl)
  }

  private async ensureOriginalSourceLoaded(): Promise<string | null> {
    if (this.m3u8List.length === 0) {
      try {
        const list = await fetchM3u8WithRetry(this.currentPickCode)
        if (list && list.length > 0) {
          this.m3u8List = list
        }
      } catch (e) {
        console.error('[115m] fetchM3u8WithRetry error:', e)
      }
    }

    if (this.m3u8List.length === 0) {
      return null
    }

    const currentUrl = this.artplayer?.url || ''
    this.refreshQualityState(currentUrl)
    this.renderQualityPanel()
    return resolveOriginalPlaceholderUrl(this.getPlaybackState())
  }


  private showError(message: string) {
    renderPlayerError(message)
  }

  private async prefetchPlaylistItems() {
    try {
      await this.fetchPlaylistItems()
      this.syncOverlayPlaybackNav()
    }
    catch (error) {
      console.warn('[115m] prefetchPlaylistItems failed:', error)
    }
  }

  private async fetchPlaylistItems(): Promise<OverlayPlaylistItem[]> {
    if (this.playlistItemsCache.length > 0) {
      return this.playlistItemsCache
    }
    if (this.playlistLoadingPromise) {
      return await this.playlistLoadingPromise
    }

    this.playlistLoadingPromise = this.fetchPlaylistItemsInternal()
    try {
      this.playlistItemsCache = await this.playlistLoadingPromise
      return this.playlistItemsCache
    }
    finally {
      this.playlistLoadingPromise = null
    }
  }

  private async fetchPlaylistItemsInternal(): Promise<OverlayPlaylistItem[]> {
    const urlParams = new URLSearchParams(window.location.search)
    let cid = urlParams.get('cid') || ''

    const res = await sendRuntimeMessageSafe<MsgFetchPlaylistResponse>({
      type: 'FETCH_PLAYLIST',
      data: { cid, pickCode: this.currentPickCode },
    })

    // API 返回的 path 是完整的目录路径，用它更新面包屑
    if (res?.path && res.path.length > 0) {
      this.overlay?.updateBreadcrumbs(res.path)
    }

    const list = res?.list || []
    if (list.length === 0) {
      console.warn('[115m] playlist empty, raw response:', res)
    }
    return list
      .filter((item: any) => !!(item.pc || item.pick_code))
      .map((item: any) => ({
        pickCode: item.pc || item.pick_code,
        fileId: String(item.fid || item.file_id || item.cid || ''),
        name: item.n || item.fn || '',
        size: (item.s || item.fs || 0) > 0 ? this.formatFileSize(item.s || item.fs) : '',
        isMarked: (item.m === 1) || (item.iv === 1),
        duration: item.play_long || 0,
        sha: item.sha || '',
      }))
  }

  private getPlaylistPosition(items: OverlayPlaylistItem[] = this.playlistItemsCache) {
    const index = items.findIndex(item => item.pickCode === this.currentPickCode)
    return {
      index,
      previous: index > 0 ? items[index - 1] : null,
      current: index >= 0 ? items[index] : null,
      next: index >= 0 && index < items.length - 1 ? items[index + 1] : null,
    }
  }

  private syncOverlayPlaybackNav() {
    const { previous, next } = this.getPlaylistPosition()
    this.overlay?.updatePlaybackNav({
      hasPrevious: !!previous,
      hasNext: !!next,
      previousTitle: previous?.name,
      nextTitle: next?.name,
    })
  }

  private clearPlaybackEndState() {
    if (this.autoNextTimer) {
      window.clearTimeout(this.autoNextTimer)
      this.autoNextTimer = null
    }
    this.overlay?.hidePlaybackEndPanel()
  }

  private async handlePlaybackEnded() {
    this.clearPlaybackEndState()
    const items = await this.fetchPlaylistItems().catch(() => [])
    const { next } = this.getPlaylistPosition(items)

    if (next) {
      let countdown = 3
      this.overlay?.showPlaybackEndPanel({
        mode: 'autoplay-next',
        nextTitle: next.name,
        countdownSec: countdown,
      })
      this.autoNextTimer = window.setInterval(() => {
        countdown -= 1
        if (countdown <= 0) {
          this.clearPlaybackEndState()
          this.navigateToVideo(next.pickCode)
          return
        }
        this.overlay?.showPlaybackEndPanel({
          mode: 'autoplay-next',
          nextTitle: next.name,
          countdownSec: countdown,
        })
      }, 1000) as unknown as number
      return
    }

    this.overlay?.showPlaybackEndPanel({ mode: 'ended' })
  }

  private async playPrevious() {
    const items = await this.fetchPlaylistItems().catch(() => [])
    const { previous } = this.getPlaylistPosition(items)
    if (!previous) {
      this.overlay?.showToast('已经是第一集')
      return
    }
    this.navigateToVideo(previous.pickCode)
  }

  private async playNext() {
    const items = await this.fetchPlaylistItems().catch(() => [])
    const { next } = this.getPlaylistPosition(items)
    if (!next) {
      this.overlay?.showToast('已经是最后一集')
      return
    }
    this.navigateToVideo(next.pickCode)
  }

  private replayCurrent() {
    this.clearPlaybackEndState()
    if (!this.artplayer) return
    this.artplayer.seek = 0
    void this.artplayer.play()
  }

  /**
   * 主动通过 API 获取面包屑，不依赖 DOM 提取或 URL 参数
   */
  private async fetchBreadcrumbs(): Promise<void> {
    // 检查 URL 参数中是否已有 path（从文件列表页面传递过来的）
    const urlParams = new URLSearchParams(window.location.search)
    const rawPath = urlParams.get('path')
    if (rawPath) {
      try {
        const parsed = JSON.parse(rawPath) as Array<{ cid: string, name: string }>
        if (Array.isArray(parsed) && parsed.length > 0) {
          this.overlay?.updateBreadcrumbs(parsed)
          return
        }
      }
      catch { /* ignore */ }
    }

    // 通过 API 获取（需要 cid 或 pickCode）
    const cid = urlParams.get('cid') || ''
    const res = await sendRuntimeMessageSafe<MsgFetchPlaylistResponse>({
      type: 'FETCH_PLAYLIST',
      data: { cid, pickCode: this.currentPickCode },
    })

    if (res?.path && res.path.length > 0) {
      this.overlay?.updateBreadcrumbs(res.path)
    }
  }

  /**
   * 刷新面包屑（移动文件后调用）
   */
  private async refreshBreadcrumbs(): Promise<void> {
    // 强制通过 API 获取最新路径
    const res = await sendRuntimeMessageSafe<MsgFetchPlaylistResponse>({
      type: 'FETCH_PLAYLIST',
      data: { cid: '', pickCode: this.currentPickCode },
    })

    if (res?.path && res.path.length > 0) {
      this.overlay?.updateBreadcrumbs(res.path)
    }
  }

  private async moveFile(fileId: string, cid: string): Promise<void> {
    if (!fileId) throw new Error('fileId missing')

    const dialog = new MoveDialog(
      fileId,
      cid || '0',
      () => this.refreshBreadcrumbs(),
    )
    await dialog.show()
  }

  private async toggleFavorite(fileId: string, nextMarked: boolean): Promise<boolean> {
    if (!fileId) return !nextMarked

    const body = `file_id=${encodeURIComponent(fileId)}&star=${nextMarked ? '1' : '0'}`

    const res = await sendRuntimeMessageSafe<{ ok?: boolean, text?: string }>({
      type: 'MAIN_WORLD_FETCH',
      data: {
        url: `${WEB_API_URL}/files/star`,
        body,
      },
    })

    try {
      const parsed = res?.text ? JSON.parse(res.text) as { state?: boolean } : null

      // API 返回 { state: true } 表示成功
      if (res?.ok && parsed?.state === true) {
        const params = new URLSearchParams(window.location.search)
        params.set('marked', nextMarked ? '1' : '0')
        window.history.replaceState(null, '', `${window.location.pathname}?${params.toString()}`)
        return nextMarked
      }
    }
    catch {
      // ignore parse error
    }

    return !nextMarked
  }

  private navigateToVideo(pickCode: string) {
    this.clearPlaybackEndState()
    const params = new URLSearchParams(window.location.search)
    params.set('pick_code', pickCode)
    params.set('pickCode', pickCode)
    const targetItem = this.playlistItemsCache.find(item => item.pickCode === pickCode)
    if (targetItem?.name) {
      params.set('title', targetItem.name)
    }
    window.location.href = `${window.location.pathname}?${params.toString()}`
  }

  private formatFileSize(size: number): string {
    if (size < 1024) return `${size} B`
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(2)} KB`
    if (size < 1024 * 1024 * 1024) return `${(size / 1024 / 1024).toFixed(2)} MB`
    return `${(size / 1024 / 1024 / 1024).toFixed(2)} GB`
  }

  destroy() {
    this.clearPlaybackEndState()
    this.overlay?.destroy()
    this.overlay = null
    this.hoverPreview?.destroy()
    this.hoverPreview = null
    if (this.infoMenuTimer != null) {
      window.clearInterval(this.infoMenuTimer)
      this.infoMenuTimer = null
    }
    this.infoMenuEl = null
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
