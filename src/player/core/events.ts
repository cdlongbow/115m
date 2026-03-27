import type Artplayer from 'artplayer'
import { savePlayHistory } from './history'
import { bindKeyboardShortcuts } from './keyboard'

export interface BindPlayerEventsOptions {
  art: Artplayer
  type: 'native' | 'hls'
  pickCode: string
  getQualityLabel: () => string
  onPerf: (stage: string, extra?: Record<string, unknown>) => void
  onLoadedmetadata: () => void
  onCanplay: () => void
  onPlaying: () => void
  onReady: () => void
  onError: () => void
}

export function bindPlayerEvents(options: BindPlayerEventsOptions): () => void {
  const {
    art,
    type,
    pickCode,
    getQualityLabel,
    onPerf,
    onLoadedmetadata,
    onCanplay,
    onPlaying,
    onReady,
    onError,
  } = options
  const root = art.template.$player as HTMLDivElement
  const mask = art.template.$mask as HTMLDivElement

  art.on('ready', () => {
    onPerf('art-ready', { type })
    onReady()
  })

  art.on('video:timeupdate', () => {
    savePlayHistory({
      pickCode,
      fileName: pickCode,
      currentTime: art.currentTime || 0,
      duration: art.duration || 0,
      quality: getQualityLabel(),
    })
  })

  art.on('video:loadedmetadata', () => {
    onPerf('video-loadedmetadata', { type })
    onLoadedmetadata()
  })

  art.on('video:canplay', () => {
    onPerf('video-canplay', { type })
    onCanplay()
  })

  art.on('video:playing', () => {
    onPerf('video-playing', { type })
    onPlaying()
  })

  art.on('error', onError)



  /**
   * 判断点击目标是否属于真正的交互元素（按钮、滑块、链接等）。
   * 注意：只检查具体的交互元素，不检查 $controls/$bottom/$progress 容器本身，
   * 因为这些容器有大片空白区域，点击空白处应该触发播放/暂停。
   */
  const isInteractiveTarget = (target: EventTarget | null): boolean => {
    if (!target || !(target instanceof Element)) return false
    // 按钮、输入框、链接、滑块等具体交互元素
    if (target.closest('button, a, input, [role="button"], .art-setting, .art-contextmenus')) return true
    // ArtPlayer 音量面板和滑块
    if (target.closest('.art-volume-panel, .art-volume-slider, .art-volume-handle, .art-volume-indicator')) return true
    // SVG 图标（音量、全屏、设置等）的父元素是控件容器
    if (target instanceof SVGElement) {
      // SVG 图标本身是可点击的控件
      const parent = target.parentElement
      if (parent && parent.closest('.art-controls-left, .art-controls-right, .art-controls-center')) return true
    }
    // 进度条区域（滑块拖拽区域）→ 交互控件
    const progress = art.template.$progress as HTMLElement
    if (progress?.contains(target)) return true
    // 播放列表面板
    if (target.closest('#playlist-panel, #playlist-mask')) return true
    return false
  }

  /**
   * 判断点击目标是否应该触发播放/暂停。
   * 任何非交互元素的点击都应该 toggle 播放状态。
   */
  const handleRootClick = (event: MouseEvent) => {
    const target = event.target
    // 交互控件区域 → 不处理，让 ArtPlayer 自己处理
    if (isInteractiveTarget(target)) return
    // 其他所有区域（包括 video、poster、mask、controls 空白处、header 空白处）→ toggle 播放
    event.stopImmediatePropagation()
    if (art.video.paused) {
      void art.play()
    }
    else {
      art.pause()
    }
  }

  const handleRootDoubleClick = (event: MouseEvent) => {
    const target = event.target
    if (isInteractiveTarget(target)) return
    event.stopImmediatePropagation()
  }

  root.addEventListener('click', handleRootClick, true)
  root.addEventListener('dblclick', handleRootDoubleClick, true)

  const cleanupKeyboard = bindKeyboardShortcuts(art)

  return () => {
    root.removeEventListener('click', handleRootClick, true)
    root.removeEventListener('dblclick', handleRootDoubleClick, true)
    cleanupKeyboard()
  }
}
