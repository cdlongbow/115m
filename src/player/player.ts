/**
 * 播放器页面逻辑
 */

console.log('[115m] player.ts loading...')

import Artplayer from 'artplayer'
import type HlsType from 'hls.js'
import type { M3u8Item } from '../lib/types'
import { buildArtplayerQuality, getQualityDisplayName } from './core/quality'
import { fetchM3u8WithRetry, fetchUltraSource } from './core/source'
import { loadPlayHistory } from './core/history'
import type { QualityOption } from './core/types'
import { runPlayerSmokeChecks } from './core/smoke'
import { renderPlayerError } from './core/dom'
import { createHlsInstance, isHlsSupported } from './core/hls'
import type { VideoPlaybackQualityLike } from './core/types'
import { HoverPreviewController } from './core/hover-preview'
import { bindPlayerEvents } from './core/events'
import { PlayerOverlayController, readOverlayMetaFromQuery, type OverlayPlaylistItem } from './core/overlay'
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

      // 确保 Service Worker 已就绪（冷启动时可能需要等待）
      const loadingTextEl = document.getElementById('loading-text')
      if (loadingTextEl) {
        loadingTextEl.textContent = '正在初始化...'
      }
      await ensureServiceWorkerReady()

      if (loadingTextEl) {
        loadingTextEl.textContent = '正在获取无损播放源...'
      }

      // 并行获取无损源和 HLS 源，为降级做准备
      const [ultraSource, m3u8List] = await Promise.all([
        fetchUltraSource(this.currentPickCode).catch((e) => {
          console.warn('[115m] fetchUltraSource failed:', e)
          return null
        }),
        fetchM3u8WithRetry(this.currentPickCode).catch((e) => {
          console.warn('[115m] fetchM3u8WithRetry failed:', e)
          return null
        }),
      ])

      console.log('[115m] Source fetch result:', {
        ultraOk: !!ultraSource,
        m3u8Ok: !!m3u8List,
        m3u8Count: m3u8List?.length || 0,
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

      if (ultraUrl) {
        // 默认无损播放
        this.isNativeVideo = true
        this.currentQuality = 9999
        this.currentQualityLabel = '无损'
        this.createArtplayer(ultraUrl, 'native')
        this.perf('create-player-native')
      }
      else if (this.m3u8List.length > 0) {
        // Ultra 不可用，降级到 HLS
        this.isNativeVideo = false
        this.currentQuality = this.m3u8List[0].quality
        this.currentQualityLabel = getQualityDisplayName(this.m3u8List[0].quality, true)
        this.createArtplayer(this.m3u8List[0].url, 'hls')
        this.perf('create-player-hls-fallback')
      }
      else {
        throw new Error('无法获取任何播放源，请检查网络或是否需要人机验证')
      }

      const currentUrl = this.artplayer?.url || ''
      this.refreshQualityState(currentUrl)
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

  private async initHls(video: HTMLVideoElement, url: string): Promise<HlsType> {
    const hls = await createHlsInstance(video, url)
    this.hlsInstance = hls
    return hls
  }

  private createArtplayer(videoUrl: string, type: 'native' | 'hls') {
    const container = document.getElementById('artplayer-app')
    if (!container) throw new Error('找不到播放器容器')

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
      quality: buildArtplayerQuality(this.qualityOptions, videoUrl, this.currentQualityLabel),
      loop: true,
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
          this.updateQualityButton()
        },
        onLoadedmetadata: () => {
          this.perfMarks.loadedmetadata = performance.now()
          this.updateQualityByUrl(this.artplayer?.url || '')
          this.updateQualityButton()
          this.renderQualityPanel()
          this.hoverPreview?.updateSize()
        },
        onCanplay: () => {
          this.perfMarks.canplay = performance.now()
        },
        onPlaying: () => {
          this.perfMarks.playing = performance.now()
          this.reportFirstFrameSummary()
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
    if (!this.artplayer) return
    this.overlay?.destroy()
    const meta = readOverlayMetaFromQuery()
    this.overlay = new PlayerOverlayController({
      art: this.artplayer,
      meta,
      onMoveFile: async (fileId, cid) => await this.moveFile(fileId, cid),
      onToggleFavorite: async (fileId, nextMarked) => await this.toggleFavorite(fileId, nextMarked),
      onPlaylistToggle: async open => open ? await this.fetchPlaylistItems() : [],
      onPlaylistPlay: (pickCode) => {
        if (pickCode && pickCode !== this.currentPickCode) {
          this.navigateToVideo(pickCode)
        }
      },
      onRefreshBreadcrumbs: () => this.refreshBreadcrumbs(),
      getCurrentPickCode: () => this.currentPickCode,
    })
    this.overlay.init()
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
    this.updateQualityButton()
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

  private async fetchPlaylistItems(): Promise<OverlayPlaylistItem[]> {
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
    if (!fileId || !cid) throw new Error('fileId/cid missing')

    const res = await sendRuntimeMessageSafe<{ ok?: boolean, error?: string }>({
      type: 'MOVE_FILE',
      data: {
        fileId,
        parentId: cid,
        cid,
      },
    })

    if (!res?.ok) {
      throw new Error(res?.error || 'move failed')
    }
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
    const params = new URLSearchParams(window.location.search)
    params.set('pick_code', pickCode)
    params.set('pickCode', pickCode)
    const title = this.overlay ? undefined : ''
    void title
    const playlistItem = document.querySelector(`[data-pickcode="${pickCode}"] .block.truncate`)?.textContent?.trim()
    if (playlistItem) {
      params.set('title', playlistItem)
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
