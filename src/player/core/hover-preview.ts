import type Artplayer from 'artplayer'
import { createHoverPreviewElements, findProgressElement } from './dom'
import { clamp, findNearestCover, formatTimeLabel, formatVttTime } from './hover-utils'

interface HoverCover {
  time: number
  imgUrl: string
}

export class HoverPreviewController {
  private covers: HoverCover[] = []
  private previewEl: HTMLDivElement | null = null
  private previewImgEl: HTMLImageElement | null = null
  private previewTimeEl: HTMLDivElement | null = null
  private progressEl: HTMLElement | null = null
  private bindRetryTimer: number | null = null
  private hideTimer: number | null = null
  private thumbnailsLoading = false
  private thumbnailsLoaded = false
  private hoverReticle: HTMLDivElement | null = null

  constructor(
    private readonly art: Artplayer,
    private readonly pickCode: string,
  ) {}

  setup() {
    this.ensurePreviewElements()
    this.bindProgressHoverEventsWithRetry(0)
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
    this.cancelHide()
    // 事件绑定在 root 上
    const root = this.art.template.$player as HTMLElement
    root.removeEventListener('mousemove', this.handleRootMouseMove)
    root.removeEventListener('mouseleave', this.handleRootMouseLeave)
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
    }
    this.covers = []
  }

  private async loadThumbnails() {
    if (this.thumbnailsLoaded || this.thumbnailsLoading) return
    this.thumbnailsLoading = true
    try {
      const { getVideoCovers } = await import('../../lib/videoThumbnail')

      let duration = this.art.duration
      if (!duration || duration < 5) {
        await new Promise<void>((resolve) => {
          this.art.once('video:loadedmetadata', () => resolve())
          setTimeout(resolve, 5000)
        })
        duration = this.art.duration
      }

      if (!duration) return

      const covers = await getVideoCovers(this.pickCode, duration, 30)
      if (covers.length === 0) return

      this.covers = covers

      let vtt = 'WEBVTT\n\n'
      covers.forEach((cover: HoverCover) => {
        const tDuration = duration / covers.length
        const startTime = formatVttTime(Math.max(0, cover.time - tDuration / 2))
        const endTime = formatVttTime(Math.min(duration, cover.time + tDuration / 2))
        vtt += `${startTime} --> ${endTime}\n${cover.imgUrl}\n\n`
      })

      const blob = new Blob([vtt], { type: 'text/vtt' })
      const vttUrl = URL.createObjectURL(blob)
      this.art.emit('artplayerPluginThumbnail:update', { url: vttUrl })
      this.thumbnailsLoaded = true
    }
    catch {
      // ignore thumbnail errors
    }
    finally {
      this.thumbnailsLoading = false
    }
  }

  private ensurePreviewElements() {
    if (this.previewEl) return

    const refs = createHoverPreviewElements(this.art)
    this.previewEl = refs.preview
    this.previewImgEl = refs.image
    this.previewTimeEl = refs.time
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

  private handleProgressMouseEnter = () => {
    this.cancelHide()
    if (!this.thumbnailsLoaded && !this.thumbnailsLoading) {
      void this.loadThumbnails()
    }
    if (this.previewEl && this.covers.length > 0) {
      this.previewEl.style.display = 'block'
    }
  }

  private handleProgressMouseLeave = () => {
    // 使用延迟隐藏，给鼠标一点容错空间
    this.scheduleHide()
  }

  private handleRootMouseMove = (event: MouseEvent) => {
    // 取消隐藏定时器（鼠标还在播放器区域内）
    this.cancelHide()

    if (this.isFloatingMenuOpen()) {
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
      // 鼠标远离进度条，隐藏预览图
      this.hidePreview()
    }
  }

  private handleRootMouseLeave = () => {
    this.hidePreview()
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
    if (this.previewEl) {
      this.previewEl.style.display = 'none'
    }
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
    ]

    return selectors.some((selector) => {
      const nodes = root.querySelectorAll<HTMLElement>(selector)
      return Array.from(nodes).some((node) => {
        const style = window.getComputedStyle(node)
        return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0'
      })
    })
  }

  private updatePreviewPosition(event: MouseEvent) {
    if (!this.progressEl || !this.previewEl || !this.previewImgEl || !this.previewTimeEl) {
      return
    }
    if (this.covers.length === 0 || !this.art.duration) return
    if (this.isFloatingMenuOpen()) {
      this.hidePreview()
      return
    }

    const progressRect = this.progressEl.getBoundingClientRect()
    if (progressRect.width <= 0) return

    const raw = (event.clientX - progressRect.left) / progressRect.width
    const ratio = clamp(raw, 0, 1)
    const hoverTime = ratio * this.art.duration

    const nearest = findNearestCover(this.covers, hoverTime)
    if (!nearest) return

    if (nearest.imgUrl) {
      this.previewImgEl.src = nearest.imgUrl
    }
    this.previewTimeEl.textContent = formatTimeLabel(hoverTime)

    const containerRect = (this.art.template.$player as HTMLElement).getBoundingClientRect()
    const offsetX = event.clientX - containerRect.left
    const previewWidth = this.previewEl.offsetWidth || 182
    const minLeft = previewWidth / 2 + 5
    const maxLeft = Math.max(minLeft, containerRect.width - minLeft)
    const clamped = clamp(offsetX, minLeft, maxLeft)
    this.previewEl.style.left = `${clamped}px`
  }
}
