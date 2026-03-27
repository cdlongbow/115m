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
  private thumbnailsLoading = false
  private thumbnailsLoaded = false

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
    if (this.progressEl) {
      this.progressEl.removeEventListener('mousemove', this.handleProgressMouseMove)
      this.progressEl.removeEventListener('mouseenter', this.handleProgressMouseEnter)
      this.progressEl.removeEventListener('mouseleave', this.handleProgressMouseLeave)
      this.progressEl = null
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
    progress.addEventListener('mousemove', this.handleProgressMouseMove)
    progress.addEventListener('mouseenter', this.handleProgressMouseEnter)
    progress.addEventListener('mouseleave', this.handleProgressMouseLeave)
  }

  private handleProgressMouseEnter = () => {
    if (!this.thumbnailsLoaded && !this.thumbnailsLoading) {
      void this.loadThumbnails()
    }
    if (this.previewEl && this.covers.length > 0) {
      this.previewEl.style.display = 'block'
    }
  }

  private handleProgressMouseLeave = () => {
    if (this.previewEl) {
      this.previewEl.style.display = 'none'
    }
  }

  private handleProgressMouseMove = (event: MouseEvent) => {
    if (!this.progressEl || !this.previewEl || !this.previewImgEl || !this.previewTimeEl) {
      return
    }
    if (this.covers.length === 0 || !this.art.duration) return

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
