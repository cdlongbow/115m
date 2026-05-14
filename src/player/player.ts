/**
 * 播放器页面逻辑
 */

console.log('[115m] player.ts loading...')

import Artplayer from 'artplayer'
import type HlsType from 'hls.js'
import playerSkinCss from './core/player-skin.css?inline'
import uiLayerCss from './core/ui-layer.css?inline'
import type { M3u8Item } from '../lib/types'
import { buildArtplayerQuality, buildQualityOptions, getQualityDisplayName, ORIGINAL_PLACEHOLDER_URL } from './core/quality'
import { buildQualityControlItem as buildQualityControlConfig, updateArtplayerControl } from './core/player-quality'
import { buildSpeedControlItem as buildSpeedControlConfig } from './core/player-speed'
import { buildAudioControlItem as buildAudioControlConfig } from './core/player-audio'
import { buildPlaybackModeControlItem as buildPlaybackModeControlConfig } from './core/player-playback-mode-control'
import { fetchM3u8WithRetry } from './core/source'
import { deletePlayHistory, loadPlayHistory, loadVideoRotation, saveQualityPreference, saveVideoRotation } from './core/history'
import { buildNavControlItem } from './core/player-center-controls'
import type { AudioTrackOption, QualityOption } from './core/types'
import { buildPlaybackModePlan, getPlaybackModeLabel, loadPlaybackMode, savePlaybackMode, type PlaybackMode } from './core/player-playback-mode'
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
import { ensureServiceWorkerReady, getRuntimeApi, sendRuntimeMessageSafe } from './core/runtime'
import {
  buildUpdatedMarkedUrl,
  readPathFromLocation,
  readPlayerBootstrapConfig,
  readPlaylistCidFromLocation,
} from './core/player-query'
import { deleteVideoFile, fetchFavoriteStatus, updateFavoriteStatus } from './core/player-api'
import { buildPlaybackNavState, getDeleteFallback, getPlaylistPosition } from './core/playlist-navigation'
import { readTemporaryPlayerPlaylist } from '../shared/player-playlist-cache'
import { canUseNativeUltraSource, shouldRetryNativePlayback } from './core/native-playback'
import { applyRotationToVideo, buildRotateControlItem, getNextRotationDegrees } from './core/player-rotation'

function injectPlayerSkinStyles() {
  if (document.getElementById('m115-player-skin-style')) return
  const style = document.createElement('style')
  style.id = 'm115-player-skin-style'
  style.textContent = `${playerSkinCss}\n${uiLayerCss}`
  document.head.appendChild(style)
}

injectPlayerSkinStyles()

interface PlayerConfig {
  pickCode: string
  traceId?: string
  clickTs?: number
  keepPlaylistOpen?: boolean
  playlistToken?: string
}

function isInterruptedPlayError(reason: unknown) {
  if (!(reason instanceof DOMException) && !(reason instanceof Error)) return false
  return reason.name === 'AbortError' && /play\(\).*interrupted|interrupted by a new load request/i.test(reason.message)
}

function bindInterruptedPlayRejectionGuard() {
  window.addEventListener('unhandledrejection', (event) => {
    if (isInterruptedPlayError(event.reason)) {
      event.preventDefault()
    }
  })
}

function safePlay(art: Artplayer | null) {
  if (!art) return
  void art.play().catch(() => {
    // Ignore native play promise rejections during source switches and transient media reloads.
  })
}

bindInterruptedPlayRejectionGuard()

class PlayerManager {
  private static readonly QUALITY_CONTROL_NAME = 'm115-quality-control'
  private static readonly SPEED_CONTROL_NAME = 'm115-speed-control'
  private static readonly PLAYBACK_MODE_CONTROL_NAME = 'm115-playback-mode-control'
  private static readonly AUDIO_CONTROL_NAME = 'm115-audio-control'
  private static readonly ROTATE_CONTROL_NAME = 'm115-rotate-control'
  private static readonly PREV_CONTROL_NAME = 'm115-prev-control'
  private static readonly NEXT_CONTROL_NAME = 'm115-next-control'
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
  private readonly playlistToken?: string
  private readonly nativeUltraSupported: boolean
  private currentPlaybackType: 'native' | 'hls' = 'hls'
  private cleanupResize: (() => void) | null = null
  private cleanupRotationContainerObserver: (() => void) | null = null
  private rotationReflowRaf = 0
  private lastPlaylistProgressSyncSec = -1
  private nativePlaybackRetryCount = 0
  private nativeAudioProbeTimer: number | null = null
  private currentRotation = 0
  private currentPlaybackRate = 1
  private currentPlaybackMode: PlaybackMode = loadPlaybackMode()
  private audioTrackOptions: AudioTrackOption[] = []
  private currentAudioTrackId = -1
  private currentAudioTrackLabel = '音轨'
  private audioTrackSyncTimers: number[] = []
  private currentHlsSourceUrl: string | null = null
  private currentHlsLogicalUrl: string | null = null
  private preferredAudioTrackId: number | null = null
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
    this.playlistToken = config.playlistToken
    this.nativeUltraSupported = canUseNativeUltraSource(
      new URLSearchParams(window.location.search).get('title') || '',
      null,
    )
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
      this.currentRotation = loadVideoRotation(this.currentPickCode)

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
      this.renderPlaybackNavControls()
      this.renderRotateControl()
      this.renderSpeedControl()

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
    this.currentHlsLogicalUrl = url
    const sourceUrl = await this.buildHlsPlaybackUrl(url)
    this.currentHlsSourceUrl = sourceUrl
    const hls = await createHlsInstance(video, sourceUrl)
    this.hlsInstance = hls

    const applyPreferredAudioTrack = () => {
      const preferredId = this.preferredAudioTrackId
      if (preferredId == null) return
      const anyHls = hls as any
      const tracks = Array.isArray(anyHls.audioTracks) ? anyHls.audioTracks : []
      const track = tracks[preferredId]
      if (!track) return
      try {
        if (typeof anyHls.setAudioOption === 'function') {
          anyHls.setAudioOption(track)
        }
      }
      catch {
        // ignore and continue
      }
      anyHls.audioTrack = preferredId
    }

    hls.on('hlsAudioTracksUpdated' as any, () => {
      applyPreferredAudioTrack()
      this.syncAudioTracksFromHls()
    })
    hls.on('hlsAudioTrackSwitched' as any, () => {
      this.syncAudioTracksFromHls()
    })
    hls.on('hlsManifestParsed' as any, () => {
      applyPreferredAudioTrack()
      this.syncAudioTracksFromHls()
    })
    this.scheduleAudioTrackSync()
    void this.hydrateAudioTracksFromMasterPlaylist()
    return hls
  }

  private async fetchMasterPlaylistText(): Promise<string | null> {
    try {
      const response = await fetch(`https://115.com/api/video/m3u8/${this.currentPickCode}.m3u8`, {
        credentials: 'include',
      })
      const text = await response.text()
      return text.startsWith('#EXTM3U') ? text : null
    }
    catch {
      return null
    }
  }

  private async buildHlsPlaybackUrl(selectedUrl: string): Promise<string> {
    const masterText = await this.fetchMasterPlaylistText()
    if (!masterText || !/#EXT-X-MEDIA:TYPE=AUDIO/i.test(masterText)) {
      return selectedUrl
    }

    const lines = masterText.split(/\r?\n/)
    const audioTags = lines.filter(line => /#EXT-X-MEDIA:TYPE=AUDIO/i.test(line.trim()))
    if (audioTags.length === 0) {
      return selectedUrl
    }

    let streamInf = ''
    for (let i = 0; i < lines.length; i += 1) {
      if (lines[i]?.trim() === selectedUrl.trim()) {
        streamInf = lines[i - 1]?.trim() || ''
        break
      }
    }

    if (!streamInf.startsWith('#EXT-X-STREAM-INF')) {
      const groupId = audioTags[0].match(/GROUP-ID="([^"]+)"/i)?.[1] || 'Audio-Group'
      streamInf = `#EXT-X-STREAM-INF:BANDWIDTH=3000000,AUDIO="${groupId}",NAME="custom"`
    }
    else if (!/\bAUDIO=/i.test(streamInf)) {
      const groupId = audioTags[0].match(/GROUP-ID="([^"]+)"/i)?.[1] || 'Audio-Group'
      streamInf = `${streamInf},AUDIO="${groupId}"`
    }

    const wrapped = ['#EXTM3U', ...audioTags, streamInf, selectedUrl].join('\n')
    return URL.createObjectURL(new Blob([wrapped], { type: 'application/vnd.apple.mpegurl' }))
  }

  private clearAudioTrackSyncTimers() {
    this.audioTrackSyncTimers.forEach(timer => window.clearTimeout(timer))
    this.audioTrackSyncTimers = []
  }

  private scheduleAudioTrackSync() {
    this.clearAudioTrackSyncTimers()
    const delays = [0, 300, 1000, 2500]
    this.audioTrackSyncTimers = delays.map(delay => window.setTimeout(() => {
      this.syncAudioTracksFromHls()
    }, delay))
  }

  private createArtplayer(videoUrl: string, type: 'native' | 'hls') {
    const container = document.getElementById('artplayer-app')
    if (!container) throw new Error('找不到播放器容器')

    // 记录初始 URL，用于区分初始化和用户手动切换
    this._initUrl = videoUrl

    this.refreshQualityState(videoUrl)

    // YouTube-like idle delay: keep controls visible for a few seconds after mouse movement.
    Artplayer.CONTROL_HIDE_TIME = 6000

    this.artplayer = new Artplayer({
      container: container as HTMLDivElement,
      url: videoUrl,
      volume: 1,
      autoplay: true,
      pip: false,
      autoMini: true,
      screenshot: false,
      setting: false,
      controls: [
        this.buildPrevControlItem(),
        this.buildNextControlItem(),
        this.buildRotateControlItem(),
        this.buildQualityControlItem(),
        this.buildAudioControlItem(),
        this.buildPlaybackModeControlItem(),
        this.buildSpeedControlItem(),
      ],
      loop: false,
      playbackRate: false,
      aspectRatio: false,
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
      this.setupProgressHoverPreview(url, this.currentPlaybackType)
    })

    this.artplayer.on('video:pause', () => {
      this.syncCurrentPlaylistProgress(true)
    })

    this.artplayer.on('video:play', () => {})

    this.artplayer.on('video:timeupdate', () => {
      this.syncCurrentPlaylistProgress()
    })

    this.bindWindowResize()
    this.bindRotationContainerObserver()
    this.applyVideoRotation()

    if (type === 'native') {
      this.currentQuality = 9999
      this.currentQualityLabel = '无损'
      this.audioTrackOptions = []
      this.currentAudioTrackId = -1
      this.currentAudioTrackLabel = '音轨'
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
          this.safeRemoveContextmenuItem('playbackRate')
          this.safeRemoveContextmenuItem('aspectRatio')
          this.safeRemoveContextmenuItem('flip')
          this.safeRemoveContextmenuItem('info')
          this.safeRemoveContextmenuItem('close')
          this.artplayer!.contextmenu.add({
            name: 'videoStats',
            index: 40,
            html: this.buildStatsHtml(),
            mounted: ($el: HTMLElement) => { this.infoMenuEl = $el },
          })
          this.renderQualityPanel()
          this.renderAudioControl()
          this.renderPlaybackModeControl()
          this.renderPlaybackNavControls()
          this.renderRotateControl()
          this.renderSpeedControl()
        },
        onLoadedmetadata: () => {
          this.perfMarks.loadedmetadata = performance.now()
          this.updateQualityByUrl(this.artplayer?.url || '')
          this.renderQualityPanel()
          this.renderAudioControl()
          this.renderPlaybackModeControl()
          this.renderSpeedControl()
          this.applyVideoRotation()
          this.hoverPreview?.updateSize()
        },
        onCanplay: () => {
          this.perfMarks.canplay = performance.now()
        },
        onPlaying: () => {
          this.clearPlaybackEndState()
          this.nativePlaybackRetryCount = 0
          this.clearNativeAudioProbe()
          this.perfMarks.playing = performance.now()
          this.reportFirstFrameSummary()
          if (this.isNativeVideo) {
            this.scheduleNativeAudioProbe()
          }
        },
        onEnded: () => {
          this.handlePlaybackEnded()
        },
        onError: () => {
          if (this.isNativeVideo) {
            void this.handleNativePlaybackError()
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

  private buildSpeedControlItem(): any {
    return buildSpeedControlConfig({
      controlName: PlayerManager.SPEED_CONTROL_NAME,
      currentPlaybackRate: this.currentPlaybackRate,
      onSelectPlaybackRate: value => this.applyPlaybackRate(value),
    })
  }

  private buildPlaybackModeControlItem(): any {
    return buildPlaybackModeControlConfig({
      controlName: PlayerManager.PLAYBACK_MODE_CONTROL_NAME,
      currentPlaybackMode: this.currentPlaybackMode,
      onSelectPlaybackMode: mode => this.applyPlaybackModeSelection(mode),
    })
  }

  private renderPlaybackModeControl() {
    if (!this.artplayer) return
    updateArtplayerControl(this.artplayer, PlayerManager.PLAYBACK_MODE_CONTROL_NAME, this.buildPlaybackModeControlItem())
  }

  private buildAudioControlItem(): any {
    return buildAudioControlConfig({
      controlName: PlayerManager.AUDIO_CONTROL_NAME,
      currentAudioTrackLabel: this.currentAudioTrackLabel,
      audioTrackOptions: this.audioTrackOptions,
      visible: this.audioTrackOptions.length > 1,
      onSelectAudioTrack: id => this.applyAudioTrack(id),
    })
  }

  private renderAudioControl() {
    if (!this.artplayer) return
    updateArtplayerControl(this.artplayer, PlayerManager.AUDIO_CONTROL_NAME, this.buildAudioControlItem())
  }

  private renderSpeedControl() {
    if (!this.artplayer) return
    updateArtplayerControl(this.artplayer, PlayerManager.SPEED_CONTROL_NAME, this.buildSpeedControlItem())
  }

  private buildRotateControlItem(): any {
    return buildRotateControlItem({
      controlName: PlayerManager.ROTATE_CONTROL_NAME,
      rotation: this.currentRotation,
      onRotate: () => this.rotateVideoClockwise(),
    })
  }

  private renderRotateControl() {
    if (!this.artplayer) return
    updateArtplayerControl(this.artplayer, PlayerManager.ROTATE_CONTROL_NAME, this.buildRotateControlItem())
  }

  private safeRemoveContextmenuItem(name: string) {
    try {
      this.artplayer?.contextmenu.remove(name)
    }
    catch {
      // Some built-in items only exist when the related feature is enabled.
    }
  }

  private buildPrevControlItem(): any {
    const state = buildPlaybackNavState(getPlaylistPosition(this.playlistItemsCache, this.currentPickCode))
    return buildNavControlItem({
      controlName: PlayerManager.PREV_CONTROL_NAME,
      direction: 'prev',
      index: 9,
      enabled: state.hasPrevious,
      title: state.previousTitle ? `上一集：${state.previousTitle}` : '没有上一集',
      onClick: () => { void this.playPrevious() },
    })
  }

  private buildNextControlItem(): any {
    const state = buildPlaybackNavState(getPlaylistPosition(this.playlistItemsCache, this.currentPickCode))
    return buildNavControlItem({
      controlName: PlayerManager.NEXT_CONTROL_NAME,
      direction: 'next',
      index: 11,
      enabled: state.hasNext,
      title: state.nextTitle ? `下一集：${state.nextTitle}` : '没有下一集',
      onClick: () => { void this.playNext() },
    })
  }

  private bindWindowResize() {
    if (this.cleanupResize) return
    const handleResize = () => this.scheduleVideoRotationReflow()
    window.addEventListener('resize', handleResize)
    this.cleanupResize = () => {
      window.removeEventListener('resize', handleResize)
      this.cleanupResize = null
    }
  }

  private bindRotationContainerObserver() {
    if (this.cleanupRotationContainerObserver || !this.artplayer?.video) return
    const container = this.artplayer.video.parentElement as HTMLElement | null
    if (!container || typeof ResizeObserver === 'undefined') return

    const observer = new ResizeObserver(() => {
      this.scheduleVideoRotationReflow()
    })
    observer.observe(container)

    this.cleanupRotationContainerObserver = () => {
      observer.disconnect()
      this.cleanupRotationContainerObserver = null
    }
  }

  private scheduleVideoRotationReflow() {
    if (this.rotationReflowRaf) {
      window.cancelAnimationFrame(this.rotationReflowRaf)
    }

    const run = () => {
      this.applyVideoRotation()
      this.rotationReflowRaf = window.requestAnimationFrame(() => {
        this.applyVideoRotation()
        this.rotationReflowRaf = 0
      })
    }

    this.rotationReflowRaf = window.requestAnimationFrame(run)
  }

  private applyVideoRotation() {
    if (!this.artplayer) return
    applyRotationToVideo({
      video: this.artplayer.video,
      container: this.artplayer.video.parentElement as HTMLElement | null,
      rotation: this.currentRotation,
    })
  }

  private rotateVideoClockwise() {
    this.currentRotation = getNextRotationDegrees(this.currentRotation)
    saveVideoRotation(this.currentPickCode, this.currentRotation)
    this.applyVideoRotation()
    this.renderRotateControl()
    this.overlay?.showToast(this.currentRotation === 0 ? '画面旋转已重置' : `画面已旋转 ${this.currentRotation}°`)
  }

  private applyPlaybackRate(value: number) {
    this.currentPlaybackRate = value
    if (this.artplayer) {
      this.artplayer.video.playbackRate = value
      try {
        ;(this.artplayer as any).playbackRate = value
      }
      catch {
        // Fallback to direct video playbackRate when the public setter is unavailable.
      }
    }
    this.renderSpeedControl()
  }

  private applyPlaybackModeSelection(mode: PlaybackMode) {
    this.currentPlaybackMode = mode
    savePlaybackMode(mode)
    this.renderPlaybackModeControl()
    this.overlay?.showToast(`播放模式：${getPlaybackModeLabel(mode)}`)
  }

  private getAudioTrackLabel(track: any, index: number) {
    const name = String(track?.name || '').trim()
    const lang = String(track?.lang || track?.attrs?.LANGUAGE || '').trim()
    const normalizedLang = lang.toLowerCase()
    const languageLabel = normalizedLang === 'chi' || normalizedLang === 'zh' || normalizedLang === 'zho'
      ? '中文'
      : (lang || '未知语言')

    if (name.toLowerCase() === 'stereo') {
      return `${languageLabel}${index + 1}`
    }

    if (name && languageLabel) {
      return `${name}（${languageLabel}）`
    }

    if (name) {
      return `${name} ${index + 1}`
    }

    return `${languageLabel}${index + 1}`
  }

  private syncAudioTracksFromHls() {
    const hls = this.hlsInstance as any
    const tracks = Array.isArray(hls?.audioTracks) ? hls.audioTracks : []
    if (tracks.length === 0) {
      return
    }
    this.audioTrackOptions = tracks.map((track: any, index: number) => ({
      id: index,
      label: this.getAudioTrackLabel(track, index),
    }))
    this.currentAudioTrackId = typeof hls?.audioTrack === 'number' ? hls.audioTrack : -1
    const active = this.audioTrackOptions.find(track => track.id === this.currentAudioTrackId)
    this.currentAudioTrackLabel = active?.label || (this.audioTrackOptions.length > 0 ? this.audioTrackOptions[0].label : '音轨')
    this.renderAudioControl()
    console.log('[115m][audio] tracks', {
      count: this.audioTrackOptions.length,
      currentAudioTrackId: this.currentAudioTrackId,
      options: this.audioTrackOptions,
      rawTracks: tracks.map((track: any, index: number) => ({
        index,
        id: track?.id,
        name: track?.name,
        lang: track?.lang,
        groupId: track?.groupId,
        url: track?.url,
        default: track?.default,
      })),
    })
  }

  private async hydrateAudioTracksFromMasterPlaylist() {
    try {
      const response = await fetch(`https://115.com/api/video/m3u8/${this.currentPickCode}.m3u8`, {
        credentials: 'include',
      })
      const text = await response.text()
      const tags = text.match(/#EXT-X-MEDIA:TYPE=AUDIO[^\n]*/ig) || []
      if (tags.length <= 1) {
        return
      }

      const fallbackTracks: AudioTrackOption[] = tags.map((tag, index) => {
        const name = tag.match(/NAME="([^"]+)"/i)?.[1] || ''
        const lang = tag.match(/LANGUAGE="([^"]+)"/i)?.[1] || ''
        const normalizedLang = lang.toLowerCase()
        const languageLabel = normalizedLang === 'chi' || normalizedLang === 'zh' || normalizedLang === 'zho'
          ? '中文'
          : (lang || '未知语言')
        const label = name.toLowerCase() === 'stereo'
          ? `${languageLabel}${index + 1}`
          : (name ? `${name}（${languageLabel}）` : `${languageLabel}${index + 1}`)
        return { id: index, label }
      })

      if (this.audioTrackOptions.length === 0) {
        this.audioTrackOptions = fallbackTracks
        this.currentAudioTrackId = 0
        this.currentAudioTrackLabel = fallbackTracks[0]?.label || '音轨'
        this.renderAudioControl()
        console.log('[115m][audio] fallback tracks from master playlist', fallbackTracks)
      }
    }
    catch (error) {
      console.warn('[115m][audio] hydrateAudioTracksFromMasterPlaylist failed', error)
    }
  }

  private applyAudioTrack(id: number) {
    const hls = this.hlsInstance as any
    if (!hls || typeof hls.audioTrack !== 'number') {
      this.overlay?.showToast('当前播放链路暂不支持切换音轨')
      return
    }
    const currentTime = this.artplayer?.currentTime || 0
    const shouldResume = !!this.artplayer && !this.artplayer.video.paused
    const track = Array.isArray(hls.audioTracks) ? hls.audioTracks[id] : null
    this.preferredAudioTrackId = id
    this.currentAudioTrackId = id
    const active = this.audioTrackOptions.find(track => track.id === id)
    if (active) {
      this.currentAudioTrackLabel = active.label
    }
    this.renderAudioControl()

    void this.rebuildHlsForAudioTrack({
      id,
      currentTime,
      shouldResume,
      track,
    })
  }

  private async rebuildHlsForAudioTrack(params: {
    id: number
    currentTime: number
    shouldResume: boolean
    track: any
  }) {
    if (!this.artplayer || !this.currentHlsLogicalUrl) {
      this.overlay?.showToast('当前播放链路暂不支持切换音轨')
      return
    }

    const video = this.artplayer.video as HTMLVideoElement
    const targetUrl = this.currentHlsLogicalUrl

    try {
      await this.initHls(video, targetUrl)
      if (!this.hlsInstance) {
        return
      }

      const restore = () => {
        if (!this.artplayer) return
        try {
          this.artplayer.seek = params.currentTime
        }
        catch {
          // ignore seek restore errors
        }
        if (params.shouldResume) {
          safePlay(this.artplayer)
        }
      }

      this.artplayer.once('video:loadedmetadata', restore)
      this.artplayer.once('video:canplay', restore)

      console.log('[115m][audio] rebuild track', {
        id: params.id,
        currentTime: params.currentTime,
        track: params.track,
        targetUrl,
      })
      this.overlay?.showToast(`已切换到${this.currentAudioTrackLabel}`)
    }
    catch (error) {
      console.warn('[115m][audio] rebuild track failed', error)
      this.overlay?.showToast('切换音轨失败，请重试')
    }
  }

  private renderPlaybackNavControls() {
    if (!this.artplayer) return
    updateArtplayerControl(this.artplayer, PlayerManager.PREV_CONTROL_NAME, this.buildPrevControlItem())
    updateArtplayerControl(this.artplayer, PlayerManager.NEXT_CONTROL_NAME, this.buildNextControlItem())
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

    this.nativePlaybackRetryCount = 0
    this.currentPlaybackType = !!this.ultraUrl && opt.url === this.ultraUrl ? 'native' : 'hls'

    this.applyPlaybackStatePatch(applySelectedQualityOption(this.getPlaybackState(), opt))
    this.renderQualityPanel()

    // 记住用户手动选择的画质
    saveQualityPreference(this.currentPickCode, opt.label, opt.quality)

    try {
      await this.artplayer.switchQuality(opt.url)
    }
    catch (error) {
      if (!this.artplayer) return
      this.updateQualityByUrl(this.artplayer.url || '')
      this.renderQualityPanel()
      this.overlay?.showToast(error instanceof Error ? error.message : '切换画质失败')
    }
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
      onPlaylistOpenChange: () => {
        this.hoverPreview?.refresh()
      },
      onPlaylistPlay: (pickCode, keepPlaylistOpen) => {
        if (pickCode && pickCode !== this.currentPickCode) {
          this.navigateToVideo(pickCode, keepPlaylistOpen)
        }
      },
      onPlaylistMove: async item => await this.movePlaylistVideo(item),
      onPlaylistDelete: async item => await this.deletePlaylistVideo(item),
      onDeleteFile: async (fileId, parentId, pickCode) => await this.deleteCurrentVideo(fileId, parentId, pickCode),
      onPlayPrevious: () => this.playPrevious(),
      onPlayNext: () => this.playNext(),
      onReplay: () => this.replayCurrent(),
      getCurrentPickCode: () => this.currentPickCode,
      shouldKeepPlaylistOpen: () => this.keepPlaylistOpenOnInit,
    })
    this.overlay.init()
    const runtime = getRuntimeApi()
    runtime?.onMessage?.removeListener(this.handleRuntimeMessage)
    runtime?.onMessage?.addListener(this.handleRuntimeMessage)
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


  private async fallbackToHls(reason = '播放失败') {
    this.clearNativeAudioProbe()
    console.log('[115m] fallbackToHls triggered, current m3u8List length:', this.m3u8List.length, 'reason:', reason)
    
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
    this.currentPlaybackType = 'hls'
    if (!bestQualityUrl) {
      this.showError('播放失败，无可用的视频源')
      return
    }
    
    console.log('[115m] fallbackToHls: switching to', bestQualityUrl.substring(0, 80) + '...')
    this.renderQualityPanel()
    this.overlay?.showToast(`${reason}，已切换 115原画`)
    try {
      await this.artplayer.switchUrl(bestQualityUrl)
    }
    catch (error) {
      console.error('[115m] fallbackToHls switchUrl failed:', error)
      this.showError('播放失败，无可用的视频源')
    }
  }

  private clearNativeAudioProbe() {
    if (this.nativeAudioProbeTimer != null) {
      window.clearTimeout(this.nativeAudioProbeTimer)
      this.nativeAudioProbeTimer = null
    }
  }

  private scheduleNativeAudioProbe() {
    this.clearNativeAudioProbe()
    this.nativeAudioProbeTimer = window.setTimeout(() => {
      this.nativeAudioProbeTimer = null
      void this.checkNativeAudioDecode()
    }, 2500)
  }

  private async checkNativeAudioDecode() {
    if (!this.artplayer || !this.isNativeVideo || this.currentPlaybackType !== 'native') return
    const video = this.artplayer.video as HTMLVideoElement & { webkitAudioDecodedByteCount?: number }
    if (video.paused || video.currentTime < 1) {
      this.scheduleNativeAudioProbe()
      return
    }
    const decodedBytes = video.webkitAudioDecodedByteCount
    if (typeof decodedBytes !== 'number' || decodedBytes > 0) return
    const hasHlsAudioTracks = await this.masterPlaylistHasAudioTracks()
    if (!hasHlsAudioTracks) return
    console.warn('[115m][audio] native source has no decoded audio, fallback to HLS')
    await this.fallbackToHls('无损音频不兼容')
  }

  private async masterPlaylistHasAudioTracks() {
    const masterText = await this.fetchMasterPlaylistText()
    return !!masterText && /#EXT-X-MEDIA:TYPE=AUDIO/i.test(masterText)
  }

  private async handleNativePlaybackError() {
    if (!this.artplayer) return

    const hasStartedPlaying = !!this.perfMarks.playing
    if (shouldRetryNativePlayback({ retryCount: this.nativePlaybackRetryCount, hasStartedPlaying })) {
      this.nativePlaybackRetryCount += 1
      this.retryNativePlayback()
      return
    }

    if (hasStartedPlaying) {
      this.overlay?.showToast('无损播放出现波动，请稍后重试，或手动切换 115原画')
      return
    }

    await this.fallbackToHls()
  }

  private retryNativePlayback() {
    if (!this.artplayer) return

    const retryUrl = this.ultraUrl || this.artplayer.url || ''
    if (!retryUrl) return

    const currentTime = this.artplayer.currentTime || 0
    const shouldResume = !this.artplayer.video.paused || currentTime <= 0

    this.artplayer.once('video:loadedmetadata', () => {
      if (!this.artplayer) return
      if (currentTime > 0) {
        this.artplayer.seek = currentTime
      }
      if (shouldResume) {
        safePlay(this.artplayer)
      }
    })

    this.artplayer.url = retryUrl
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
    const temporaryPlaylist = readTemporaryPlayerPlaylist(this.playlistToken)
    if (temporaryPlaylist.some(item => item.pickCode === this.currentPickCode)) {
      return temporaryPlaylist
    }

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
    this.renderPlaybackNavControls()
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

    const playbackPlan = buildPlaybackModePlan(this.currentPlaybackMode, !!next)
    if (playbackPlan === 'repeat') {
      this.replayCurrent()
      return
    }
    if (playbackPlan === 'next' && next) {
      this.navigateToVideo(next.pickCode, this.overlay?.isPlaylistExpanded() === true, true)
      return
    }
    if (playbackPlan === 'stop') {
      return
    }

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
    const result = await dialog.show()
    if (result.moved) {
      this.handleCurrentVideoMoved()
    }
  }

  private async movePlaylistVideo(item: OverlayPlaylistItem): Promise<void> {
    if (!item.fileId) {
      this.overlay?.showToast('文件 ID 缺失')
      return
    }

    const parentId = this.getPlaylistItemParentId(item)
    const dialog = new MoveDialog(
      item.fileId,
      parentId || '0',
      () => item.pickCode === this.currentPickCode ? this.refreshBreadcrumbs() : undefined,
    )
    const result = await dialog.show()
    if (result.moved) {
      this.handlePlaylistVideoMoved(item.pickCode)
    }
  }

  private handleCurrentVideoMoved() {
    this.handlePlaylistVideoMoved(this.currentPickCode)
  }

  private handlePlaylistVideoMoved(movedPickCode: string) {
    if (!movedPickCode) return

    const beforeCount = this.playlistItemsCache.length
    this.playlistItemsCache = this.playlistItemsCache.filter(item => item.pickCode !== movedPickCode)
    if (this.playlistItemsCache.length === beforeCount) return

    this.syncOverlayPlaybackNav()
    this.overlay?.updatePlaylist(this.playlistItemsCache)
  }

  private getPlaylistItemParentId(item: OverlayPlaylistItem): string {
    if (item.pickCode === this.currentPickCode) {
      return this.currentParentId()
    }
    return readPlaylistCidFromLocation(window.location.search) || this.currentParentId()
  }

  private currentParentId(): string {
    const meta = readOverlayMetaFromQuery()
    return meta.cid || meta.parentId || '0'
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
    await this.deleteVideoFromPlaylist({ fileId, parentId, pickCode, navigateAfterDelete: true })
  }

  private async deletePlaylistVideo(item: OverlayPlaylistItem): Promise<void> {
    if (!item.fileId || !item.pickCode) {
      this.overlay?.showToast('缺少删除参数')
      return
    }
    await this.deleteVideoFromPlaylist({
      fileId: item.fileId,
      parentId: this.getPlaylistItemParentId(item),
      pickCode: item.pickCode,
      navigateAfterDelete: item.pickCode === this.currentPickCode,
    })
  }

  private async deleteVideoFromPlaylist(params: {
    fileId: string
    parentId: string
    pickCode: string
    navigateAfterDelete: boolean
  }): Promise<void> {
    const { fileId, parentId, pickCode, navigateAfterDelete } = params
    const items = await this.fetchPlaylistItems().catch(() => this.playlistItemsCache)
    const { nextPickCode } = getDeleteFallback(items, pickCode)
    const keepPlaylistOpen = this.keepPlaylistOpenOnInit || this.overlay?.isPlaylistExpanded() === true

    await deleteVideoFile(sendRuntimeMessageSafe, fileId, parentId, pickCode)
    await deletePlayHistory(pickCode)

    this.playlistItemsCache = this.playlistItemsCache.filter(item => item.pickCode !== pickCode)
    this.syncOverlayPlaybackNav()
    this.overlay?.updatePlaylist(this.playlistItemsCache)

    if (!navigateAfterDelete) {
      this.overlay?.showToast('已删除')
      return
    }

    if (nextPickCode) {
      this.navigateToVideo(nextPickCode, keepPlaylistOpen, true)
      return
    }

    if (window.history.length > 1) {
      window.history.back()
      return
    }

    window.close()
  }

  private navigateToVideo(pickCode: string, keepPlaylistOpen = false, autoPlay = false) {
    void this.switchToVideo(pickCode, keepPlaylistOpen, autoPlay)
  }

  private async switchToVideo(pickCode: string, keepPlaylistOpen = false, autoPlay = false) {
    if (!this.artplayer || !pickCode || pickCode === this.currentPickCode) return

    const requestId = ++this.switchVideoRequestId
    const targetItem = findPlaylistItemByPickCode(this.playlistItemsCache, pickCode)

    this.clearPlaybackEndState()

    try {
      const playback = await this.resolvePlaybackForPickCode(pickCode)
      if (requestId !== this.switchVideoRequestId || !this.artplayer) return

      this.currentPickCode = pickCode
      this.currentRotation = loadVideoRotation(pickCode)
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
      await this.artplayer.switchUrl(playback.initialPlayback.url)
      if (requestId !== this.switchVideoRequestId || !this.artplayer) return

      this.setupProgressHoverPreview(playback.initialPlayback.url, playback.initialPlayback.type)
      this.renderQualityPanel()
      this.renderPlaybackNavControls()
      this.renderRotateControl()
      this.applyVideoRotation()

      if (autoPlay) {
        safePlay(this.artplayer)
      }

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
    const playback = await resolvePlaybackBundle(sendRuntimeMessageSafe, pickCode, this.nativeUltraSupported)

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
    this.nativePlaybackRetryCount = 0
    this.ultraUrl = playback.ultraUrl
    this.m3u8List = playback.m3u8List
    this.isNativeVideo = playback.initialPlayback.isNativeVideo
    this.currentPlaybackType = playback.initialPlayback.type
    this.currentQuality = playback.initialPlayback.currentQuality
    this.currentQualityLabel = playback.initialPlayback.currentQualityLabel
    this.qualityOptions = buildQualityOptions(
      '',
      this.nativeUltraSupported ? (playback.initialPlayback.type === 'native' ? playback.initialPlayback.url : playback.ultraUrl) : null,
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
    this.clearNativeAudioProbe()
    const runtime = getRuntimeApi()
    runtime?.onMessage?.removeListener(this.handleRuntimeMessage)
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
    if (this.cleanupResize) {
      this.cleanupResize()
    }
    if (this.hlsInstance) {
      this.hlsInstance.destroy()
      this.hlsInstance = null
    }
    if (this.currentHlsSourceUrl?.startsWith('blob:')) {
      URL.revokeObjectURL(this.currentHlsSourceUrl)
    }
    this.currentHlsSourceUrl = null
    this.currentHlsLogicalUrl = null
    this.clearAudioTrackSyncTimers()
    if (this.artplayer) {
      this.artplayer.destroy()
      this.artplayer = null
    }
  }
}

let playerManager: PlayerManager | null = null

function initPlayer() {
  const { pickCode, traceId, clickTs, keepPlaylistOpen, playlistToken } = readPlayerBootstrapConfig(window.location.search)

  if (!pickCode) {
    const el = document.getElementById('artplayer-app')
    if (el) {
      el.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100vh;color:#ff4d4f;font-size:18px;">缺少 pickCode 参数</div>'
    }
    return
  }

  playerManager = new PlayerManager({ pickCode, traceId, clickTs, keepPlaylistOpen, playlistToken })
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
