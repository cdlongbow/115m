import { escapeHtml } from '../../shared/utils'
import { getVideoCovers } from '../../lib/videoThumbnail'
import type { OverlayPlaylistItem } from './overlay'

const esc = escapeHtml
const PLAYLIST_COVER_FEATURE_ENABLED = true

export function formatPlaylistSeconds(sec: number) {
  const total = Math.max(0, Math.floor(sec))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
  }
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

export function renderPlaylistProgress(item: OverlayPlaylistItem, active: boolean) {
  const visible = !!item.progressPercent && item.progressPercent > 0
  const progressText = typeof item.progressSec === 'number' && item.progressSec > 0
    ? formatPlaylistSeconds(item.progressSec)
    : ''

  return `
    <div data-role="playlist-progress" style="margin-top:6px;display:${visible ? 'flex' : 'none'};align-items:center;gap:8px;min-width:0;">
      <div style="flex:1;height:4px;border-radius:999px;background:rgba(255,255,255,.12);overflow:hidden;">
        <div data-role="playlist-progress-bar" style="width:${Math.max(2, Math.min(100, item.progressPercent || 0))}%;height:100%;border-radius:999px;background:${active ? '#38bdf8' : 'rgba(255,255,255,.56)'};"></div>
      </div>
      <span data-role="playlist-progress-text" style="flex:0 0 auto;font-size:10px;color:rgba(255,255,255,.42);font-variant-numeric:tabular-nums;display:${progressText ? 'inline' : 'none'};">${progressText}</span>
    </div>
  `
}

export function buildPlaylistHtml(items: OverlayPlaylistItem[], currentPickCode: string) {
  return items.map((item, index) => {
    const active = item.pickCode === currentPickCode
    const num = index + 1
    return `
      <button type="button" class="m115-pl-item${active ? ' is-active' : ''}" data-pickcode="${esc(item.pickCode)}" data-index="${index}" ${active ? 'aria-current="true"' : ''}
        style="display:flex;align-items:center;gap:10px;width:100%;padding:6px 8px;border:none;border-radius:8px;cursor:pointer;transition:background .15s;background:${active ? 'rgba(255,255,255,.12)' : 'transparent'};text-align:left;">
        <span style="flex-shrink:0;width:22px;text-align:center;font-size:11px;font-variant-numeric:tabular-nums;${active ? 'color:#38bdf8;font-weight:600' : 'color:rgba(255,255,255,.35)'}">${num}</span>
        <div class="m115-pl-thumb" style="position:relative;width:120px;height:68px;border-radius:6px;flex-shrink:0;background:#1a1a1a;overflow:hidden;display:flex;align-items:center;justify-content:center">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,.15)" stroke-width="1.5"><polygon points="5 3 19 12 5 21 5 3"/></svg>
        </div>
        <div style="min-width:0;flex:1;overflow:hidden">
          <div style="font-size:13px;font-weight:500;line-height:1.4;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;text-overflow:ellipsis;${active ? 'color:#fff' : 'color:rgba(255,255,255,.78)'}">${escapeHtml(item.name)}</div>
          ${item.size ? `<div style="font-size:11px;color:rgba(255,255,255,.35);margin-top:2px">${escapeHtml(item.size)}</div>` : ''}
          ${renderPlaylistProgress(item, active)}
        </div>
      </button>
    `
  }).join('')
}

export function bindPlaylistInteractions(
  listEl: HTMLElement,
  currentPickCode: string,
  onPlaylistPlay: (pickCode: string, keepPlaylistOpen: boolean) => void,
) {
  listEl.querySelectorAll<HTMLElement>('.m115-pl-item').forEach((node) => {
    const pc = node.dataset.pickcode || ''
    const isActive = pc === currentPickCode

    node.addEventListener('mouseenter', () => {
      node.style.background = isActive ? 'rgba(255,255,255,.14)' : 'rgba(255,255,255,.06)'
    })
    node.addEventListener('mouseleave', () => {
      node.style.background = isActive ? 'rgba(255,255,255,.12)' : ''
    })
    node.addEventListener('click', () => {
      if (pc) onPlaylistPlay(pc, true)
    })
  })
}

export function scrollActivePlaylistNodeIntoView(listEl: HTMLElement, currentPickCode: string) {
  const activeNode = listEl.querySelector(`[data-pickcode="${esc(currentPickCode)}"]`)
  activeNode?.scrollIntoView({ block: 'center', behavior: 'instant' })
}

export function lazyLoadPlaylistCovers(listEl: HTMLElement, items: OverlayPlaylistItem[]) {
  if (!PLAYLIST_COVER_FEATURE_ENABLED) {
    return
  }

  const thumbEls = listEl.querySelectorAll<HTMLElement>('.m115-pl-thumb')
  const loadedSet = new Set<string>()

  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue
      const node = entry.target.closest<HTMLElement>('.m115-pl-item')
      const idx = parseInt(node?.dataset.index || '-1', 10)
      const item = items[idx]
      if (!item || loadedSet.has(item.pickCode)) continue
      loadedSet.add(item.pickCode)
      observer.unobserve(entry.target)

      const thumbEl = entry.target as HTMLElement
      const duration = item.duration || 0
      if (duration <= 0) return

      void getVideoCovers(item.pickCode, duration, 1).then((covers) => {
        if (covers.length > 0) {
          thumbEl.innerHTML = `<img src="${covers[0].imgUrl}" alt="" style="width:100%;height:100%;object-fit:contain;object-position:center;display:block" />`
        }
      }).catch(() => {
        // keep placeholder on error
      })
    }
  }, { root: listEl, rootMargin: '200px 0px' })

  thumbEls.forEach(el => observer.observe(el))
}
