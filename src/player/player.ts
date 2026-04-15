/**
 * 播放器页面逻辑
 */

console.log('[115m] player.ts loading...')

import Artplayer from 'artplayer'
import type HlsType from 'hls.js'
import type { M3u8Item } from '../lib/types'
import type { FileItem } from '../lib/api/types'
import { buildArtplayerQuality, buildQualityOptions, getQualityDisplayName, ORIGINAL_PLACEHOLDER_URL } from './core/quality'
import { fetchM3u8WithRetry, fetchUltraSource } from './core/source'
import { loadPlayHistory, loadPlayHistoryMap, loadQualityPreference, saveQualityPreference } from './core/history'
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
import { resolveInitialPlayback } from './core/startup'
import {
  buildNavigateToVideoUrl,
  buildUpdatedMarkedUrl,
  readPathFromLocation,
  readPlayerBootstrapConfig,
  readPlaylistCidFromLocation,
} from './core/player-query'
import { normalizePlaylistItems } from './core/playlist'
import { deleteVideoFile, fetchFavoriteStatus, fetchPlaylistResponse, updateFavoriteStatus } from './core/player-api'
import { buildPlaybackNavState, getDeleteFallback, getPlaylistPosition } from './core/playlist-navigation'

interface PlayerConfig {
  pickCode: string
  traceId?: string
  clickTs?: number
  keepPlaylistOpen?: boolean
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
      this.syncCenterPlayButton()
    })

    this.artplayer.on('video:pause', () => {
      this.hideNativePlayControl()
      this.syncCenterPlayButton()
    })

    this.artplayer.on('video:play', () => {
      this.hideNativePlayControl()
      this.syncCenterPlayButton()
    })

    this.observeNativeControls()

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

  private buildCenterControlItem(): any {
    return {
      name: PlayerManager.CENTER_CONTROL_NAME,
      position: 'left' as const,
      index: 200,
      html: this.buildCenterControlsHtml(),
      mounted: ($control: HTMLElement) => {
        this.centerControlEl = $control
        $control.style.position = 'absolute'
        $control.style.left = '50%'
        $control.style.bottom = '0'
        $control.style.transform = 'translateX(-50%)'
        $control.style.display = 'flex'
        $control.style.alignItems = 'center'
        $control.style.justifyContent = 'center'
        $control.style.padding = '0'
        $control.style.height = '100%'
        $control.style.pointerEvents = 'auto'

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

  private buildCenterControlsHtml(): string {
    return `
      <div style="display:flex;align-items:center;justify-content:center;gap:12px;height:100%;">
        <button type="button" data-m115-center="prev" title="上一集" style="display:flex;align-items:center;justify-content:center;width:36px;height:36px;border:none;border-radius:999px;background:rgba(255,255,255,.08);color:rgba(255,255,255,.86);cursor:pointer;padding:0;transition:background .15s ease,opacity .15s ease;">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 6l-6 6 6 6"/><path d="M19 6l-6 6 6 6"/></svg>
        </button>
        <button type="button" data-m115-center="play" title="播放" style="display:flex;align-items:center;justify-content:center;width:44px;height:44px;border:1px solid rgba(255,255,255,.18);border-radius:999px;background:rgba(255,255,255,.12);color:#fff;cursor:pointer;padding:0;box-shadow:0 4px 16px rgba(0,0,0,.18);transition:background .15s ease,opacity .15s ease;">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
        </button>
        <button type="button" data-m115-center="next" title="下一集" style="display:flex;align-items:center;justify-content:center;width:36px;height:36px;border:none;border-radius:999px;background:rgba(255,255,255,.08);color:rgba(255,255,255,.86);cursor:pointer;padding:0;transition:background .15s ease,opacity .15s ease;">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m13 6 6 6-6 6"/><path d="m5 6 6 6-6 6"/></svg>
        </button>
      </div>
    `
  }

  private bindCenterControlElements(container: HTMLElement) {
    this.centerPrevBtnEl = container.querySelector('[data-m115-center="prev"]') as HTMLButtonElement | null
    this.centerPlayBtnEl = container.querySelector('[data-m115-center="play"]') as HTMLButtonElement | null
    this.centerNextBtnEl = container.querySelector('[data-m115-center="next"]') as HTMLButtonElement | null

    this.centerPrevBtnEl?.addEventListener('click', () => { void this.playPrevious() })
    this.centerNextBtnEl?.addEventListener('click', () => { void this.playNext() })
    this.centerPlayBtnEl?.addEventListener('click', () => {
      if (!this.artplayer) return
      if (this.artplayer.video.paused) {
        void this.artplayer.play()
      }
      else {
        this.artplayer.pause()
      }
      this.syncCenterPlayButton()
    })

    const bindHover = (button: HTMLButtonElement | null) => {
      button?.addEventListener('mouseenter', () => {
        if (!button.disabled) button.style.background = 'rgba(255,255,255,.16)'
      })
      button?.addEventListener('mouseleave', () => {
        button.style.background = button === this.centerPlayBtnEl ? 'rgba(255,255,255,.12)' : 'rgba(255,255,255,.08)'
      })
    }

    bindHover(this.centerPrevBtnEl)
    bindHover(this.centerPlayBtnEl)
    bindHover(this.centerNextBtnEl)

    this.syncCenterPlayButton()
    this.syncCenterPlaybackNav()
  }

  private syncCenterPlayButton() {
    if (!this.centerPlayBtnEl || !this.artplayer) return
    const paused = this.artplayer.video.paused
    this.centerPlayBtnEl.title = paused ? '播放' : '暂停'
    this.centerPlayBtnEl.innerHTML = paused
      ? '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>'
      : '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5h3v14H8zM13 5h3v14h-3z"/></svg>'
  }

  private syncCenterPlaybackNav() {
    const state = buildPlaybackNavState(getPlaylistPosition(this.playlistItemsCache, this.currentPickCode))
    this.syncCenterNavButton(this.centerPrevBtnEl, state.hasPrevious, state.previousTitle ? `上一集：${state.previousTitle}` : '没有上一集')
    this.syncCenterNavButton(this.centerNextBtnEl, state.hasNext, state.nextTitle ? `下一集：${state.nextTitle}` : '没有下一集')
  }

  private syncCenterNavButton(button: HTMLButtonElement | null, enabled: boolean, title: string) {
    if (!button) return
    button.disabled = !enabled
    button.title = title
    button.style.opacity = enabled ? '1' : '.38'
    button.style.cursor = enabled ? 'pointer' : 'not-allowed'
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
      onPlaylistPlay: (pickCode, keepPlaylistOpen) => {
        if (pickCode && pickCode !== this.currentPickCode) {
          this.navigateToVideo(pickCode, keepPlaylistOpen)
        }
      },
      onDeleteFile: async (fileId, parentId, pickCode) => await this.deleteCurrentVideo(fileId, parentId, pickCode),
      onPlayPrevious: () => this.playPrevious(),
      onPlayNext: () => this.playNext(),
      onReplay: () => this.replayCurrent(),
      onRefreshBreadcrumbs: () => this.refreshBreadcrumbs(),
      getCurrentPickCode: () => this.currentPickCode,
      shouldKeepPlaylistOpen: () => this.keepPlaylistOpenOnInit,
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
      const favoriteStatus = await fetchFavoriteStatus(sendRuntimeMessageSafe, this.currentPickCode)
      if (favoriteStatus !== null) {
        this.overlay?.updateFavoriteStatus(favoriteStatus)
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
    const cid = readPlaylistCidFromLocation(window.location.search)

    const res = await fetchPlaylistResponse(sendRuntimeMessageSafe, cid, this.currentPickCode)

    // API 返回的 path 是完整的目录路径，用它更新面包屑
    if (res?.path && res.path.length > 0) {
      this.overlay?.updateBreadcrumbs(res.path)
    }

    const list = res?.list || []
    if (list.length === 0) {
      console.warn('[115m] playlist empty, raw response:', res)
    }
    const items = normalizePlaylistItems(list as FileItem[], size => this.formatFileSize(size))
    return await this.attachPlaylistProgress(items)
  }

  private async attachPlaylistProgress(items: OverlayPlaylistItem[]): Promise<OverlayPlaylistItem[]> {
    if (items.length === 0) return items

    const historyMap = await loadPlayHistoryMap()
    return items.map((item) => {
      const history = historyMap[item.pickCode]
      if (!history?.currentTime || !history.duration || history.duration <= 0) {
        return item
      }

      const progressPercent = Math.max(0, Math.min(100, (history.currentTime / history.duration) * 100))
      if (progressPercent <= 0) {
        return item
      }

      return {
        ...item,
        progressSec: history.currentTime,
        progressPercent,
      }
    })
  }

  private syncOverlayPlaybackNav() {
    this.syncCenterPlaybackNav()
    this.overlay?.updatePlaybackNav(buildPlaybackNavState(
      getPlaylistPosition(this.playlistItemsCache, this.currentPickCode),
    ))
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
    const { next } = getPlaylistPosition(items, this.currentPickCode)

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
    const { previous } = getPlaylistPosition(items, this.currentPickCode)
    if (!previous) {
      this.overlay?.showToast('已经是第一集')
      return
    }
    this.navigateToVideo(previous.pickCode)
  }

  private async playNext() {
    const items = await this.fetchPlaylistItems().catch(() => [])
    const { next } = getPlaylistPosition(items, this.currentPickCode)
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
    const pathFromQuery = readPathFromLocation(window.location.search)
    if (pathFromQuery.length > 0) {
      this.overlay?.updateBreadcrumbs(pathFromQuery)
      return
    }

    // 通过 API 获取（需要 cid 或 pickCode）
    const cid = readPlaylistCidFromLocation(window.location.search)
    const res = await fetchPlaylistResponse(sendRuntimeMessageSafe, cid, this.currentPickCode)

    if (res?.path && res.path.length > 0) {
      this.overlay?.updateBreadcrumbs(res.path)
    }
  }

  /**
   * 刷新面包屑（移动文件后调用）
   */
  private async refreshBreadcrumbs(): Promise<void> {
    // 强制通过 API 获取最新路径
    const res = await fetchPlaylistResponse(sendRuntimeMessageSafe, '', this.currentPickCode)

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

    this.showError('当前视频已删除，请返回列表')
  }

  private navigateToVideo(pickCode: string, keepPlaylistOpen = false) {
    void this.switchToVideo(pickCode, keepPlaylistOpen)
  }

  private async switchToVideo(pickCode: string, keepPlaylistOpen = false) {
    if (!this.artplayer || !pickCode || pickCode === this.currentPickCode) return

    const requestId = ++this.switchVideoRequestId
    const targetItem = this.getPlaylistItemByPickCode(pickCode)

    this.clearPlaybackEndState()

    try {
      const playback = await this.resolvePlaybackForPickCode(pickCode)
      if (requestId !== this.switchVideoRequestId || !this.artplayer) return

      this.currentPickCode = pickCode
      this.perfMarks = { init: performance.now() }
      this.firstPlayingReported = false
      this.applyResolvedPlayback(playback)
      this.updateCurrentVideoMeta(targetItem)
      this.updateHistoryUrl(pickCode, targetItem, keepPlaylistOpen)
      this.syncOverlayPlaybackNav()
      this.overlay?.updatePlaylist(this.playlistItemsCache)
      this.setupProgressHoverPreview()
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

  private getPlaylistItemByPickCode(pickCode: string): OverlayPlaylistItem | undefined {
    return this.playlistItemsCache.find(item => item.pickCode === pickCode)
  }

  private updateCurrentVideoMeta(targetItem?: OverlayPlaylistItem) {
    if (!targetItem) return

    this.overlay?.updateMeta({
      title: targetItem.name,
      fileId: targetItem.fileId,
      fileSize: targetItem.size || '',
      isMarked: targetItem.isMarked === true,
    })
  }

  private updateHistoryUrl(pickCode: string, targetItem: OverlayPlaylistItem | undefined, keepPlaylistOpen: boolean) {
    window.history.replaceState(null, '', buildNavigateToVideoUrl(
      window.location.pathname,
      window.location.search,
      pickCode,
      {
        title: targetItem?.name,
        fileId: targetItem?.fileId,
        fileSize: targetItem?.size,
        isMarked: targetItem?.isMarked,
        keepPlaylistOpen,
      },
    ))
  }

  private async resolvePlaybackForPickCode(pickCode: string) {
    const qualityPreference = await loadQualityPreference(pickCode)
    console.log('[115m] init qualityPref:', pickCode, qualityPreference)

    const m3u8Promise = fetchM3u8WithRetry(pickCode).catch((e) => {
      console.warn('[115m] fetchM3u8WithRetry failed:', e)
      return null as unknown as M3u8Item[]
    })

    const ultraPromise = fetchUltraSource(pickCode).catch((e) => {
      console.warn('[115m] fetchUltraSource failed:', e)
      return null
    })

    const [ultraSource, m3u8List] = await Promise.all([ultraPromise, m3u8Promise])
    const ultraUrl = ultraSource?.ultraUrl || null
    const resolvedM3u8List = m3u8List && m3u8List.length > 0 ? m3u8List : []

    console.log('[115m] Source fetch result:', {
      pickCode,
      ultraOk: !!ultraSource,
      m3u8Ok: resolvedM3u8List.length > 0,
      m3u8Count: resolvedM3u8List.length,
      qualityPreference,
    })

    const initialPlayback = resolveInitialPlayback({
      qualityPreference,
      ultraUrl: ultraSource?.url || null,
      m3u8List: resolvedM3u8List,
    })

    if (!initialPlayback) {
      throw new Error('无法获取任何播放源，请检查网络或是否需要人机验证')
    }

    return {
      qualityPreference,
      ultraUrl,
      m3u8List: resolvedM3u8List,
      initialPlayback,
    }
  }

  private applyResolvedPlayback(playback: Awaited<ReturnType<PlayerManager['resolvePlaybackForPickCode']>>) {
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
