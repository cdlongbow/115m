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

  return bindKeyboardShortcuts(art)
}
