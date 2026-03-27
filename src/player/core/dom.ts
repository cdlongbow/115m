import type Artplayer from 'artplayer'

export interface HoverPreviewRefs {
  preview: HTMLDivElement
  image: HTMLImageElement
  time: HTMLDivElement
}

export function applyTopNavFromQuery(art?: Artplayer): void {
  const urlParams = new URLSearchParams(window.location.search)
  const title = urlParams.get('title') || '视频播放'

  const headerEl = document.getElementById('header')
  const titleEl = document.getElementById('video-title')
  const backBtn = document.getElementById('btn-back')

  if (art && headerEl) {
    art.template.$player.appendChild(headerEl)
  }

  if (titleEl) {
    titleEl.textContent = title
  }
  document.title = title

  backBtn?.addEventListener('click', () => {
    if (window.history.length > 1) {
      window.history.back()
    }
    else {
      window.close()
    }
  })
}

export function renderPlayerError(message: string): void {
  const container = document.getElementById('artplayer-app')
  if (!container) return

  container.innerHTML = `
    <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;color:#ff4d4f;font-size:18px;">
      <div style="font-size:48px;margin-bottom:20px;">⚠️</div>
      <div>${message}</div>
    </div>
  `
}

export function findProgressElement(art: Artplayer): HTMLElement | null {
  const root = art.template.$player as HTMLElement
  const selectors = [
    '.art-control-progress',
    '.art-progress',
    '.art-control .art-progress',
    '.art-bottom .art-progress',
  ]

  for (const selector of selectors) {
    const hit = root.querySelector(selector) as HTMLElement | null
    if (hit) return hit
  }
  return null
}

export function createHoverPreviewElements(art: Artplayer): HoverPreviewRefs {
  const container = art.template.$player as HTMLElement
  const preview = document.createElement('div')
  preview.style.cssText = [
    'position:absolute',
    'left:0',
    'bottom:64px',
    'transform:translateX(-50%)',
    'display:none',
    'pointer-events:none',
    'z-index:80',
    'background:rgba(0,0,0,.78)',
    'border:1px solid rgba(255,255,255,.22)',
    'border-radius:8px',
    'padding:6px',
    'min-width:fit-content',
    'box-sizing:border-box',
  ].join(';')

  const image = document.createElement('img')
  image.style.cssText = [
    'display:block',
    'width:170px',
    'height:96px',
    'object-fit:cover',
    'border-radius:6px',
    'background:#111',
  ].join(';')

  const time = document.createElement('div')
  time.style.cssText = [
    'margin-top:4px',
    'font-size:12px',
    'line-height:16px',
    'color:#fff',
    'text-align:center',
    'font-variant-numeric:tabular-nums',
  ].join(';')
  time.textContent = '00:00'

  preview.appendChild(image)
  preview.appendChild(time)
  container.appendChild(preview)

  return { preview, image, time }
}
