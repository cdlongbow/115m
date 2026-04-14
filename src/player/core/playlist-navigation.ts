import type { OverlayPlaybackNavState } from './overlay'
import type { OverlayPlaylistItem } from './overlay'

export interface PlaylistPosition {
  index: number
  previous: OverlayPlaylistItem | null
  current: OverlayPlaylistItem | null
  next: OverlayPlaylistItem | null
}

export function getPlaylistPosition(items: OverlayPlaylistItem[], pickCode: string): PlaylistPosition {
  const index = items.findIndex(item => item.pickCode === pickCode)
  return {
    index,
    previous: index > 0 ? items[index - 1] : null,
    current: index >= 0 ? items[index] : null,
    next: index >= 0 && index < items.length - 1 ? items[index + 1] : null,
  }
}

export function buildPlaybackNavState(position: PlaylistPosition): OverlayPlaybackNavState {
  return {
    hasPrevious: !!position.previous,
    hasNext: !!position.next,
    previousTitle: position.previous?.name,
    nextTitle: position.next?.name,
  }
}
