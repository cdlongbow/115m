/**
 * 播放器页面逻辑
 */

console.log('[115m] player.ts loading...')

import Artplayer from 'artplayer'
import type HlsType from 'hls.js'
import type { M3u8Item } from '../lib/types'
import { buildArtplayerQuality, buildQualityOptions, getQualityDisplayName, ORIGINAL_PLACEHOLDER_URL } from './core/quality'
import { buildQualityControlItem as buildQualityControlConfig, updateArtplayerControl } from './core/player-quality'
import { fetchM3u8WithRetry } from './core/source'
import { deletePlayHistory, loadPlayHistory, saveQualityPreference } from './core/history'
import {
  applyCenterControlContainerStyle,
  applyNavButtonState,
  buildCenterControlsHtml,
  buildPlayButtonState,
  createCenterHoverBinder,
  queryCenterControlElements,
} from './core/player-center-controls'
import type { QualityOption } from './core/types'
import { runPlayerSmokeChecks } from './core/smoke'
import { renderPlayerError } from './core/dom'
import { createHlsInstance, isHlsSupported } from './core/hls'
import type { VideoPlaybackQualityLike } from './core/types'
import { HoverPreviewController } from './core/hover-preview'
import { bindPlayerEvents } from './core/events'
import { PlayerOverlayController, readOverlayMetaFromQuery, type OverlayPlaylistItem } from './core/overlay'
import { getNextPlaylistItem, getPlaybackEndCountdownPlan, getPreviousPlaylistItem } from './core/player-navigation'
import { fetchBreadcrumbPath, fetchPlaylistData, resolvePlaybackBundle, type ResolvedPlaybackBundle } from './core/player-services'
import { buildOverlayMetaPatch, buildPlayerHistoryUrl, findPlaylistItemByPickCode } from './core/player-switch'
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
import {
  buildUpdatedMarkedUrl,
  readPathFromLocation,
  readPlayerBootstrapConfig,
  readPlaylistCidFromLocation,
} from './core/player-query'
import { deleteVideoFile, fetchFavoriteStatus, updateFavoriteStatus } from './core/player-api'
import { buildPlaybackNavState, getDeleteFallback, getPlaylistPosition } from './core/playlist-navigation'

interface PlayerConfig {
  pickCode: string
  traceId?: string
  clickTs?: number
  keepPlaylistOpen?: boolean
}

function safePlay(art: Artplayer | null) {
  if (!art) return
  void art.play().catch(() => {
    // Ignore native play promise rejections during source switches and transient media reloads.
  })
}

class PlayerManager {
  private static readonly QUALITY_CONTROL_NAME = 'm115-quality-control'
  private static readonly CENTER_CONTROL_NAME = 'm115-center-control'
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
  private switchVideoRequestId = 0
  private traceId = ''
  private clickTs = 0
  private initStartTs = 0
  private perfMarks: Partial<Record<'init' | 'ultraReady' | 'loadedmetadata' | 'canplay' | 'playing', number>> = {}
  private firstPlayingReported = false
  private _initUrl = ''
  private cleanupKeyboard: (() => void) | null = null
  private readonly keepPlaylistOpenOnInit: boolean
  private currentPlaybackType: 'native' | 'hls' = 'hls'
  private centerControlEl: HTMLElement | null = null
  private centerPlayBtnEl: HTMLButtonElement | null = null
  private centerPrevBtnEl: HTMLButtonElement | null = null
  private centerNextBtnEl: HTMLButtonElement | null = null
  private nativePlayObserver: MutationObserver | null = null
  private lastPlaylistProgressSyncSec = -1
  private readonly handleRuntimeMessage = (message: any) => {
    if (message?.type === 'MOVE_SUCCESS_REFRESH') {
      void this.refreshBreadcrumbs()
      this.overlay?.showToast('文件已移动')
      return
    }

    if (message?.type === 'DELETE_SUCCESS_REFRESH' && message?.data?.pickCode === this.currentPickCode) {
      this.overlay?.showToast('文件已删除')
    }
  }

  constructor(config: PlayerConfig) {
    this.currentPickCode = config.pickCode
    this.traceId = config.traceId || `${config.pickCode}-${Date.now()}`
    this.clickTs = config.clickTs || 0
    this.keepPlaylistOpenOnInit = config.keepPlaylistOpen === true
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

      if (loadingTextEl) {
        loadingTextEl.textContent = '正在获取播放源...'
      }

      const playback = await this.resolvePlaybackForPickCode(this.currentPickCode)
      this.applyResolvedPlayback(playback)

      this.perfMarks.ultraReady = performance.now()
      this.perf('ultra-source-ready', { ok: !!playback.ultraUrl, m3u8Count: this.m3u8List.length })

      this.createArtplayer(playback.initialPlayback.url, playback.initialPlayback.type)
      this.perf(playback.initialPlayback.type === 'native' ? 'create-player-native' : 'create-player-hls', {
        label: playback.initialPlayback.currentQualityLabel,
        hasPreference: !!playback.qualityPreference,
      })

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

  private async initHls(video: HTMLVideoElement, url: string): Promise<HlsType> {
    if (this.hlsInstance) {
      this.hlsInstance.destroy()
      this.hlsInstance = null
    }
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
      controls: [
        this.buildCenterControlItem(),
        this.buildQualityControlItem(),
      ],
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
      this.hideNativePlayControl()
      if (typeof url !== 'string' || url === ORIGINAL_PLACEHOLDER_URL) return
      const opt = this.qualityOptions.find(o => o.url === url)
      if (opt && this.perfMarks.loadedmetadata) {
        saveQualityPreference(this.currentPickCode, opt.label, opt.quality)
        this.applyPlaybackStatePatch(applySelectedQualityOption(this.getPlaybackState(), opt))
        this.renderQualityPanel()
      }
      this.setupProgressHoverPreview(url, this.currentPlaybackType)
      this.syncCenterPlayButton()
    })

    this.artplayer.on('video:pause', () => {
      this.hideNativePlayControl()
      this.syncCenterPlayButton()
      this.syncCurrentPlaylistProgress(true)
    })

    this.artplayer.on('video:play', () => {
      this.hideNativePlayControl()
      this.syncCenterPlayButton()
    })

    this.artplayer.on('video:timeupdate', () => {
      this.syncCurrentPlaylistProgress()
    })

    this.observeNativeControls()

    if (type === 'native') {
      this.currentQuality = 9999
      this.currentQualityLabel = '无损'
    }

    this.setupTopNav()
    this.setupProgressHoverPreview(videoUrl, type)
    void this.fetchBreadcrumbs()

    if (this.artplayer) {
      this.setupStatsMenu()

      if (this.cleanupKeyboard) {
        this.cleanupKeyboard()
      }
      this.cleanupKeyboard = bindPlayerEvents({
        art: this.artplayer,
        getType: () => this.currentPlaybackType,
        getPickCode: () => this.currentPickCode,
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
          this.syncCenterPlayButton()
          this.perfMarks.playing = performance.now()
          this.reportFirstFrameSummary()
        },
        onEnded: () => {
          this.handlePlaybackEnded()
        },
        onError: () => {
          this.syncCenterPlayButton()
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
    return buildQualityControlConfig({
      controlName: PlayerManager.QUALITY_CONTROL_NAME,
      currentQualityLabel: this.currentQualityLabel,
      currentUrl: this.artplayer?.url || '',
      qualityOptions: this.qualityOptions,
      onSelect: async target => await this.switchQuality(target),
    })
  }

  private renderQualityPanel() {
    this.updateQualityControl()
  }

  private buildCenterControlItem(): any {
    return {
      name: PlayerManager.CENTER_CONTROL_NAME,
      position: 'left' as const,
      index: 200,
      html: buildCenterControlsHtml(),
      mounted: ($control: HTMLElement) => {
        this.centerControlEl = $control
        applyCenterControlContainerStyle($control)

        this.hideNativePlayControl()
        this.bindCenterControlElements($control)
      },
    }
  }

  private observeNativeControls() {
    this.nativePlayObserver?.disconnect()
    const controlsLeft = this.artplayer?.template.$controlsLeft as HTMLElement | null
    if (!controlsLeft || typeof MutationObserver === 'undefined') return

    this.nativePlayObserver = new MutationObserver(() => {
      this.hideNativePlayControl()
    })
    this.nativePlayObserver.observe(controlsLeft, { childList: true, subtree: false })
    this.hideNativePlayControl()
  }

  private hideNativePlayControl() {
    const controlsLeft = this.artplayer?.template.$controlsLeft as HTMLElement | null
    const nativePlayControl = controlsLeft?.firstElementChild as HTMLElement | null
    if (!nativePlayControl || nativePlayControl === this.centerControlEl) return
    nativePlayControl.style.display = 'none'
    nativePlayControl.style.pointerEvents = 'none'
    nativePlayControl.style.width = '0'
    nativePlayControl.style.margin = '0'
    nativePlayControl.style.padding = '0'
    nativePlayControl.style.overflow = 'hidden'
  }

  private bindCenterControlElements(container: HTMLElement) {
    const controls = queryCenterControlElements(container)
    this.centerPrevBtnEl = controls.prev
    this.centerPlayBtnEl = controls.play
    this.centerNextBtnEl = controls.next

    this.centerPrevBtnEl?.addEventListener('click', () => { void this.playPrevious() })
    this.centerNextBtnEl?.addEventListener('click', () => { void this.playNext() })
    this.centerPlayBtnEl?.addEventListener('click', () => {
      if (!this.artplayer) return
      if (this.artplayer.video.paused) {
        safePlay(this.artplayer)
      }
      else {
        this.artplayer.pause()
      }
      this.syncCenterPlayButton()
    })

    const bindHover = createCenterHoverBinder(this.centerPlayBtnEl)

    bindHover(this.centerPrevBtnEl)
    bindHover(this.centerPlayBtnEl)
    bindHover(this.centerNextBtnEl)

    this.syncCenterPlayButton()
    this.syncCenterPlaybackNav()
  }

  private syncCenterPlayButton() {
    if (!this.centerPlayBtnEl || !this.artplayer) return
    const state = buildPlayButtonState(this.artplayer.video.paused)
    this.centerPlayBtnEl.title = state.title
    this.centerPlayBtnEl.innerHTML = state.html
  }

  private syncCenterPlaybackNav() {
    const state = buildPlaybackNavState(getPlaylistPosition(this.playlistItemsCache, this.currentPickCode))
    applyNavButtonState(this.centerPrevBtnEl, state.hasPrevious, state.previousTitle ? `上一集：${state.previousTitle}` : '没有上一集')
    applyNavButtonState(this.centerNextBtnEl, state.hasNext, state.nextTitle ? `下一集：${state.nextTitle}` : '没有下一集')
  }

  private updateQualityControl() {
    if (!this.artplayer) return
    updateArtplayerControl(this.artplayer, PlayerManager.QUALITY_CONTROL_NAME, this.buildQualityControlItem())
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
        safePlay(this.artplayer)
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
      onPlaylistPlay: (pickCode, keepPlaylistOpen) => {
        if (pickCode && pickCode !== this.currentPickCode) {
          this.navigateToVideo(pickCode, keepPlaylistOpen)
        }
      },
      onDeleteFile: async (fileId, parentId, pickCode) => await this.deleteCurrentVideo(fileId, parentId, pickCode),
      onPlayPrevious: () => this.playPrevious(),
      onPlayNext: () => this.playNext(),
      onReplay: () => this.replayCurrent(),
      getCurrentPickCode: () => this.currentPickCode,
      shouldKeepPlaylistOpen: () => this.keepPlaylistOpenOnInit,
    })
    this.overlay.init()
    chrome.runtime.onMessage.removeListener(this.handleRuntimeMessage)
    chrome.runtime.onMessage.addListener(this.handleRuntimeMessage)
    this.syncOverlayPlaybackNav()
    void this.prefetchPlaylistItems()
    // 异步获取最新的收藏状态
    if (meta.fileId) {
      void this.fetchFileFavoriteStatus(meta.fileId)
    }
  }

  private async fetchFileFavoriteStatus(fileId: string): Promise<void> {
    try {
      const favoriteStatus = await fetchFavoriteStatus(sendRuntimeMessageSafe, this.currentPickCode)
      if (favoriteStatus !== null) {
        this.overlay?.updateFavoriteStatus(favoriteStatus)
      }
    } catch (e) {
      console.warn('[115m] fetchFileFavoriteStatus failed:', e)
    }
  }

  private setupProgressHoverPreview(previewSourceUrl?: string, previewSourceType?: 'native' | 'hls') {
    if (!this.artplayer) return

    const currentUrl = previewSourceUrl || this.artplayer.url || ''
    const fallbackThumbnailSource = [...this.m3u8List].sort((a, b) => a.quality - b.quality)[0]?.url

    if (fallbackThumbnailSource) {
      void import('../lib/videoThumbnail').then(({ primeThumbnailSourceUrl }) => {
        primeThumbnailSourceUrl(this.currentPickCode, fallbackThumbnailSource)
      })
    }

    this.hoverPreview?.destroy()
    this.hoverPreview = new HoverPreviewController(
      this.artplayer,
      this.currentPickCode,
      currentUrl || fallbackThumbnailSource || null,
    )
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
    const cid = readPlaylistCidFromLocation(window.location.search)

    return await fetchPlaylistData({
      sendMessage: sendRuntimeMessageSafe,
      cid,
      pickCode: this.currentPickCode,
      formatFileSize: size => this.formatFileSize(size),
      onPath: path => this.overlay?.updateBreadcrumbs(path),
    })
  }

  private syncOverlayPlaybackNav() {
    this.syncCenterPlaybackNav()
    this.overlay?.updatePlaybackNav(buildPlaybackNavState(
      getPlaylistPosition(this.playlistItemsCache, this.currentPickCode),
    ))
  }

  private syncCurrentPlaylistProgress(force = false) {
    if (!this.artplayer) return

    const currentTime = this.artplayer.currentTime || 0
    const duration = this.artplayer.duration || 0
    if (!duration || duration <= 0) return

    const roundedSec = Math.floor(currentTime)
    if (!force && roundedSec === this.lastPlaylistProgressSyncSec) return
    this.lastPlaylistProgressSyncSec = roundedSec

    const progressPercent = Math.max(0, Math.min(100, currentTime / duration * 100))
    const item = this.playlistItemsCache.find(entry => entry.pickCode === this.currentPickCode)
    if (item) {
      item.progressSec = currentTime
      item.progressPercent = progressPercent
    }

    this.overlay?.updateCurrentPlaylistProgress(this.currentPickCode, currentTime, duration)
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
    const plan = getPlaybackEndCountdownPlan(items, this.currentPickCode)
    const next = plan.next

    if (next) {
      let countdown = plan.countdownSec
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
    const previous = getPreviousPlaylistItem(items, this.currentPickCode)
    if (!previous) {
      this.overlay?.showToast('已经是第一集')
      return
    }
    this.navigateToVideo(previous.pickCode)
  }

  private async playNext() {
    const items = await this.fetchPlaylistItems().catch(() => [])
    const next = getNextPlaylistItem(items, this.currentPickCode)
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
    safePlay(this.artplayer)
  }

  /**
   * 主动通过 API 获取面包屑，不依赖 DOM 提取或 URL 参数
   */
  private async fetchBreadcrumbs(): Promise<void> {
    const pathFromQuery = readPathFromLocation(window.location.search)
    if (pathFromQuery.length > 0) {
      this.overlay?.updateBreadcrumbs(pathFromQuery)
      return
    }

    // 通过 API 获取（需要 cid 或 pickCode）
    const cid = readPlaylistCidFromLocation(window.location.search)
    const path = await fetchBreadcrumbPath(sendRuntimeMessageSafe, cid, this.currentPickCode)

    if (path.length > 0) {
      this.overlay?.updateBreadcrumbs(path)
    }
  }

  /**
   * 刷新面包屑（移动文件后调用）
   */
  private async refreshBreadcrumbs(): Promise<void> {
    // 强制通过 API 获取最新路径
    const path = await fetchBreadcrumbPath(sendRuntimeMessageSafe, '', this.currentPickCode)

    if (path.length > 0) {
      this.overlay?.updateBreadcrumbs(path)
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

    const result = await updateFavoriteStatus(sendRuntimeMessageSafe, fileId, nextMarked)
    if (result === nextMarked) {
      window.history.replaceState(null, '', buildUpdatedMarkedUrl(window.location.pathname, window.location.search, nextMarked))
    }
    return result
  }

  private async deleteCurrentVideo(fileId: string, parentId: string, pickCode: string): Promise<void> {
    const items = await this.fetchPlaylistItems().catch(() => this.playlistItemsCache)
    const { nextPickCode } = getDeleteFallback(items, pickCode)
    const keepPlaylistOpen = this.keepPlaylistOpenOnInit || this.overlay?.isPlaylistExpanded() === true

    await deleteVideoFile(sendRuntimeMessageSafe, fileId, parentId, pickCode)
    await deletePlayHistory(pickCode)

    this.playlistItemsCache = this.playlistItemsCache.filter(item => item.pickCode !== pickCode)
    this.syncOverlayPlaybackNav()
    this.overlay?.updatePlaylist(this.playlistItemsCache)

    if (nextPickCode) {
      this.navigateToVideo(nextPickCode, keepPlaylistOpen)
      return
    }

    if (window.history.length > 1) {
      window.history.back()
      return
    }

    window.close()
  }

  private navigateToVideo(pickCode: string, keepPlaylistOpen = false) {
    void this.switchToVideo(pickCode, keepPlaylistOpen)
  }

  private async switchToVideo(pickCode: string, keepPlaylistOpen = false) {
    if (!this.artplayer || !pickCode || pickCode === this.currentPickCode) return

    const requestId = ++this.switchVideoRequestId
    const targetItem = findPlaylistItemByPickCode(this.playlistItemsCache, pickCode)

    this.clearPlaybackEndState()

    try {
      const playback = await this.resolvePlaybackForPickCode(pickCode)
      if (requestId !== this.switchVideoRequestId || !this.artplayer) return

      this.currentPickCode = pickCode
      this.perfMarks = { init: performance.now() }
      this.firstPlayingReported = false
      this.lastPlaylistProgressSyncSec = -1
      this.applyResolvedPlayback(playback)
      const metaPatch = buildOverlayMetaPatch(targetItem)
      if (metaPatch) {
        this.overlay?.updateMeta(metaPatch)
      }
      window.history.replaceState(null, '', buildPlayerHistoryUrl({
        pathname: window.location.pathname,
        search: window.location.search,
        pickCode,
        targetItem,
        keepPlaylistOpen,
      }))
      this.syncOverlayPlaybackNav()
      this.overlay?.updatePlaylist(this.playlistItemsCache)
      this.setupProgressHoverPreview(playback.initialPlayback.url, playback.initialPlayback.type)
      this.renderQualityPanel()

      this.artplayer.switchUrl(playback.initialPlayback.url)

      void loadPlayHistory(pickCode, (time) => {
        if (requestId === this.switchVideoRequestId && this.artplayer) {
          this.artplayer.seek = time
        }
      })

      void this.fetchBreadcrumbs()

      if (targetItem?.fileId) {
        void this.fetchFileFavoriteStatus(targetItem.fileId)
      }
    }
    catch (error) {
      if (requestId !== this.switchVideoRequestId) return
      this.overlay?.showToast(error instanceof Error ? error.message : '切换视频失败')
    }
  }

  private async resolvePlaybackForPickCode(pickCode: string) {
    const playback = await resolvePlaybackBundle(sendRuntimeMessageSafe, pickCode)

    console.log('[115m] Source fetch result:', {
      pickCode,
      ultraOk: !!playback.ultraUrl,
      m3u8Ok: playback.m3u8List.length > 0,
      m3u8Count: playback.m3u8List.length,
      qualityPreference: playback.qualityPreference,
    })

    return playback
  }

  private applyResolvedPlayback(playback: ResolvedPlaybackBundle) {
    this.ultraUrl = playback.ultraUrl
    this.m3u8List = playback.m3u8List
    this.isNativeVideo = playback.initialPlayback.isNativeVideo
    this.currentPlaybackType = playback.initialPlayback.type
    this.currentQuality = playback.initialPlayback.currentQuality
    this.currentQualityLabel = playback.initialPlayback.currentQualityLabel
    this.qualityOptions = buildQualityOptions(
      '',
      playback.initialPlayback.type === 'native' ? playback.initialPlayback.url : playback.ultraUrl,
      this.m3u8List,
      this.currentQuality,
      this.currentQualityLabel,
    )
  }

  private formatFileSize(size: number): string {
    if (size < 1024) return `${size} B`
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(2)} KB`
    if (size < 1024 * 1024 * 1024) return `${(size / 1024 / 1024).toFixed(2)} MB`
    return `${(size / 1024 / 1024 / 1024).toFixed(2)} GB`
  }

  destroy() {
    this.clearPlaybackEndState()
    chrome.runtime.onMessage.removeListener(this.handleRuntimeMessage)
    this.overlay?.destroy()
    this.overlay = null
    this.hoverPreview?.destroy()
    this.hoverPreview = null
    if (this.infoMenuTimer != null) {
      window.clearInterval(this.infoMenuTimer)
      this.infoMenuTimer = null
    }
    this.infoMenuEl = null
    this.nativePlayObserver?.disconnect()
    this.nativePlayObserver = null
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
  const { pickCode, traceId, clickTs, keepPlaylistOpen } = readPlayerBootstrapConfig(window.location.search)

  if (!pickCode) {
    const el = document.getElementById('artplayer-app')
    if (el) {
      el.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100vh;color:#ff4d4f;font-size:18px;">缺少 pickCode 参数</div>'
    }
    return
  }

  playerManager = new PlayerManager({ pickCode, traceId, clickTs, keepPlaylistOpen })
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
