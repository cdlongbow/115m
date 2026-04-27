const PLAYBACK_RATE_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const

function getPlaybackRateLabel(value: number) {
  return value === 1 ? '正常' : `${value}x`
}

export function buildSpeedControlItem(params: {
  controlName: string
  currentPlaybackRate: number
  onSelectPlaybackRate: (value: number) => void
}) {
  return {
    name: params.controlName,
    position: 'right' as const,
    index: 11,
    style: {
      marginRight: 'var(--m115-control-gap)',
      width: 'var(--m115-speed-width)',
      minWidth: 'var(--m115-speed-width)',
      maxWidth: 'var(--m115-speed-width)',
      height: 'var(--m115-control-size)',
      minHeight: 'var(--m115-control-size)',
      maxHeight: 'var(--m115-control-size)',
      textAlign: 'center' as const,
    },
    html: getPlaybackRateLabel(params.currentPlaybackRate),
    mounted: ($control: HTMLElement) => {
      $control.classList.add('m115-speed-control')
    },
    selector: PLAYBACK_RATE_OPTIONS.map(value => ({
      html: getPlaybackRateLabel(value),
      value: String(value),
      default: value === params.currentPlaybackRate,
    })),
    onSelect: async (item: any) => {
      const value = Number(item.value || item.html)
      if (!Number.isFinite(value)) return getPlaybackRateLabel(params.currentPlaybackRate)
      params.onSelectPlaybackRate(value)
      return getPlaybackRateLabel(value)
    },
  }
}
