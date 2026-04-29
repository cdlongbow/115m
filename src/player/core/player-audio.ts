import type { AudioTrackOption } from './types'

export function buildAudioControlItem(params: {
  controlName: string
  currentAudioTrackLabel: string
  audioTrackOptions: AudioTrackOption[]
  visible: boolean
  onSelectAudioTrack: (id: number) => void
}) {
  return {
    name: params.controlName,
    position: 'right' as const,
    index: 10.5,
    style: {
      marginRight: 'var(--m115-control-gap)',
      width: 'var(--m115-audio-width)',
      minWidth: 'var(--m115-audio-width)',
      maxWidth: 'var(--m115-audio-width)',
      height: 'var(--m115-control-size)',
      minHeight: 'var(--m115-control-size)',
      maxHeight: 'var(--m115-control-size)',
      textAlign: 'center' as const,
      display: params.visible ? 'flex' : 'none',
    },
    html: params.currentAudioTrackLabel,
    mounted: ($control: HTMLElement) => {
      $control.classList.add('m115-audio-control')
    },
    selector: params.audioTrackOptions.map(item => ({
      html: item.label,
      value: String(item.id),
      default: item.label === params.currentAudioTrackLabel,
    })),
    onSelect: async (item: any) => {
      const id = Number(item.value)
      if (!Number.isFinite(id)) return params.currentAudioTrackLabel
      const target = params.audioTrackOptions.find(track => track.id === id)
      if (!target) return params.currentAudioTrackLabel
      params.onSelectAudioTrack(id)
      return target.label
    },
  }
}
