import type Artplayer from 'artplayer'
import { UI_LAYER } from './ui-layer'

export interface HoverPreviewRefs {
  preview: HTMLDivElement
  image: HTMLImageElement
  time: HTMLDivElement
  loading: HTMLDivElement
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
    '.art-progress .art-control-progress-inner',
    '.art-control-progress-inner',
    '.art-control .art-progress',
    '.art-bottom .art-progress',
    '.art-progress',
    '.art-control-progress .art-progress',
    '.art-control-progress',
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
    'bottom:70px',
    'transform:translateX(-50%)',
    'display:none',
    'pointer-events:none',
    `z-index:${UI_LAYER.hoverPreview}`,
    'background:rgba(18,18,18,.94)',
    'border:1px solid rgba(255,255,255,.08)',
    'border-radius:14px',
    'padding:8px',
    'min-width:fit-content',
    'box-sizing:border-box',
    'box-shadow:0 12px 24px rgba(0,0,0,.22)',
    'backdrop-filter:blur(6px)',
  ].join(';')

  const image = document.createElement('img')
  image.style.cssText = [
    'display:block',
    'width:170px',
    'height:96px',
    'object-fit:cover',
    'border-radius:10px',
    'background:#111',
  ].join(';')

  const loading = document.createElement('div')
  loading.style.cssText = [
    'position:absolute',
    'top:8px',
    'left:8px',
    'right:8px',
    'bottom:30px',
    'display:none',
    'align-items:center',
    'justify-content:center',
    'border-radius:10px',
    'background:linear-gradient(180deg, rgba(255,255,255,.08), rgba(255,255,255,.03))',
    'color:rgba(255,255,255,.82)',
    'font-size:12px',
    'letter-spacing:.2px',
  ].join(';')
  loading.textContent = '加载预览中'

  const time = document.createElement('div')
  time.style.cssText = [
    'margin-top:6px',
    'font-size:12px',
    'line-height:18px',
    'color:rgba(255,255,255,.92)',
    'text-align:center',
    'font-variant-numeric:tabular-nums',
    'font-weight:600',
  ].join(';')
  time.textContent = '00:00'

  preview.appendChild(image)
  preview.appendChild(loading)
  preview.appendChild(time)
  container.appendChild(preview)

  return { preview, image, time, loading }
}
