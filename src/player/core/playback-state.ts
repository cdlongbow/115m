import type { M3u8Item } from '../../lib/types'
import { ORIGINAL_PLACEHOLDER_URL, buildQualityOptions, getQualityDisplayName } from './quality'
import type { QualityOption } from './types'

export interface PlaybackState {
  ultraUrl: string | null
  m3u8List: M3u8Item[]
  qualityOptions: QualityOption[]
  currentQuality: number
  currentQualityLabel: string
  isNativeVideo: boolean
}

export function refreshPlaybackQualityState(state: PlaybackState, currentUrl: string): PlaybackState {
  const qualityOptions = buildQualityOptions(
    currentUrl,
    state.ultraUrl,
    state.m3u8List,
    state.currentQuality,
    state.currentQualityLabel,
  )
  return {
    ...state,
    qualityOptions,
    ...syncPlaybackStateByUrl({ ...state, qualityOptions }, currentUrl),
  }
}

export function syncPlaybackStateByUrl(state: PlaybackState, url: string): Partial<PlaybackState> {
  const hit = state.qualityOptions.find(opt => opt.url === url)
  if (!hit) return {}

  return {
    currentQuality: hit.quality,
    currentQualityLabel: hit.label,
    isNativeVideo: !!state.ultraUrl && hit.url === state.ultraUrl,
  }
}

export function applyFallbackToHlsState(state: PlaybackState): { url: string | null, patch: Partial<PlaybackState> } {
  const bestQuality = state.m3u8List[0]
  if (!bestQuality) return { url: null, patch: {} }

  return {
    url: bestQuality.url,
    patch: {
      isNativeVideo: false,
      currentQuality: bestQuality.quality,
      currentQualityLabel: getQualityDisplayName(bestQuality.quality, true),
    },
  }
}

export function applySelectedQualityOption(state: PlaybackState, option: QualityOption): Partial<PlaybackState> {
  return {
    currentQuality: option.quality,
    currentQualityLabel: option.label,
    isNativeVideo: !!state.ultraUrl && option.url === state.ultraUrl,
  }
}

export function resolveOriginalPlaceholderUrl(state: PlaybackState): string | null {
  const original = state.m3u8List.find(item => item.quality === 9999) || state.m3u8List[0]
  return original?.url || null
}

export function isOriginalPlaceholderOption(option: QualityOption): boolean {
  return option.url === ORIGINAL_PLACEHOLDER_URL
}
