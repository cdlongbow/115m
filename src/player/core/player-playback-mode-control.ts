import type { PlaybackMode } from './player-playback-mode'
import { getPlaybackModeLabel, getPlaybackModeOptions } from './player-playback-mode'
import { bindClickSelectorBehavior } from './player-selector'

export function buildPlaybackModeControlItem(params: {
  controlName: string
  currentPlaybackMode: PlaybackMode
  onSelectPlaybackMode: (mode: PlaybackMode) => void
}) {
  return {
    name: params.controlName,
    position: 'right' as const,
    index: 10.75,
    style: {
      marginRight: 'var(--m115-control-gap)',
      width: 'var(--m115-mode-width)',
      minWidth: 'var(--m115-mode-width)',
      maxWidth: 'var(--m115-mode-width)',
      height: 'var(--m115-control-size)',
      minHeight: 'var(--m115-control-size)',
      maxHeight: 'var(--m115-control-size)',
      textAlign: 'center' as const,
    },
    html: getPlaybackModeLabel(params.currentPlaybackMode),
    mounted: ($control: HTMLElement) => {
      $control.classList.add('m115-playback-mode-control')
      bindClickSelectorBehavior($control)
    },
    selector: getPlaybackModeOptions().map(mode => ({
      html: getPlaybackModeLabel(mode),
      value: mode,
      default: mode === params.currentPlaybackMode,
    })),
    onSelect: async (item: any) => {
      const mode = item.value as PlaybackMode
      if (mode !== 'next' && mode !== 'repeat' && mode !== 'stop') {
        return getPlaybackModeLabel(params.currentPlaybackMode)
      }
      params.onSelectPlaybackMode(mode)
      return getPlaybackModeLabel(mode)
    },
  }
}
