export function buildNavControlItem(params: {
  controlName: string
  direction: 'prev' | 'next'
  index: number
  enabled: boolean
  title: string
  onClick: () => void
}) {
  const icon = params.direction === 'prev'
    ? '<svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true" style="display:block;flex:none;color:inherit;"><path fill="currentColor" d="M11.8 6.2 6 12l5.8 5.8 1.4-1.4L8.8 12l4.4-4.4-1.4-1.4Z"/><path fill="currentColor" d="M17.8 6.2 12 12l5.8 5.8 1.4-1.4-4.4-4.4 4.4-4.4-1.4-1.4Z"/></svg>'
    : '<svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true" style="display:block;flex:none;color:inherit;"><path fill="currentColor" d="m12.2 6.2-1.4 1.4 4.4 4.4-4.4 4.4 1.4 1.4L18 12l-5.8-5.8Z"/><path fill="currentColor" d="m6.2 6.2-1.4 1.4 4.4 4.4-4.4 4.4 1.4 1.4L12 12 6.2 6.2Z"/></svg>'

  return {
    name: params.controlName,
    position: 'left' as const,
    index: params.index,
    tooltip: params.title,
    html: `<span class="m115-control-shell m115-nav-control-button${params.enabled ? '' : ' is-disabled'}" aria-hidden="true" style="display:inline-flex;align-items:center;justify-content:center;width:40px;height:40px;color:rgba(255,255,255,.92);line-height:0;font-size:0;">${icon}</span>`,
    style: {
      width: '46px',
      minWidth: '46px',
      maxWidth: '46px',
      height: '46px',
      minHeight: '46px',
      maxHeight: '46px',
      marginRight: '2px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      opacity: params.enabled ? '1' : '.38',
      cursor: params.enabled ? 'pointer' : 'not-allowed',
    },
    click: () => {
      if (!params.enabled) return false
      params.onClick()
      return false
    },
    mounted: ($control: HTMLElement) => {
      $control.classList.add('m115-nav-control')
      $control.classList.toggle('is-disabled', !params.enabled)
      $control.title = params.title
    },
  }
}
