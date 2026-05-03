import { getVideoCovers } from '../../lib/videoThumbnail'
import type { FileInfo } from './types'
import { sendRuntimeMessageSafe } from './runtime'
import {
  Scheduler,
  TaskCancelledError,
  createVisibilityObserver,
  createScrollStopDetector,
  findScrollContainer,
} from './utils'

const coverScheduler = new Scheduler(3)
const TRANSCODE_STATUS_POLL_MS = 15000

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

  lightbox.addEventListener('click', (event) => {
    // 点击灯箱背景区域（图片以外）也关闭
    if (event.target === lightbox) {
      close()
    }
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

function showPreviewUnavailable(container: HTMLElement) {
  container.innerHTML = ''
}

interface TranscodeResponse {
  ok?: boolean
  state?: 'queued' | 'manual_required' | 'pending_check' | 'completed_refresh' | 'failed'
  error?: string
  detail?: string
  queueCount?: number
  etaSeconds?: number
  priority?: number
  pushAccepted?: boolean
}

function formatTranscodeEta(etaSeconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(etaSeconds))
  if (safeSeconds <= 60) {
    return `${safeSeconds} 秒`
  }

  return `${Math.floor(safeSeconds / 60)} 分钟`
}

function formatTranscodeStatus(res: TranscodeResponse): { text: string, color: string } {
  if (res.state === 'queued') {
    const parts: string[] = []
    if (typeof res.queueCount === 'number') {
      parts.push(`前方 ${res.queueCount} 个`)
    }
    if (typeof res.etaSeconds === 'number') {
      parts.push(`预计 ${formatTranscodeEta(res.etaSeconds)}`)
    }
    return {
      text: parts.length > 0 ? `VIP 加速排队中: ${parts.join('，')}` : 'VIP 加速排队中',
      color: '#52c41a',
    }
  }

  if (res.state === 'pending_check') {
    return {
      text: 'VIP 自动加速已发起，等待队列确认',
      color: '#52c41a',
    }
  }

  if (res.state === 'manual_required') {
    return {
      text: res.detail || '自动加速未命中，可手动转码',
      color: '#faad14',
    }
  }

  if (res.state === 'completed_refresh') {
    return {
      text: res.detail || 'VIP 加速已完成，刷新页面后可预览',
      color: '#52c41a',
    }
  }

  return {
    text: res.error || res.detail || '自动加速失败，可手动重试',
    color: '#fa8c16',
  }
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
        if (file.duration === 0) {
          showTranscodeButton(container, file.pickCode)
          state.isLoaded = true
          return
        }

        const covers = await getVideoCovers(file.pickCode, file.duration, 5)
        if (!covers.length) {
          showTranscodeButton(container, file.pickCode)
          state.isLoaded = true
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
        showTranscodeButton(container, file.pickCode)
        state.error = true
      } finally {
        state.isLoading = false
      }
    })

    state.cancelTask = cancel
    try {
      await promise
    }
    catch (e) {
      if (!(e instanceof TaskCancelledError)) {
        throw e
      }
    }
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
  state.scrollObserver = createScrollStopDetector(scrollTarget, 120, () => {
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

/**
 * 已触发过加速的 pickCode 集合（避免重复请求）
 */
const acceleratedSet = new Set<string>()

/**
 * 在预览区域自动触发 VIP 加速转码并显示状态
 */
function showTranscodeButton(container: HTMLElement, pickCode: string) {
  container.innerHTML = ''

  const wrapper = document.createElement('div')
  wrapper.className = 'm115-transcode-area'

  const label = document.createElement('span')
  label.className = 'm115-transcode-label'
  label.textContent = 'VIP 自动加速转码中...'

  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'm115-transcode-btn'
  button.textContent = 'VIP加速转码'
  button.style.cssText = [
    'margin-top:10px',
    'padding:8px 14px',
    'border:none',
    'border-radius:6px',
    'background:#ff6a00',
    'color:#fff',
    'font-size:12px',
    'cursor:pointer',
  ].join(';')
  button.hidden = true

  wrapper.appendChild(label)
  wrapper.appendChild(button)
  container.appendChild(wrapper)

  let pollTimer: number | undefined

  const stopPolling = () => {
    if (typeof pollTimer === 'number') {
      clearTimeout(pollTimer)
      pollTimer = undefined
    }
  }

  const schedulePoll = () => {
    stopPolling()
    pollTimer = window.setTimeout(() => {
      if (!wrapper.isConnected) {
        stopPolling()
        return
      }
      runStatusCheck()
    }, TRANSCODE_STATUS_POLL_MS)
  }

  const setManualFallback = (message: string) => {
    stopPolling()
    label.textContent = message
    label.style.color = '#fa8c16'
    button.hidden = false
    button.disabled = false
    button.textContent = 'VIP加速转码'
  }

  const applyStatus = (res: TranscodeResponse) => {
    if (res.ok && res.state && res.state !== 'manual_required') {
      const status = formatTranscodeStatus(res)
      label.textContent = status.text
      label.style.color = status.color
      button.hidden = true
      if (res.state === 'queued' || res.state === 'pending_check') {
        schedulePoll()
      }
      else {
        stopPolling()
      }
      return true
    }

    if (res.state === 'manual_required') {
      const status = formatTranscodeStatus(res)
      setManualFallback(status.text)
      return true
    }

    return false
  }

  const runStatusCheck = () => {
    sendRuntimeMessageSafe<TranscodeResponse>({
      type: 'TRANSCODE_STATUS',
      data: { pickCode },
    }).then((res) => {
      if (res && applyStatus(res)) {
        return
      }

      acceleratedSet.delete(pickCode)
      setManualFallback(res?.error || '转码状态刷新失败，可手动重试')
    }).catch(() => {
      acceleratedSet.delete(pickCode)
      setManualFallback('转码状态刷新异常，可手动重试')
    })
  }

  const runTranscode = (manual = false) => {
    stopPolling()
    if (manual) {
      button.disabled = true
      button.textContent = '加速中...'
      label.textContent = '正在请求 VIP 加速转码...'
      label.style.color = '#1677ff'
    }

    sendRuntimeMessageSafe<TranscodeResponse>({
      type: 'TRANSCODE_ACCELERATE',
      data: { pickCode },
    }).then((res) => {
      if (res && applyStatus(res)) {
        return
      }

      acceleratedSet.delete(pickCode)
      if (manual) {
        setManualFallback(res?.error || '手动加速失败，请稍后重试')
        return
      }

      label.textContent = '自动加速不可用，可手动重试'
      label.style.color = '#fa8c16'
      button.hidden = false
      button.disabled = false
      button.textContent = 'VIP加速转码'
    }).catch(() => {
      acceleratedSet.delete(pickCode)
      if (manual) {
        setManualFallback('手动加速异常，请稍后重试')
        return
      }

      label.textContent = '自动加速不可用，可手动重试'
      label.style.color = '#fa8c16'
      button.hidden = false
      button.disabled = false
      button.textContent = 'VIP加速转码'
    })
  }

  button.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopPropagation()
    acceleratedSet.add(pickCode)
    runTranscode(true)
  })

  if (acceleratedSet.has(pickCode)) {
    runStatusCheck()
    return
  }
  acceleratedSet.add(pickCode)

  runTranscode(false)
}
