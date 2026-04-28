import type Artplayer from 'artplayer'
import { createHoverPreviewElements, findProgressElement } from './dom'
import { clamp, findNearestCover, formatTimeLabel, formatVttTime } from './hover-utils'

interface HoverCover {
  time: number
  imgUrl: string
}

function mergeCovers(covers: HoverCover[]): HoverCover[] {
  return [...covers]
    .sort((a, b) => a.time - b.time)
    .filter((cover, index, list) => {
      const previous = list[index - 1]
      if (!previous) {
        return true
      }
      return Math.abs(previous.time - cover.time) >= 0.5 || previous.imgUrl !== cover.imgUrl
    })
}

const PRECISE_COVER_BUCKET = 0.5
const PRECISE_COVER_MIN_DELTA = 1.5
const PRECISE_COVER_DEBOUNCE = 50
const COARSE_COVER_MAX_DELTA = 15
const PRECISE_PREFETCH_RANGE = 1
const PRECISE_SEEK_MAX_DELTA = 2.5

export class HoverPreviewController {
  private covers: HoverCover[] = []
  private previewEl: HTMLDivElement | null = null
  private previewImgEl: HTMLImageElement | null = null
  private previewTimeEl: HTMLDivElement | null = null
  private previewLoadingEl: HTMLDivElement | null = null
  private progressEl: HTMLElement | null = null
  private bindRetryTimer: number | null = null
  private hideTimer: number | null = null
  private thumbnailsLoading = false
  private thumbnailsLoaded = false
  private hoverReticle: HTMLDivElement | null = null
  private preciseCoverTimer: number | null = null
  private preciseCoverRequestKey: string | null = null
  private preciseCovers = new Map<number, HoverCover>()
  private preciseQueue: number[] = []
  private preloadTimer: number | null = null
  private lastHoverBucketTime: number | null = null
  private lastDisplayedCoverTime: number | null = null
  private hoverActive = false
  private lastPointerClientX: number | null = null
  private lastPointerClientY: number | null = null

  constructor(
    private readonly art: Artplayer,
    private readonly pickCode: string,
    private readonly previewSourceUrl: string | null = null,
  ) {}

  setup() {
    this.ensurePreviewElements()
    this.bindProgressHoverEventsWithRetry(0)
    this.art.on('video:loadedmetadata', this.handleVideoLoadedmetadata)
    this.scheduleThumbnailWarmup()
  }

  updateSize() {
    if (!this.previewImgEl || !this.previewEl) return
    const video = this.art.video as HTMLVideoElement | undefined
    if (!video) return

    const vw = video.videoWidth || 0
    const vh = video.videoHeight || 0

    if (vw > 0 && vh > 0) {
      if (vh > vw) {
        const height = 160
        const width = Math.round(height * (vw / vh))
        this.previewImgEl.style.width = `${width}px`
        this.previewImgEl.style.height = `${height}px`
        this.previewEl.style.minWidth = `${width + 12}px`
      }
      else {
        const width = 170
        const height = Math.round(width * (vh / vw))
        this.previewImgEl.style.width = `${width}px`
        this.previewImgEl.style.height = `${height}px`
        this.previewEl.style.minWidth = `${width + 12}px`
      }
    }
  }

  destroy() {
    if (this.bindRetryTimer) {
      window.clearTimeout(this.bindRetryTimer)
      this.bindRetryTimer = null
    }
    if (this.preciseCoverTimer) {
      window.clearTimeout(this.preciseCoverTimer)
      this.preciseCoverTimer = null
    }
    if (this.preloadTimer) {
      window.clearTimeout(this.preloadTimer)
      this.preloadTimer = null
    }
    this.art.off('video:loadedmetadata', this.handleVideoLoadedmetadata)
    this.cancelHide()
    // 事件绑定在 root 上
    const root = this.art.template.$player as HTMLElement
    root.removeEventListener('mousemove', this.handleRootMouseMove)
    root.removeEventListener('mouseleave', this.handleRootMouseLeave)
    this.progressEl?.removeEventListener('mouseenter', this.handleProgressMouseEnter)
    this.progressEl?.removeEventListener('mouseleave', this.handleProgressMouseLeave)
    this.progressEl?.removeEventListener('click', this.handleProgressClick, true)
    this.progressEl = null
    if (this.hoverReticle) {
      this.hoverReticle.remove()
      this.hoverReticle = null
    }
    if (this.previewEl) {
      this.previewEl.remove()
      this.previewEl = null
      this.previewImgEl = null
      this.previewTimeEl = null
      this.previewLoadingEl = null
    }
    this.covers = []
    this.preciseCovers.clear()
    this.preciseQueue = []
    this.preciseCoverRequestKey = null
    this.lastDisplayedCoverTime = null
  }

  private async loadThumbnails() {
    if (this.thumbnailsLoaded || this.thumbnailsLoading) return
    const duration = this.art.duration
    if (!duration || duration < 5) {
      return
    }

    this.thumbnailsLoading = true
    try {
      const { getTimelineCovers, getVideoCovers } = await import('../../lib/videoThumbnail')
      const timelineCovers = await getTimelineCovers(this.pickCode)
      if (timelineCovers.length > 0) {
        this.covers = mergeCovers([
          ...this.covers,
          ...timelineCovers.map(cover => ({ imgUrl: cover.imgUrl, time: cover.time })),
        ])
        this.updateThumbnailTrack(duration)
        this.thumbnailsLoaded = true
        this.refreshPreviewFromLastPointer()
      }

      const covers = await getVideoCovers(this.pickCode, duration, this.getInitialCoverCount(duration))
      if (covers.length === 0) return

      this.covers = mergeCovers([
        ...this.covers,
        ...covers.map(cover => ({ imgUrl: cover.imgUrl, time: cover.time })),
      ])
      this.updateThumbnailTrack(duration)
      this.thumbnailsLoaded = true
      this.refreshPreviewFromLastPointer()
    }
    catch {
      // ignore thumbnail errors
    }
    finally {
      this.thumbnailsLoading = false
    }
  }

  private scheduleThumbnailWarmup() {
    const tryWarmup = () => {
      if (this.thumbnailsLoaded || this.thumbnailsLoading) {
        return
      }
      void this.loadThumbnails()
    }

    if (this.art.duration >= 5) {
      this.preloadTimer = window.setTimeout(tryWarmup, 180)
      return
    }

    this.art.once('video:loadedmetadata', () => {
      this.preloadTimer = window.setTimeout(tryWarmup, 180)
    })
  }

  private ensurePreviewElements() {
    if (this.previewEl) return

    const refs = createHoverPreviewElements(this.art)
    this.previewEl = refs.preview
    this.previewImgEl = refs.image
    this.previewTimeEl = refs.time
    this.previewLoadingEl = refs.loading
  }

  private bindProgressHoverEventsWithRetry(retry: number) {
    const progress = findProgressElement(this.art)
    if (!progress) {
      if (retry >= 20) return
      this.bindRetryTimer = window.setTimeout(() => {
        this.bindProgressHoverEventsWithRetry(retry + 1)
      }, 300)
      return
    }

    this.progressEl = progress
    progress.addEventListener('mouseenter', this.handleProgressMouseEnter)
    progress.addEventListener('mouseleave', this.handleProgressMouseLeave)
    progress.addEventListener('click', this.handleProgressClick, true)

    // 创建一个覆盖进度条上方的不可见容差区域，
    // 这样鼠标从进度条移到预览图时不会触发 mouseleave
    this.createHoverReticle(progress)

    // 绑定在根播放器上，避免鼠标微移出进度条就消失
    const root = this.art.template.$player as HTMLElement
    root.addEventListener('mousemove', this.handleRootMouseMove)
    root.addEventListener('mouseleave', this.handleRootMouseLeave)
  }

  /**
   * 在进度条上方创建一个透明的容差区域，扩大可交互范围。
   * 同时让预览图（pointer-events:none）不会被鼠标碰到。
   */
  private createHoverReticle(progress: HTMLElement) {
    if (this.hoverReticle) return

    const reticle = document.createElement('div')
    reticle.style.cssText = [
      'position:absolute',
      'left:0',
      'bottom:0',
      'height:80px',
      'width:100%',
      'pointer-events:none',
      'z-index:0',
    ].join(';')

    const bottom = this.art.template.$bottom as HTMLElement
    if (bottom) {
      bottom.style.position = 'relative'
      bottom.appendChild(reticle)
    }

    this.hoverReticle = reticle
  }

  private handleProgressMouseEnter = (event: MouseEvent) => {
    this.hoverActive = true
    this.cancelHide()
    this.rememberPointer(event)
    if (!this.thumbnailsLoaded && !this.thumbnailsLoading) {
      void this.loadThumbnails()
    }
    if (this.art.duration) {
      this.updatePreviewPosition(event)
    }
    else if (this.previewEl && this.covers.length > 0) {
      this.previewEl.style.display = 'block'
    }
  }

  private handleProgressClick = (event: MouseEvent) => {
    if (!this.progressEl || !this.art.duration) {
      return
    }

    const hoverTime = this.getHoverTimeFromClientX(event.clientX)
    if (hoverTime == null) {
      return
    }

    // 始终跳转到用户点击的时间位置
    this.art.seek = hoverTime
  }

  private handleProgressMouseLeave = () => {
    // 使用延迟隐藏，给鼠标一点容错空间
    this.scheduleHide()
  }

  private handleRootMouseMove = (event: MouseEvent) => {
    // 取消隐藏定时器（鼠标还在播放器区域内）
    this.cancelHide()
    this.rememberPointer(event)

    if (this.shouldSuspendPreview(event.target)) {
      this.hidePreview()
      return
    }

    // 检查鼠标是否在进度条附近的垂直区域内（容差：进度条下方 10px ~ 上方 80px）
    if (!this.progressEl) return

    const progressRect = this.progressEl.getBoundingClientRect()
    const mouseY = event.clientY
    const tolerance = 80 // 进度条上方容差
    const belowTolerance = 10 // 进度条下方容差

    const isNearProgress = mouseY >= (progressRect.top - tolerance)
      && mouseY <= (progressRect.bottom + belowTolerance)
      && event.clientX >= progressRect.left - 10
      && event.clientX <= progressRect.right + 10

    if (isNearProgress) {
      this.hoverActive = true
      // 触发缩略图加载
      if (!this.thumbnailsLoaded && !this.thumbnailsLoading) {
        void this.loadThumbnails()
      }
      // 如果有缩略图且预览图隐藏了，显示它
      if (this.previewEl && this.covers.length > 0 && this.previewEl.style.display === 'none') {
        this.previewEl.style.display = 'block'
      }
      // 更新预览图位置
      if (this.art.duration) {
        this.updatePreviewPosition(event)
      }
    }
    else {
      this.hoverActive = false
      // 鼠标远离进度条，隐藏预览图
      this.hidePreview()
    }
  }

  private handleRootMouseLeave = () => {
    this.hoverActive = false
    this.lastPointerClientX = null
    this.lastPointerClientY = null
    this.lastDisplayedCoverTime = null
    this.hidePreview()
  }

  private handleVideoLoadedmetadata = () => {
    this.refreshPreviewFromLastPointer()
  }

  private scheduleHide() {
    this.cancelHide()
    this.hideTimer = window.setTimeout(() => {
      this.hidePreview()
    }, 200) // 200ms 延迟，避免鼠标微移就消失
  }

  private cancelHide() {
    if (this.hideTimer) {
      window.clearTimeout(this.hideTimer)
      this.hideTimer = null
    }
  }

  private hidePreview() {
    this.hoverActive = false
    if (this.previewEl) {
      this.previewEl.style.display = 'none'
    }
    if (this.previewLoadingEl) {
      this.previewLoadingEl.style.display = 'none'
    }
  }

  private rememberPointer(event: MouseEvent) {
    this.lastPointerClientX = event.clientX
    this.lastPointerClientY = event.clientY
  }

  private refreshPreviewFromLastPointer() {
    if (!this.hoverActive || !this.progressEl || !this.previewEl || !this.art.duration) {
      return
    }
    if (this.lastPointerClientX == null || this.lastPointerClientY == null) {
      return
    }

    this.updatePreviewPosition(new MouseEvent('mousemove', {
      clientX: this.lastPointerClientX,
      clientY: this.lastPointerClientY,
      bubbles: true,
      cancelable: true,
      view: window,
    }))
  }

  private isFloatingMenuOpen() {
    const root = this.art.template.$player as HTMLElement
    const selectors = [
      '.art-settings',
      '.art-setting',
      '.art-setting-body',
      '.art-selector',
      '.art-selector-list',
      '.art-control-selector:hover',
      '.art-qualitys',
      '.art-contextmenus',
      '.art-volume-panel',
    ]

    return selectors.some((selector) => {
      const nodes = root.querySelectorAll<HTMLElement>(selector)
      return Array.from(nodes).some((node) => {
        const style = window.getComputedStyle(node)
        return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0'
      })
    })
  }

  private getInitialCoverCount(duration: number): number {
    // 目标：每张封面覆盖 10-15 秒
    if (duration <= 2 * 60) {
      return 12  // 2分钟 → 12张，每张约10秒
    }
    if (duration <= 5 * 60) {
      return 24  // 5分钟 → 24张，每张约12秒
    }
    if (duration <= 10 * 60) {
      return 48  // 10分钟 → 48张，每张约12秒
    }
    if (duration <= 30 * 60) {
      return 90  // 30分钟 → 90张，每张约20秒
    }
    if (duration <= 60 * 60) {
      return 150 // 1小时 → 150张，每张约24秒
    }
    return 200   // 超过1小时 → 200张
  }

  private updateThumbnailTrack(duration: number) {
    let vtt = 'WEBVTT\n\n'
    const covers = [...this.covers].sort((a, b) => a.time - b.time)

    covers.forEach((cover: HoverCover, index) => {
      const prevTime = covers[index - 1]?.time ?? 0
      const nextTime = covers[index + 1]?.time ?? duration
      const startTime = formatVttTime(Math.max(0, (prevTime + cover.time) / 2))
      const endTime = formatVttTime(Math.min(duration, (cover.time + nextTime) / 2))
      vtt += `${startTime} --> ${endTime}\n${cover.imgUrl}\n\n`
    })

    const blob = new Blob([vtt], { type: 'text/vtt' })
    const vttUrl = URL.createObjectURL(blob)
    this.art.emit('artplayerPluginThumbnail:update', { url: vttUrl })
  }

  private getPreciseBucketTime(hoverTime: number): number {
    return Math.round(hoverTime / PRECISE_COVER_BUCKET) * PRECISE_COVER_BUCKET
  }

  private insertCover(cover: HoverCover) {
    const exists = this.covers.some(item => Math.abs(item.time - cover.time) < 0.5)
    if (!exists) {
      this.covers = [...this.covers, cover].sort((a, b) => a.time - b.time)
    }
  }

  private schedulePreciseCover(hoverTime: number, nearest: HoverCover | null) {
    if (!this.art.duration) {
      return
    }

    const bucketTime = this.getPreciseBucketTime(hoverTime)
    const cacheHit = this.preciseCovers.get(bucketTime)
    if (cacheHit) {
      this.prefetchNearbyPreciseCovers(bucketTime)
      return
    }

    // 如果粗略封面已经足够接近，不需要加载精确封面
    if (nearest && Math.abs(nearest.time - hoverTime) < PRECISE_COVER_MIN_DELTA) {
      return
    }

    // 立即加载精确封面（不等待）
    this.enqueuePreciseCover(bucketTime, true)
    this.prefetchNearbyPreciseCovers(bucketTime)
  }

  private enqueuePreciseCover(bucketTime: number, prioritize = false) {
    if (this.preciseCovers.has(bucketTime)) {
      return
    }

    const requestKey = `${this.pickCode}:${bucketTime}`
    if (this.preciseCoverRequestKey === requestKey) {
      return
    }

    if (!this.preciseQueue.includes(bucketTime)) {
      if (prioritize) {
        this.preciseQueue.unshift(bucketTime)
      }
      else {
        this.preciseQueue.push(bucketTime)
      }
    }

    if (!this.preciseCoverRequestKey) {
      const nextBucketTime = this.preciseQueue.shift()
      if (nextBucketTime != null) {
        void this.loadPreciseCover(nextBucketTime)
      }
    }
  }

  private prefetchNearbyPreciseCovers(bucketTime: number) {
    if (!this.art.duration) {
      return
    }

    for (let offset = 1; offset <= PRECISE_PREFETCH_RANGE; offset += 1) {
      const previousBucket = this.getPreciseBucketTime(Math.max(0, bucketTime - offset * PRECISE_COVER_BUCKET))
      const nextBucket = this.getPreciseBucketTime(Math.min(this.art.duration, bucketTime + offset * PRECISE_COVER_BUCKET))
      this.enqueuePreciseCover(previousBucket)
      this.enqueuePreciseCover(nextBucket)
    }
  }

  private async loadPreciseCover(bucketTime: number) {
    if (!this.art.duration) {
      return
    }

    const requestKey = `${this.pickCode}:${bucketTime}`
    if (this.preciseCovers.has(bucketTime)) {
      return
    }

    // 如果当前有请求在处理，将新请求加入队列（高优先级）
    if (this.preciseCoverRequestKey) {
      if (!this.preciseQueue.includes(bucketTime)) {
        this.preciseQueue.unshift(bucketTime) // 高优先级
      }
      return
    }

    this.preciseCoverRequestKey = requestKey
    try {
      const cover = await this.loadFallbackPreciseCover(bucketTime)
      if (!cover) {
        return
      }

      const preciseCover: HoverCover = {
        imgUrl: cover.imgUrl,
        time: cover.time,
      }

      this.preciseCovers.set(bucketTime, preciseCover)

      // 如果当前悬停位置匹配这个桶，立即更新预览图
      if (this.hoverActive && this.lastHoverBucketTime === bucketTime && this.previewEl && this.previewImgEl) {
        this.previewImgEl.src = preciseCover.imgUrl
        this.previewImgEl.style.visibility = 'visible'
        if (this.previewLoadingEl) {
          this.previewLoadingEl.style.display = 'none'
        }
        this.previewEl.style.display = 'block'
        this.refreshPreviewFromLastPointer()
      }
    }
    catch {
      // ignore thumbnail errors
    }
    finally {
      if (this.preciseCoverRequestKey === requestKey) {
        this.preciseCoverRequestKey = null
      }

      // 处理队列中的下一个请求
      const nextBucketTime = this.preciseQueue.shift()
      if (nextBucketTime != null && nextBucketTime !== bucketTime) {
        void this.loadPreciseCover(nextBucketTime)
      }
    }
  }

  private async loadFallbackPreciseCover(bucketTime: number) {
    const { getVideoCoverAt } = await import('../../lib/videoThumbnail')
    return await getVideoCoverAt(this.pickCode, bucketTime, this.art.duration)
  }

  private shouldSuspendPreview(target: EventTarget | null) {
    if (this.isFloatingMenuOpen()) return true
    if (!(target instanceof Element)) return false

    return Boolean(target.closest([
      '.art-control-volume',
      '.art-volume-panel',
      '.art-volume-slider',
      '.art-volume-handle',
      '.art-volume-indicator',
    ].join(', ')))
  }

  private updatePreviewPosition(event: MouseEvent) {
    if (!this.progressEl || !this.previewEl || !this.previewImgEl || !this.previewTimeEl) {
      return
    }
    if (!this.art.duration) return
    if (this.shouldSuspendPreview(event.target)) {
      this.hidePreview()
      return
    }

    const hoverTime = this.getHoverTimeFromClientX(event.clientX)
    if (hoverTime == null) return

    const preciseBucketTime = this.getPreciseBucketTime(hoverTime)
    this.lastHoverBucketTime = preciseBucketTime
    const preciseCover = this.preciseCovers.get(preciseBucketTime)
    const coarseCover = findNearestCover(this.covers, hoverTime)
    const nearest = preciseCover
      ?? (coarseCover && Math.abs(coarseCover.time - hoverTime) <= COARSE_COVER_MAX_DELTA ? coarseCover : null)

    const containerRect = (this.art.template.$player as HTMLElement).getBoundingClientRect()
    const offsetX = event.clientX - containerRect.left
    const previewWidth = this.previewEl.offsetWidth || 182
    const minLeft = previewWidth / 2 + 5
    const maxLeft = Math.max(minLeft, containerRect.width - minLeft)
    const clamped = clamp(offsetX, minLeft, maxLeft)
    this.previewEl.style.left = `${clamped}px`

    if (nearest?.imgUrl) {
      this.previewImgEl.src = nearest.imgUrl
      this.previewImgEl.style.visibility = 'visible'
      if (this.previewLoadingEl) {
        this.previewLoadingEl.style.display = 'none'
      }
      this.previewEl.style.display = 'block'
      this.lastDisplayedCoverTime = nearest.time
    }
    else {
      // 没有合适的封面（精确封面未加载，粗略封面距离太远）
      // 显示加载状态，等待精确封面
      this.previewImgEl.style.visibility = 'hidden'
      if (this.previewLoadingEl) {
        this.previewLoadingEl.style.display = 'flex'
      }
      this.previewEl.style.display = 'block'
      this.lastDisplayedCoverTime = null
    }
    this.previewTimeEl.textContent = formatTimeLabel(this.lastDisplayedCoverTime ?? hoverTime)
    this.schedulePreciseCover(hoverTime, nearest)

    if (!nearest) {
      return
    }
  }

  private getHoverTimeFromClientX(clientX: number): number | null {
    if (!this.progressEl || !this.art.duration) {
      return null
    }

    const progressRect = this.progressEl.getBoundingClientRect()
    if (progressRect.width <= 0) {
      return null
    }

    const raw = (clientX - progressRect.left) / progressRect.width
    const ratio = clamp(raw, 0, 1)
    return ratio * this.art.duration
  }
}
