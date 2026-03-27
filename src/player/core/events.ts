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

  const stopRootBubble = (event: Event) => {
    event.stopPropagation()
  }

  const handleMaskClick = (event: MouseEvent) => {
    if (event.target !== mask) return
    event.preventDefault()
    event.stopImmediatePropagation()

    if (art.video.paused) {
      void art.play()
    }
    else {
      art.pause()
    }
  }

  const handleMaskDoubleClick = (event: MouseEvent) => {
    if (event.target !== mask) return
    event.preventDefault()
    event.stopImmediatePropagation()
  }

  root.addEventListener('click', stopRootBubble)
  root.addEventListener('dblclick', stopRootBubble)
  root.addEventListener('mousedown', stopRootBubble)
  root.addEventListener('mouseup', stopRootBubble)
  root.addEventListener('contextmenu', stopRootBubble)

  mask.addEventListener('click', handleMaskClick)
  mask.addEventListener('dblclick', handleMaskDoubleClick)

  const cleanupKeyboard = bindKeyboardShortcuts(art)

  return () => {
    root.removeEventListener('click', stopRootBubble)
    root.removeEventListener('dblclick', stopRootBubble)
    root.removeEventListener('mousedown', stopRootBubble)
    root.removeEventListener('mouseup', stopRootBubble)
    root.removeEventListener('contextmenu', stopRootBubble)
    mask.removeEventListener('click', handleMaskClick)
    mask.removeEventListener('dblclick', handleMaskDoubleClick)
    cleanupKeyboard()
  }
}
