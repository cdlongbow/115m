export interface CenterControlElements {
  prev: HTMLButtonElement | null
  play: HTMLButtonElement | null
  next: HTMLButtonElement | null
}

export function buildCenterControlsHtml(): string {
  return `
    <div style="display:flex;align-items:center;justify-content:center;gap:12px;height:100%;">
      <button type="button" data-m115-center="prev" title="上一集" style="display:flex;align-items:center;justify-content:center;width:36px;height:36px;border:none;border-radius:999px;background:rgba(255,255,255,.08);color:rgba(255,255,255,.86);cursor:pointer;padding:0;transition:background .15s ease,opacity .15s ease;">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 6l-6 6 6 6"/><path d="M19 6l-6 6 6 6"/></svg>
      </button>
      <button type="button" data-m115-center="play" title="播放" style="display:flex;align-items:center;justify-content:center;width:44px;height:44px;border:1px solid rgba(255,255,255,.18);border-radius:999px;background:rgba(255,255,255,.12);color:#fff;cursor:pointer;padding:0;box-shadow:0 4px 16px rgba(0,0,0,.18);transition:background .15s ease,opacity .15s ease;">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
      </button>
      <button type="button" data-m115-center="next" title="下一集" style="display:flex;align-items:center;justify-content:center;width:36px;height:36px;border:none;border-radius:999px;background:rgba(255,255,255,.08);color:rgba(255,255,255,.86);cursor:pointer;padding:0;transition:background .15s ease,opacity .15s ease;">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m13 6 6 6-6 6"/><path d="m5 6 6 6-6 6"/></svg>
      </button>
    </div>
  `
}

export function applyCenterControlContainerStyle(container: HTMLElement) {
  container.style.position = 'absolute'
  container.style.left = '50%'
  container.style.bottom = '0'
  container.style.transform = 'translateX(-50%)'
  container.style.display = 'flex'
  container.style.alignItems = 'center'
  container.style.justifyContent = 'center'
  container.style.padding = '0'
  container.style.height = '100%'
  container.style.pointerEvents = 'auto'
}

export function queryCenterControlElements(container: HTMLElement): CenterControlElements {
  return {
    prev: container.querySelector('[data-m115-center="prev"]') as HTMLButtonElement | null,
    play: container.querySelector('[data-m115-center="play"]') as HTMLButtonElement | null,
    next: container.querySelector('[data-m115-center="next"]') as HTMLButtonElement | null,
  }
}

export function buildPlayButtonState(paused: boolean) {
  return {
    title: paused ? '播放' : '暂停',
    html: paused
      ? '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>'
      : '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5h3v14H8zM13 5h3v14h-3z"/></svg>',
  }
}

export function applyNavButtonState(button: HTMLButtonElement | null, enabled: boolean, title: string) {
  if (!button) return
  button.disabled = !enabled
  button.title = title
  button.style.opacity = enabled ? '1' : '.38'
  button.style.cursor = enabled ? 'pointer' : 'not-allowed'
}

export function createCenterHoverBinder(playButton: HTMLButtonElement | null) {
  return (button: HTMLButtonElement | null) => {
    button?.addEventListener('mouseenter', () => {
      if (!button.disabled) button.style.background = 'rgba(255,255,255,.16)'
    })
    button?.addEventListener('mouseleave', () => {
      button.style.background = button === playButton ? 'rgba(255,255,255,.12)' : 'rgba(255,255,255,.08)'
    })
  }
}
