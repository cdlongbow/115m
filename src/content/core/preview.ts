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

function showPreviewUnavailable(container: HTMLElement) {
  container.innerHTML = ''
}

interface TranscodeResponse {
  ok?: boolean
  state?: 'queued' | 'manual_required' | 'pending_check' | 'completed_refresh' | 'failed'
  error?: string
  detail?: string
  batchQueued?: number
  batchTotal?: number
  batchSkipped?: number
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
  const batchText = typeof res.batchQueued === 'number' && res.batchQueued > 0 ? `，同文件夹已提交 ${res.batchQueued} 个` : ''
  if (res.state === 'queued') {
    const parts: string[] = []
    if (typeof res.queueCount === 'number') {
      parts.push(`前方 ${res.queueCount} 个`)
    }
    if (typeof res.etaSeconds === 'number') {
      parts.push(`预计 ${formatTranscodeEta(res.etaSeconds)}`)
    }
    return {
      text: parts.length > 0 ? `VIP 加速排队中: ${parts.join('，')}${batchText}` : `VIP 加速排队中${batchText}`,
      color: '#52c41a',
    }
  }

  if (res.state === 'pending_check') {
    return {
      text: `VIP 自动加速已发起，等待队列确认${batchText}`,
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

const listPreviewCoverOptions = {
  maxWidth: 320,
  maxHeight: 180,
  quality: 0.78,
  cacheScope: 'list-v1',
  deferCacheWrite: true,
  useTimelineCache: false,
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

        const covers = await getVideoCovers(file.pickCode, file.duration, 5, listPreviewCoverOptions)
        if (!covers.length) {
          showTranscodeButton(container, file.pickCode)
          state.isLoaded = true
          return
        }

        const row = document.createElement('div')
        row.className = 'm115-cover-loaded'

        covers.forEach((cover) => {
          const thumb = document.createElement('span')
          thumb.className = 'm115-cover-thumb'

          const img = document.createElement('img')
          img.className = 'm115-cover-img'
          img.src = cover.imgUrl
          img.alt = `预览 ${Math.floor(cover.time)}s`

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
  let transcodeFrame: HTMLIFrameElement | undefined

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

  const cleanupTranscodeFrame = () => {
    transcodeFrame?.remove()
    transcodeFrame = undefined
  }

  const prepareTranscodeFrame = async () => {
    cleanupTranscodeFrame()

    const frame = document.createElement('iframe')
    transcodeFrame = frame
    frame.dataset['115mTranscodeFrame'] = pickCode
    frame.src = `https://115vod.com/?pickcode=${encodeURIComponent(pickCode)}&share_id=0`
    frame.style.cssText = [
      'position:fixed',
      'right:16px',
      'top:72px',
      'width:360px',
      'height:220px',
      'opacity:1',
      'border:1px solid rgba(255,106,0,.45)',
      'border-radius:10px',
      'box-shadow:0 10px 30px rgba(0,0,0,.18)',
      'background:#fff',
      'z-index:2147483647',
      'pointer-events:auto',
    ].join(';')
    document.documentElement.appendChild(frame)

    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error('115vod iframe load timeout')), 8000)
      frame.addEventListener('load', () => {
        window.clearTimeout(timer)
        resolve()
      }, { once: true })
    })

    const ready = await sendRuntimeMessageSafe<{ ok?: boolean, error?: string }>({
      type: 'TRANSCODE_FRAME_READY',
      data: { pickCode },
    })
    if (!ready?.ok) {
      throw new Error(ready?.error || '115vod iframe not ready')
    }
  }

  const enableTranscodeFrameFallback = false

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
    console.log(`[115m][transcode] runStatusCheck start pickCode=${pickCode}`)
    sendRuntimeMessageSafe<TranscodeResponse>({
      type: 'TRANSCODE_STATUS',
      data: { pickCode },
    }).then((res) => {
      console.log(`[115m][transcode] runStatusCheck response pickCode=${pickCode} ok=${String(res?.ok)} state=${res?.state || ''} error=${res?.error || ''} detail=${res?.detail || ''}`)
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
    console.log(`[115m][transcode] runTranscode start pickCode=${pickCode} manual=${String(manual)}`)
    if (manual) {
      button.disabled = true
      button.textContent = '加速中...'
      label.textContent = '正在请求 VIP 加速转码...'
      label.style.color = '#1677ff'
    }

    const frameReady = enableTranscodeFrameFallback ? prepareTranscodeFrame() : Promise.resolve()
    frameReady.then(() => sendRuntimeMessageSafe<TranscodeResponse>({
      type: 'TRANSCODE_ACCELERATE',
      data: { pickCode, batchFolder: true },
    })).then((res) => {
      cleanupTranscodeFrame()
      console.log(`[115m][transcode] runTranscode response pickCode=${pickCode} manual=${String(manual)} ok=${String(res?.ok)} state=${res?.state || ''} error=${res?.error || ''} detail=${res?.detail || ''}`)
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
    }).catch((error) => {
      cleanupTranscodeFrame()
      console.warn(`[115m][transcode] runTranscode exception pickCode=${pickCode} manual=${String(manual)} error=${error instanceof Error ? error.message : String(error)}`)
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
    console.log(`[115m][transcode] manual button click pickCode=${pickCode}`)
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
