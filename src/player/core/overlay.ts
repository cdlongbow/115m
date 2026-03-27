import type Artplayer from 'artplayer'

export interface OverlayPathItem {
  cid: string
  name: string
}

export interface OverlayPlaylistItem {
  pickCode: string
  name: string
  size?: string
}

export interface PlayerOverlayMeta {
  title: string
  fileSize: string
  fileId: string
  cid: string
  parentId: string
  isMarked: boolean
  path: OverlayPathItem[]
}

export interface PlayerOverlayOptions {
  art: Artplayer
  meta: PlayerOverlayMeta
  onMove: () => Promise<void>
  onToggleFavorite: (nextMarked: boolean) => Promise<boolean>
  onPlaylistToggle: (open: boolean) => Promise<OverlayPlaylistItem[]>
  onPlaylistPlay: (pickCode: string) => void
  getCurrentPickCode: () => string
}

export function readOverlayMetaFromQuery(): PlayerOverlayMeta {
  const params = new URLSearchParams(window.location.search)
  const rawPath = params.get('path')
  let path: OverlayPathItem[] = []

  if (rawPath) {
    try {
      const parsed = JSON.parse(rawPath) as OverlayPathItem[]
      if (Array.isArray(parsed)) {
        path = parsed.filter(item => !!item?.cid && !!item?.name)
      }
    }
    catch {
      path = []
    }
  }

  return {
    title: params.get('title') || '视频播放',
    fileSize: params.get('fileSize') || '',
    fileId: params.get('fileId') || '',
    cid: params.get('cid') || '',
    parentId: params.get('cid') || '',
    isMarked: params.get('marked') === '1',
    path,
  }
}

export class PlayerOverlayController {
  private readonly root: HTMLElement
  private readonly controlsEl: HTMLElement
  private readonly bottomEl: HTMLElement
  private readonly progressEl: HTMLElement
  private headerEl: HTMLElement | null = null
  private titleEl: HTMLElement | null = null
  private statsEl: HTMLElement | null = null
  private breadcrumbsEl: HTMLElement | null = null
  private readonly backBtn: HTMLButtonElement | null
  private readonly moveBtn: HTMLButtonElement | null
  private readonly favoriteBtn: HTMLButtonElement | null
  private readonly favoriteOutlineEl: HTMLElement | null
  private readonly favoriteFilledEl: HTMLElement | null
  private readonly playlistBtn: HTMLButtonElement | null
  private readonly playlistCloseBtn: HTMLButtonElement | null
  private readonly playlistMaskEl: HTMLElement | null
  private readonly playlistPanelEl: HTMLElement | null
  private readonly playlistListEl: HTMLElement | null
  private visibleTimer: number | null = null
  private isPointerInsideOverlay = false
  private playlistOpen = false
  private favoritePending = false

  constructor(private readonly options: PlayerOverlayOptions) {
    this.root = options.art.template.$player as HTMLElement
    this.controlsEl = options.art.template.$controls as HTMLElement
    this.bottomEl = options.art.template.$bottom as HTMLElement
    this.progressEl = options.art.template.$progress as HTMLElement
    this.backBtn = document.getElementById('btn-back') as HTMLButtonElement | null
    this.moveBtn = document.getElementById('btn-move') as HTMLButtonElement | null
    this.favoriteBtn = document.getElementById('btn-favorite') as HTMLButtonElement | null
    this.favoriteOutlineEl = document.getElementById('icon-favorite-outline')
    this.favoriteFilledEl = document.getElementById('icon-favorite-filled')
    this.playlistBtn = document.getElementById('btn-playlist') as HTMLButtonElement | null
    this.playlistCloseBtn = document.getElementById('btn-playlist-close') as HTMLButtonElement | null
    this.playlistMaskEl = document.getElementById('playlist-mask')
    this.playlistPanelEl = document.getElementById('playlist-panel')
    this.playlistListEl = document.getElementById('playlist-list')
  }

  init() {
    this.mountHeaderOverlay()
    if (this.playlistMaskEl) {
      this.root.appendChild(this.playlistMaskEl)
      this.playlistMaskEl.addEventListener('click', this.handlePlaylistClose)
    }
    if (this.playlistPanelEl) {
      this.root.appendChild(this.playlistPanelEl)
      this.playlistPanelEl.addEventListener('mouseenter', this.handleOverlayEnter)
      this.playlistPanelEl.addEventListener('mouseleave', this.handleOverlayLeave)
    }

    this.controlsEl.addEventListener('mouseenter', this.handleOverlayEnter)
    this.controlsEl.addEventListener('mouseleave', this.handleOverlayLeave)
    this.controlsEl.style.transition = 'opacity .2s ease'
    this.root.addEventListener('mousemove', this.handleMouseMove)
    this.root.addEventListener('mouseenter', this.handleMouseMove)
    this.root.addEventListener('mouseleave', this.handleMouseLeave)

    this.titleEl && (this.titleEl.textContent = this.options.meta.title)
    document.title = this.options.meta.title

    if (this.statsEl && this.options.meta.fileSize) {
      this.statsEl.textContent = this.options.meta.fileSize
      this.statsEl.classList.remove('hidden')
    }

    this.renderBreadcrumbs(this.options.meta.path)
    this.renderFavorite(this.options.meta.isMarked)

    this.backBtn?.addEventListener('click', this.handleBack)
    this.moveBtn?.addEventListener('click', this.handleMove)
    this.favoriteBtn?.addEventListener('click', this.handleFavorite)
    this.playlistBtn?.addEventListener('click', this.handlePlaylistButton)
    this.playlistCloseBtn?.addEventListener('click', this.handlePlaylistClose)

    this.showTemporarily()
  }

  destroy() {
    if (this.visibleTimer) {
      window.clearTimeout(this.visibleTimer)
      this.visibleTimer = null
    }
    this.root.removeEventListener('mousemove', this.handleMouseMove)
    this.root.removeEventListener('mouseenter', this.handleMouseMove)
    this.root.removeEventListener('mouseleave', this.handleMouseLeave)
    this.controlsEl.removeEventListener('mouseenter', this.handleOverlayEnter)
    this.controlsEl.removeEventListener('mouseleave', this.handleOverlayLeave)
    this.headerEl?.removeEventListener('mouseenter', this.handleOverlayEnter)
    this.headerEl?.removeEventListener('mouseleave', this.handleOverlayLeave)
    this.playlistPanelEl?.removeEventListener('mouseenter', this.handleOverlayEnter)
    this.playlistPanelEl?.removeEventListener('mouseleave', this.handleOverlayLeave)
  }

  setCurrentTitle(title: string) {
    this.options.meta.title = title
    if (this.titleEl) this.titleEl.textContent = title
    document.title = title
  }

  private renderBreadcrumbs(items: OverlayPathItem[]) {
    if (!this.breadcrumbsEl) return
    if (items.length === 0) {
      this.breadcrumbsEl.classList.add('hidden')
      this.breadcrumbsEl.innerHTML = ''
      return
    }

    this.breadcrumbsEl.classList.remove('hidden')
    this.breadcrumbsEl.innerHTML = items.map((item, index) => {
      const sep = index < items.length - 1 ? '<span class="mx-2 text-white/40">></span>' : ''
      return `<a class="pointer-events-auto hover:text-white" href="https://115.com/?cid=${encodeURIComponent(item.cid)}&offset=0&tab=&mode=wangpan" target="_blank" rel="noreferrer">${escapeHtml(item.name)}</a>${sep}`
    }).join('')
  }

  private renderFavorite(marked: boolean) {
    this.options.meta.isMarked = marked
    this.favoriteOutlineEl?.classList.toggle('hidden', marked)
    this.favoriteFilledEl?.classList.toggle('hidden', !marked)
  }

  private renderPlaylist(items: OverlayPlaylistItem[]) {
    if (!this.playlistListEl) return
    const currentPickCode = this.options.getCurrentPickCode()
    this.playlistListEl.innerHTML = items.map((item) => {
      const active = item.pickCode === currentPickCode
      return `
        <button class="m115-playlist-item flex w-full items-start gap-3 rounded-lg px-3 py-2 text-left transition-colors ${active ? 'bg-white/14 text-white' : 'text-white/76 hover:bg-white/8 hover:text-white'}" data-pickcode="${escapeHtml(item.pickCode)}">
          <span class="mt-1 h-2 w-2 shrink-0 rounded-full ${active ? 'bg-sky-400' : 'bg-white/18'}"></span>
          <span class="min-w-0 flex-1">
            <span class="block truncate text-sm font-medium">${escapeHtml(item.name)}</span>
            ${item.size ? `<span class="mt-0.5 block text-xs text-white/45">${escapeHtml(item.size)}</span>` : ''}
          </span>
        </button>
      `
    }).join('')

    this.playlistListEl.querySelectorAll<HTMLButtonElement>('.m115-playlist-item').forEach((node) => {
      node.addEventListener('click', () => {
        const pickCode = node.dataset.pickcode || ''
        if (!pickCode) return
        this.options.onPlaylistPlay(pickCode)
        this.setPlaylistOpen(false)
      })
    })
  }

  private setVisible(visible: boolean) {
    if (this.headerEl) {
      this.headerEl.style.opacity = visible ? '1' : '0'
      this.headerEl.style.pointerEvents = visible ? 'auto' : 'none'
    }
    this.controlsEl.style.opacity = visible ? '1' : '0'
    this.controlsEl.style.pointerEvents = visible ? 'auto' : 'none'
    this.bottomEl.style.opacity = visible ? '1' : '0'
    this.bottomEl.style.pointerEvents = visible ? 'auto' : 'none'
    this.progressEl.style.opacity = visible ? '1' : '0'
    this.progressEl.style.pointerEvents = visible ? 'auto' : 'none'
    this.root.style.cursor = visible || this.playlistOpen ? 'auto' : 'none'
  }

  private mountHeaderOverlay() {
    this.headerEl?.remove()

    const header = document.createElement('div')
    header.style.cssText = [
      'position:absolute',
      'top:0',
      'left:0',
      'right:0',
      'z-index:200',
      'display:flex',
      'align-items:flex-start',
      'justify-content:space-between',
      'gap:16px',
      'padding:16px 20px 28px',
      'background:linear-gradient(180deg, rgba(0,0,0,.76) 0%, rgba(0,0,0,.32) 58%, rgba(0,0,0,0) 100%)',
      'opacity:0',
      'pointer-events:none',
      'transition:opacity .2s ease',
      'box-sizing:border-box',
    ].join(';')

    const left = document.createElement('div')
    left.style.cssText = 'min-width:0;max-width:min(62vw,760px);display:flex;align-items:flex-start;gap:12px;'

    const back = document.createElement('button')
    back.type = 'button'
    back.title = '返回'
    back.style.cssText = [
      'pointer-events:auto',
      'display:flex',
      'align-items:center',
      'justify-content:center',
      'width:40px',
      'height:40px',
      'border-radius:999px',
      'border:1px solid rgba(255,255,255,.18)',
      'background:rgba(0,0,0,.42)',
      'color:rgba(255,255,255,.88)',
      'cursor:pointer',
      'flex-shrink:0',
    ].join(';')
    back.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>'

    const info = document.createElement('div')
    info.style.cssText = 'min-width:0;padding-top:2px;'

    const titleRow = document.createElement('div')
    titleRow.style.cssText = 'display:flex;align-items:baseline;gap:8px;min-width:0;flex-wrap:wrap;'

    const title = document.createElement('div')
    title.style.cssText = [
      'font-size:16px',
      'font-weight:700',
      'line-height:1.35',
      'color:#fff',
      'text-shadow:0 1px 10px rgba(0,0,0,.6)',
      'white-space:nowrap',
      'overflow:hidden',
      'text-overflow:ellipsis',
      'max-width:min(52vw,620px)',
      'user-select:text',
      'pointer-events:auto',
    ].join(';')

    const stats = document.createElement('div')
    stats.style.cssText = [
      'font-size:12px',
      'font-weight:600',
      'line-height:1.2',
      'color:rgba(255,255,255,.72)',
      'text-shadow:0 1px 10px rgba(0,0,0,.6)',
      'white-space:nowrap',
      'user-select:text',
      'pointer-events:auto',
    ].join(';')

    const breadcrumbs = document.createElement('div')
    breadcrumbs.style.cssText = [
      'margin-top:6px',
      'font-size:12px',
      'line-height:1.5',
      'color:rgba(255,255,255,.8)',
      'text-shadow:0 1px 10px rgba(0,0,0,.6)',
      'white-space:nowrap',
      'overflow:hidden',
      'text-overflow:ellipsis',
      'user-select:text',
      'pointer-events:auto',
    ].join(';')

    titleRow.appendChild(title)
    titleRow.appendChild(stats)
    info.appendChild(titleRow)
    info.appendChild(breadcrumbs)
    left.appendChild(back)
    left.appendChild(info)
    header.appendChild(left)
    this.root.appendChild(header)

    this.headerEl = header
    this.titleEl = title
    this.statsEl = stats
    this.breadcrumbsEl = breadcrumbs

    back.addEventListener('click', this.handleBack)
    header.addEventListener('mouseenter', this.handleOverlayEnter)
    header.addEventListener('mouseleave', this.handleOverlayLeave)
  }

  private showTemporarily() {
    this.setVisible(true)
    if (this.visibleTimer) {
      window.clearTimeout(this.visibleTimer)
    }
    this.visibleTimer = window.setTimeout(() => {
      if (!this.isPointerInsideOverlay && !this.playlistOpen) {
        this.setVisible(false)
      }
    }, 1000)
  }

  private setPlaylistOpen(open: boolean) {
    this.playlistOpen = open
    this.playlistMaskEl?.classList.toggle('pointer-events-auto', open)
    this.playlistMaskEl?.classList.toggle('opacity-100', open)
    this.playlistPanelEl?.classList.toggle('pointer-events-auto', open)
    this.playlistPanelEl?.classList.toggle('translate-x-0', open)
    this.playlistPanelEl?.classList.toggle('translate-x-full', !open)
    this.setVisible(open || this.isPointerInsideOverlay)
  }

  private handleBack = () => {
    if (window.history.length > 1) window.history.back()
    else window.close()
  }

  private handleMouseMove = () => {
    this.showTemporarily()
  }

  private handleMouseLeave = () => {
    if (!this.playlistOpen && !this.isPointerInsideOverlay) {
      this.setVisible(false)
    }
  }

  private handleOverlayEnter = () => {
    this.isPointerInsideOverlay = true
    this.setVisible(true)
  }

  private handleOverlayLeave = () => {
    this.isPointerInsideOverlay = false
    this.showTemporarily()
  }

  private handleMove = async () => {
    await this.options.onMove()
    this.showTemporarily()
  }

  private handleFavorite = async () => {
    if (this.favoritePending) return
    this.favoritePending = true
    try {
      const next = !this.options.meta.isMarked
      const applied = await this.options.onToggleFavorite(next)
      this.renderFavorite(applied)
    }
    finally {
      this.favoritePending = false
    }
  }

  private handlePlaylistButton = async () => {
    const nextOpen = !this.playlistOpen
    if (nextOpen) {
      const items = await this.options.onPlaylistToggle(true)
      this.renderPlaylist(items)
    }
    this.setPlaylistOpen(nextOpen)
  }

  private handlePlaylistClose = () => {
    this.setPlaylistOpen(false)
    this.showTemporarily()
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}
