import { getVideoCovers } from '../../lib/videoThumbnail'
import type { FileInfo } from './types'
import {
  Scheduler,
  TaskCancelledError,
  createVisibilityObserver,
  createScrollStopDetector,
  findScrollContainer,
} from './utils'

const coverScheduler = new Scheduler(3)

interface CoverItem {
  imgUrl: string
  time: number
}

interface LightboxController {
  open: (covers: CoverItem[], startIndex: number) => void
}

const lightboxByDoc = new WeakMap<Document, LightboxController>()

function createLightboxController(doc: Document): LightboxController {
  const lightbox = doc.createElement('div')
  lightbox.className = 'm115-lightbox'

  const prevBtn = doc.createElement('button')
  prevBtn.className = 'm115-lightbox-btn m115-lightbox-prev'
  prevBtn.type = 'button'
  prevBtn.textContent = '<'

  const nextBtn = doc.createElement('button')
  nextBtn.className = 'm115-lightbox-btn m115-lightbox-next'
  nextBtn.type = 'button'
  nextBtn.textContent = '>'

  const mainImg = doc.createElement('img')
  mainImg.className = 'm115-lightbox-main-img'
  mainImg.alt = '预览大图'

  lightbox.appendChild(prevBtn)
  lightbox.appendChild(mainImg)
  lightbox.appendChild(nextBtn)
  doc.body.appendChild(lightbox)

  let activeCovers: CoverItem[] = []
  let currentIndex = 0
  let wheelLock = false

  const close = () => {
    lightbox.classList.remove('active')
  }

  const render = () => {
    const current = activeCovers[currentIndex]
    if (!current) return
    mainImg.src = current.imgUrl
  }

  const move = (step: number) => {
    if (activeCovers.length <= 1) return
    currentIndex = (currentIndex + step + activeCovers.length) % activeCovers.length
    render()
  }

  prevBtn.addEventListener('click', (event) => {
    event.stopPropagation()
    move(-1)
  })

  nextBtn.addEventListener('click', (event) => {
    event.stopPropagation()
    move(1)
  })

  mainImg.addEventListener('click', (event) => {
    event.stopPropagation()
    close()
  })

  lightbox.addEventListener('wheel', (event) => {
    event.preventDefault()
    if (wheelLock) return
    wheelLock = true
    window.setTimeout(() => {
      wheelLock = false
    }, 120)

    move(event.deltaY > 0 ? 1 : -1)
  }, { passive: false })

  return {
    open(covers: CoverItem[], startIndex: number) {
      if (!covers.length) return
      activeCovers = covers
      currentIndex = Math.max(0, Math.min(startIndex, covers.length - 1))
      render()
      lightbox.classList.add('active')
    },
  }
}

function getLightboxController(doc: Document): LightboxController {
  const exists = lightboxByDoc.get(doc)
  if (exists) return exists
  const created = createLightboxController(doc)
  lightboxByDoc.set(doc, created)
  return created
}

/** 预览图加载状态 */
interface PreviewState {
  isLoading: boolean
  isLoaded: boolean
  error: boolean
  cancelTask?: () => void
  visibilityObserver?: { destroy: () => void }
  scrollObserver?: { destroy: () => void }
}

const previewStates = new WeakMap<HTMLElement, PreviewState>()

/**
 * 渲染预览图（带可见性检测和滚动优化）
 */
export function renderPreview(item: HTMLElement, file: FileInfo) {
  if (item.querySelector('.m115-cover-container')) return

  item.classList.add('with-ext-video-cover')

  const container = document.createElement('div')
  container.className = 'm115-cover-container'

  const skeleton = document.createElement('div')
  skeleton.className = 'm115-cover-skeleton'
  container.appendChild(skeleton)
  item.appendChild(container)

  const state: PreviewState = {
    isLoading: false,
    isLoaded: false,
    error: false,
  }
  previewStates.set(item, state)

  /** 加载预览图 */
  const loadCovers = async () => {
    if (state.isLoading || state.isLoaded || state.error) return

    state.isLoading = true

    const { promise, cancel } = coverScheduler.add(async () => {
      try {
        const covers = await getVideoCovers(file.pickCode, file.duration, 5)
        if (!covers.length) {
          container.innerHTML = '<div class="m115-cover-empty">暂无预览图</div>'
          return
        }

        const row = document.createElement('div')
        row.className = 'm115-cover-loaded'
        const lightbox = getLightboxController(item.ownerDocument)

        covers.forEach((cover, index) => {
          const thumb = document.createElement('span')
          thumb.className = 'm115-cover-thumb'

          const img = document.createElement('img')
          img.className = 'm115-cover-img'
          img.src = cover.imgUrl
          img.alt = `预览 ${Math.floor(cover.time)}s`

          thumb.addEventListener('click', (event) => {
            event.preventDefault()
            event.stopPropagation()
            lightbox.open(covers, index)
          })

          thumb.appendChild(img)
          row.appendChild(thumb)
        })

        container.innerHTML = ''
        container.appendChild(row)
        state.isLoaded = true
      } catch (e) {
        if (e instanceof TaskCancelledError) {
          return
        }
        container.innerHTML = '<div class="m115-cover-error">预览图加载失败</div>'
        state.error = true
      } finally {
        state.isLoading = false
      }
    })

    state.cancelTask = cancel
    await promise
  }

  /** 取消加载 */
  const cancelLoad = () => {
    if (state.cancelTask) {
      state.cancelTask()
      state.cancelTask = undefined
    }
    state.isLoading = false
  }

  /** 滚动停止后加载 */
  let scrollStopTimer: number | undefined
  const scheduleLoadAfterScrollStop = () => {
    if (scrollStopTimer) {
      clearTimeout(scrollStopTimer)
    }
    scrollStopTimer = window.setTimeout(() => {
      loadCovers()
    }, 200)
  }

  // 查找滚动容器
  const scrollTarget = findScrollContainer(item)

  // 创建可见性检测器
  state.visibilityObserver = createVisibilityObserver(
    container,
    () => {
      // 可见时，等待滚动停止后加载
      if (!state.isLoaded && !state.error) {
        scheduleLoadAfterScrollStop()
      }
    },
    () => {
      // 不可见时，取消加载
      cancelLoad()
    }
  )

  // 创建滚动检测器
  state.scrollObserver = createScrollStopDetector(scrollTarget, () => {
    // 滚动停止后，如果元素可见且未加载，则加载
    if (!state.isLoaded && !state.error && !state.isLoading) {
      const rect = container.getBoundingClientRect()
      const isVisible = rect.bottom > 0 && rect.top < window.innerHeight
      if (isVisible) {
        loadCovers()
      }
    }
  })

  // 清理函数（元素移除时调用）
  const cleanup = () => {
    state.visibilityObserver?.destroy()
    state.scrollObserver?.destroy()
    cancelLoad()
  }

  // 使用 MutationObserver 监听元素移除
  const mutationObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const removedNode of mutation.removedNodes) {
        if (removedNode === item || item.contains(removedNode)) {
          cleanup()
          mutationObserver.disconnect()
          return
        }
      }
    }
  })

  if (item.parentElement) {
    mutationObserver.observe(item.parentElement, { childList: true, subtree: true })
  }
}
