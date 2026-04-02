import type Artplayer from 'artplayer'
import { getVideoCovers } from '../../lib/videoThumbnail'
import { escapeHtml } from '../../shared/utils'

export interface OverlayPathItem {
  cid: string
  name: string
}

export interface OverlayPlaylistItem {
  pickCode: string
  fileId: string
  name: string
  size?: string
  isMarked?: boolean
  duration?: number
  sha?: string
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
  onMoveFile: (fileId: string, cid: string) => Promise<void>
  onToggleFavorite: (fileId: string, nextMarked: boolean) => Promise<boolean>
  onPlaylistToggle: (open: boolean) => Promise<OverlayPlaylistItem[]>
  onPlaylistPlay: (pickCode: string) => void
  onRefreshBreadcrumbs?: () => void
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
  private sidebarEl: HTMLElement | null
  private headerEl: HTMLElement | null = null
  private titleEl: HTMLElement | null = null
  private statsEl: HTMLElement | null = null
  private breadcrumbsEl: HTMLElement | null = null
  private playlistTabEl: HTMLElement | null = null
  private playlistListEl: HTMLElement | null = null
  private favBtnEl: HTMLButtonElement | null = null
  private moveBtnEl: HTMLButtonElement | null = null
  private visibleTimer: number | null = null
  private isPointerInsideOverlay = false
  private isPointerOnProgress = false
  private playlistOpen = false
  private playlistItems: OverlayPlaylistItem[] = []

  constructor(private readonly options: PlayerOverlayOptions) {
    this.root = options.art.template.$player as HTMLElement
    this.controlsEl = options.art.template.$controls as HTMLElement
    this.bottomEl = options.art.template.$bottom as HTMLElement
    this.progressEl = options.art.template.$progress as HTMLElement
    this.sidebarEl = document.getElementById('playlist-sidebar')
  }

  init() {
    // Hide the static HTML header
    const staticHeader = document.getElementById('header')
    if (staticHeader) staticHeader.style.display = 'none'

    this.mountHeaderOverlay()
    this.mountPlaylistTab()
    this.mountSidebarContent()

    this.controlsEl.addEventListener('mouseenter', this.handleOverlayEnter)
    this.controlsEl.addEventListener('mouseleave', this.handleOverlayLeave)
    this.controlsEl.style.transition = 'opacity .2s ease'
    // 鼠标在进度条上时也保持控件不隐藏（查看预览图需要）
    if (this.progressEl) {
      this.progressEl.addEventListener('mouseenter', this.handleProgressEnter)
      this.progressEl.addEventListener('mouseleave', this.handleProgressLeave)
    }
    this.root.addEventListener('mousemove', this.handleMouseMove)
    this.root.addEventListener('mouseenter', this.handleMouseMove)
    this.root.addEventListener('mouseleave', this.handleMouseLeave)

    // 监听来自 background 的移动成功消息（通过 tabs.sendMessage）
    chrome.runtime.onMessage.addListener(this.handleRuntimeMessage)

    this.titleEl && (this.titleEl.textContent = this.options.meta.title)
    document.title = this.options.meta.title

    if (this.statsEl && this.options.meta.fileSize) {
      this.statsEl.textContent = this.options.meta.fileSize
      this.statsEl.style.display = ''
    }

    this.renderBreadcrumbs(this.options.meta.path)
    this.showTemporarily()
  }

  destroy() {
    if (this.visibleTimer) {
      window.clearTimeout(this.visibleTimer)
      this.visibleTimer = null
    }
    chrome.runtime.onMessage.removeListener(this.handleRuntimeMessage)
    this.root.removeEventListener('mousemove', this.handleMouseMove)
    this.root.removeEventListener('mouseenter', this.handleMouseMove)
    this.root.removeEventListener('mouseleave', this.handleMouseLeave)
    this.controlsEl.removeEventListener('mouseenter', this.handleOverlayEnter)
    this.controlsEl.removeEventListener('mouseleave', this.handleOverlayLeave)
    this.headerEl?.removeEventListener('mouseenter', this.handleOverlayEnter)
    this.headerEl?.removeEventListener('mouseleave', this.handleOverlayLeave)
  }

  setCurrentTitle(title: string) {
    this.options.meta.title = title
    if (this.titleEl) this.titleEl.textContent = title
    document.title = title
  }

  updateBreadcrumbs(items: OverlayPathItem[]) {
    if (!items || items.length === 0) return
    this.options.meta.path = items
    this.renderBreadcrumbs(items)
  }

  updateFavoriteStatus(isMarked: boolean) {
    this.options.meta.isMarked = isMarked
    this.updateFavoriteIcon()
  }

  private renderBreadcrumbs(items: OverlayPathItem[]) {
    if (!this.breadcrumbsEl) return
    if (items.length === 0) {
      this.breadcrumbsEl.style.display = 'none'
      this.breadcrumbsEl.innerHTML = ''
      return
    }

    this.breadcrumbsEl.style.display = ''
    this.breadcrumbsEl.innerHTML = items.map((item, index) => {
      const sep = index < items.length - 1 ? '<span style="margin:0 6px;opacity:.4">›</span>' : ''
      return `<a style="pointer-events:auto;text-decoration:none;color:inherit;transition:color .15s" onmouseenter="this.style.color='#fff'" onmouseleave="this.style.color=''" href="https://115.com/?cid=${encodeURIComponent(item.cid)}&offset=0&tab=&mode=wangpan" target="_blank" rel="noreferrer">${escapeHtml(item.name)}</a>${sep}`
    }).join('')
  }

  private renderPlaylist(items: OverlayPlaylistItem[]) {
    if (!this.playlistListEl) return
    this.playlistItems = items
    const currentPickCode = this.options.getCurrentPickCode()

    this.playlistListEl.innerHTML = items.map((item, index) => {
      const active = item.pickCode === currentPickCode
      const num = index + 1
      return `
        <div class="m115-pl-item" data-pickcode="${esc(item.pickCode)}" data-index="${index}"
          style="display:flex;align-items:center;gap:10px;padding:6px 8px;border-radius:8px;cursor:pointer;transition:background .15s;${active ? 'background:rgba(255,255,255,.12)' : ''}">
          <span style="flex-shrink:0;width:22px;text-align:center;font-size:11px;font-variant-numeric:tabular-nums;${active ? 'color:#38bdf8;font-weight:600' : 'color:rgba(255,255,255,.35)'}">${num}</span>
          <div class="m115-pl-thumb" style="position:relative;width:120px;height:68px;border-radius:6px;flex-shrink:0;background:#1a1a1a;overflow:hidden;display:flex;align-items:center;justify-content:center">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,.15)" stroke-width="1.5"><polygon points="5 3 19 12 5 21 5 3"/></svg>
          </div>
          <div style="min-width:0;flex:1;overflow:hidden">
            <div style="font-size:13px;font-weight:500;line-height:1.4;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;text-overflow:ellipsis;${active ? 'color:#fff' : 'color:rgba(255,255,255,.78)'}">${escapeHtml(item.name)}</div>
            ${item.size ? `<div style="font-size:11px;color:rgba(255,255,255,.35);margin-top:2px">${escapeHtml(item.size)}</div>` : ''}
          </div>
        </div>
      `
    }).join('')

    // Bind events
    this.playlistListEl.querySelectorAll<HTMLElement>('.m115-pl-item').forEach((node) => {
      const pc = node.dataset.pickcode || ''
      const isActive = pc === currentPickCode

      node.addEventListener('mouseenter', () => {
        node.style.background = isActive ? 'rgba(255,255,255,.14)' : 'rgba(255,255,255,.06)'
      })
      node.addEventListener('mouseleave', () => {
        node.style.background = isActive ? 'rgba(255,255,255,.12)' : ''
      })
      node.addEventListener('click', () => {
        if (pc) this.options.onPlaylistPlay(pc)
      })
    })

    // Scroll current item into view
    const activeNode = this.playlistListEl.querySelector(`[data-pickcode="${esc(currentPickCode)}"]`)
    activeNode?.scrollIntoView({ block: 'center', behavior: 'instant' })

    // Lazy-load covers for visible items using IntersectionObserver
    this.lazyLoadCovers(items)
  }

  private lazyLoadCovers(items: OverlayPlaylistItem[]) {
    if (!this.playlistListEl) return
    const thumbEls = this.playlistListEl.querySelectorAll<HTMLElement>('.m115-pl-thumb')
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
            thumbEl.innerHTML = `<img src="${covers[0].imgUrl}" alt="" style="width:100%;height:100%;object-fit:cover;display:block" />`
          }
        }).catch(() => {
          // keep placeholder on error
        })
      }
    }, { root: this.playlistListEl, rootMargin: '200px 0px' })

    thumbEls.forEach(el => observer.observe(el))
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

  // ── Header (left side only: back, title, stats, breadcrumbs) ──

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
      'padding:16px 20px 28px',
      'background:linear-gradient(180deg, rgba(0,0,0,.76) 0%, rgba(0,0,0,.32) 58%, rgba(0,0,0,0) 100%)',
      'opacity:0',
      'pointer-events:none',
      'transition:opacity .2s ease',
      'box-sizing:border-box',
    ].join(';')

    const left = document.createElement('div')
    left.style.cssText = 'min-width:0;max-width:min(72vw,800px);display:flex;align-items:flex-start;gap:12px;'

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

    // ── Right side: action buttons for current video ──
    const right = document.createElement('div')
    right.style.cssText = 'display:flex;align-items:center;gap:8px;margin-left:auto;flex-shrink:0;pointer-events:auto;padding-top:2px;'

    const pillGroup = document.createElement('div')
    pillGroup.style.cssText = 'display:flex;align-items:center;border-radius:999px;border:1px solid rgba(255,255,255,.18);background:rgba(0,0,0,.42);padding:2px;gap:0;'
    const moveBtn = document.createElement('button')
    moveBtn.type = 'button'
    moveBtn.title = '移动视频'
    moveBtn.style.cssText = 'display:flex;align-items:center;justify-content:center;width:36px;height:36px;border-radius:999px;border:none;background:transparent;color:rgba(255,255,255,.82);cursor:pointer;transition:background .15s,color .15s;'
    moveBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24"><path style="fill:none;stroke:rgba(255,255,255,.82);stroke-width:2" d="M5 9l-3 3 3 3"/><path style="fill:none;stroke:rgba(255,255,255,.82);stroke-width:2" d="M2 12h14"/><path style="fill:none;stroke:rgba(255,255,255,.82);stroke-width:2" d="M12 5V2h10v20H12v-3"/></svg>'
    moveBtn.addEventListener('mouseenter', () => { moveBtn.style.background = 'rgba(255,255,255,.1)' })
    moveBtn.addEventListener('mouseleave', () => { moveBtn.style.background = 'transparent' })
    moveBtn.addEventListener('click', async () => {
      const { fileId, cid } = this.options.meta
      console.log('[115m] 移动文件:', fileId, cid)
      if (!fileId) {
        this.showToast('文件 ID 缺失')
        return
      }
      try {
        await this.options.onMoveFile(fileId, cid)
      } catch (e: any) {
        const msg = e?.message || ''
        console.error('[115m] 移动失败:', msg)
        if (msg.includes('User canceled')) { /* user closed dialog, no toast needed */ }
        else this.showToast('移动失败: ' + msg)
      }
    })

    const favBtn = document.createElement('button')
    favBtn.type = 'button'
    favBtn.title = '收藏'
    favBtn.style.cssText = 'display:flex;align-items:center;justify-content:center;width:36px;height:36px;border-radius:999px;border:none;background:transparent;color:rgba(255,255,255,.82);cursor:pointer;transition:all .2s ease;'
    favBtn.addEventListener('mouseenter', () => { favBtn.style.background = 'rgba(255,255,255,.1)' })
    favBtn.addEventListener('mouseleave', () => { favBtn.style.background = 'transparent' })
    favBtn.addEventListener('click', async () => {
      const fileId = this.options.meta.fileId
      console.log('[115m] 收藏切换:', { fileId, currentMarked: this.options.meta.isMarked })
      if (!fileId) {
        this.showToast('文件 ID 缺失，无法收藏')
        return
      }
      const nextMarked = !this.options.meta.isMarked
      favBtn.style.opacity = '0.4'
      favBtn.style.pointerEvents = 'none'
      favBtn.style.transform = 'scale(0.85)'
      try {
        const result = await this.options.onToggleFavorite(fileId, nextMarked)
        this.options.meta.isMarked = result
        this.updateFavoriteIcon()
        // Flash animation for feedback
        favBtn.style.transform = 'scale(1.3)'
        setTimeout(() => { favBtn.style.transform = '' }, 200)
        this.showToast(result ? '已收藏 ♥' : '已取消收藏')
        console.log('[115m] 收藏结果:', result)
      } catch (e) {
        console.error('[115m] 收藏失败:', e)
        this.showToast('操作失败')
      } finally {
        favBtn.style.opacity = ''
        favBtn.style.pointerEvents = ''
      }
    })
    this.favBtnEl = favBtn
    this.moveBtnEl = moveBtn
    // 初始状态设为未收藏，避免闪烁（等 API 返回后更新）
    this.options.meta.isMarked = false
    this.updateFavoriteIcon()

    pillGroup.appendChild(moveBtn)
    pillGroup.appendChild(favBtn)
    right.appendChild(pillGroup)
    header.appendChild(right)

    this.root.appendChild(header)

    this.headerEl = header
    this.titleEl = title
    this.statsEl = stats
    this.breadcrumbsEl = breadcrumbs

    header.classList.add('m115-interactive')
    back.addEventListener('click', this.handleBack)
    header.addEventListener('mouseenter', this.handleOverlayEnter)
    header.addEventListener('mouseleave', this.handleOverlayLeave)
  }

  private updateFavoriteIcon() {
    if (!this.favBtnEl) return
    const marked = this.options.meta.isMarked
    this.favBtnEl.title = marked ? '取消收藏' : '收藏'
    // Use inline style on path to bypass ArtPlayer `.art-video-player svg { fill }` override
    this.favBtnEl.innerHTML = marked
      ? '<svg width="20" height="20" viewBox="0 0 24 24"><path style="fill:#f472b6" d="m12 21.35-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09A6 6 0 0 1 16.5 3C19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54z"/></svg>'
      : '<svg width="18" height="18" viewBox="0 0 24 24"><path style="fill:none;stroke:rgba(255,255,255,.7);stroke-width:2" d="m12 20.4-1.4-1.27C5.4 14.36 2 11.28 2 7.5 2 4.42 4.42 2 7.5 2c1.74 0 3.41.81 4.5 2.09A6 6 0 0 1 16.5 2C19.58 2 22 4.42 22 7.5c0 3.78-3.4 6.86-8.6 11.63z"/></svg>'
  }

  private showToast(text: string) {
    const existing = this.root.querySelector('.m115-toast')
    existing?.remove()

    const toast = document.createElement('div')
    toast.className = 'm115-toast'
    toast.textContent = text
    toast.style.cssText = [
      'position:absolute',
      'top:60px',
      'left:50%',
      'transform:translateX(-50%) translateY(-8px)',
      'z-index:300',
      'padding:8px 20px',
      'border-radius:999px',
      'background:rgba(0,0,0,.85)',
      'color:#fff',
      'font-size:13px',
      'font-weight:500',
      'white-space:nowrap',
      'pointer-events:none',
      'opacity:0',
      'transition:opacity .2s ease, transform .2s ease',
      'backdrop-filter:blur(8px)',
    ].join(';')
    this.root.appendChild(toast)

    requestAnimationFrame(() => {
      toast.style.opacity = '1'
      toast.style.transform = 'translateX(-50%) translateY(0)'
    })
    setTimeout(() => {
      toast.style.opacity = '0'
      toast.style.transform = 'translateX(-50%) translateY(-8px)'
      setTimeout(() => toast.remove(), 200)
    }, 1800)
  }

  // ── Playlist toggle tab (right edge, vertically centered) ──

  private mountPlaylistTab() {
    const tab = document.createElement('div')
    tab.style.cssText = [
      'position:absolute',
      'right:0',
      'top:50%',
      'transform:translateY(-50%)',
      'z-index:210',
      'display:flex',
      'align-items:center',
      'justify-content:center',
      'width:28px',
      'height:72px',
      'border-radius:8px 0 0 8px',
      'background:rgba(0,0,0,.5)',
      'border:1px solid rgba(255,255,255,.12)',
      'border-right:none',
      'color:rgba(255,255,255,.6)',
      'cursor:pointer',
      'transition:background .2s, color .2s, opacity .2s',
      'pointer-events:auto',
      'opacity:0.6',
    ].join(';')
    tab.title = '播放列表'
    tab.classList.add('m115-interactive')
    tab.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6h16"/><path d="M4 12h16"/><path d="M4 18h10"/></svg>'

    tab.addEventListener('mouseenter', () => {
      tab.style.background = 'rgba(0,0,0,.7)'
      tab.style.color = '#fff'
      tab.style.opacity = '1'
    })
    tab.addEventListener('mouseleave', () => {
      if (!this.playlistOpen) {
        tab.style.background = 'rgba(0,0,0,.5)'
        tab.style.color = 'rgba(255,255,255,.6)'
        tab.style.opacity = '0.6'
      }
    })
    tab.addEventListener('click', this.handlePlaylistToggle)

    this.root.appendChild(tab)
    this.playlistTabEl = tab
  }

  // ── Sidebar content (rendered into #playlist-sidebar, outside the player) ──

  private mountSidebarContent() {
    if (!this.sidebarEl) {
      // 在构造时可能还没找到，再次尝试
      this.sidebarEl = document.getElementById('playlist-sidebar')
    }
    if (!this.sidebarEl) {
      console.warn('[115m] #playlist-sidebar not found in DOM')
      return
    }
    console.log('[115m] mountSidebarContent: sidebar found, setting up content')

    this.sidebarEl.innerHTML = ''
    this.sidebarEl.style.cssText = 'width:0;min-width:0;flex:0 0 0;overflow:hidden;transition:width .25s ease, flex-basis .25s ease;background:#0a0a0a;border-left:1px solid rgba(255,255,255,.06);display:flex;flex-direction:column;box-sizing:border-box;height:100%;'

    // Panel header
    const panelHeader = document.createElement('div')
    panelHeader.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:14px 14px 10px;flex-shrink:0;width:100%;box-sizing:border-box;'

    const panelTitle = document.createElement('div')
    panelTitle.style.cssText = 'font-size:14px;font-weight:600;color:rgba(255,255,255,.9)'
    panelTitle.textContent = '播放列表'

    const closeBtn = document.createElement('button')
    closeBtn.type = 'button'
    closeBtn.title = '关闭'
    closeBtn.style.cssText = 'display:flex;align-items:center;justify-content:center;width:28px;height:28px;border:none;border-radius:6px;background:transparent;color:rgba(255,255,255,.5);cursor:pointer;transition:background .15s,color .15s'
    closeBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>'
    closeBtn.addEventListener('mouseenter', () => { closeBtn.style.background = 'rgba(255,255,255,.1)'; closeBtn.style.color = '#fff' })
    closeBtn.addEventListener('mouseleave', () => { closeBtn.style.background = 'transparent'; closeBtn.style.color = 'rgba(255,255,255,.5)' })
    closeBtn.addEventListener('click', () => this.setPlaylistOpen(false))

    panelHeader.appendChild(panelTitle)
    panelHeader.appendChild(closeBtn)

    // List container
    const listContainer = document.createElement('div')
    listContainer.style.cssText = 'flex:1;overflow-y:auto;padding:0 8px 12px;width:100%;box-sizing:border-box;'

    // Custom scrollbar
    const scrollStyle = document.createElement('style')
    scrollStyle.textContent = `
      .m115-pl-scroll::-webkit-scrollbar { width: 4px; }
      .m115-pl-scroll::-webkit-scrollbar-track { background: transparent; }
      .m115-pl-scroll::-webkit-scrollbar-thumb { background: rgba(255,255,255,.15); border-radius: 4px; }
      .m115-pl-scroll::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,.3); }
    `
    listContainer.classList.add('m115-pl-scroll')

    this.sidebarEl.appendChild(scrollStyle)
    this.sidebarEl.appendChild(panelHeader)
    this.sidebarEl.appendChild(listContainer)
    this.playlistListEl = listContainer
  }

  private setPlaylistOpen(open: boolean) {
    this.playlistOpen = open
    // Expand/collapse the external sidebar — the video area shrinks/grows via flex
    if (this.sidebarEl) {
      const width = open ? '360px' : '0px'
      this.sidebarEl.style.width = width
      this.sidebarEl.style.minWidth = width
      this.sidebarEl.style.flex = open ? '0 0 360px' : '0 0 0px'

      const computed = window.getComputedStyle(this.sidebarEl)
      console.log('[115m] setPlaylistOpen:', {
        open,
        sidebarEl: true,
        inlineWidth: this.sidebarEl.style.width,
        inlineMinWidth: this.sidebarEl.style.minWidth,
        inlineFlex: this.sidebarEl.style.flex,
        computedWidth: computed.width,
        computedDisplay: computed.display,
      })
    }
    if (this.playlistTabEl) {
      if (open) {
        this.playlistTabEl.style.opacity = '0'
        this.playlistTabEl.style.pointerEvents = 'none'
      }
      else {
        this.playlistTabEl.style.opacity = '0.6'
        this.playlistTabEl.style.pointerEvents = 'auto'
      }
    }
    this.setVisible(open || this.isPointerInsideOverlay)
  }

  // ── Event handlers ──

  private showTemporarily() {
    this.setVisible(true)
    if (this.visibleTimer) {
      window.clearTimeout(this.visibleTimer)
    }
    this.visibleTimer = window.setTimeout(() => {
      if (!this.isPointerInsideOverlay && !this.playlistOpen && !this.isPointerOnProgress) {
        this.setVisible(false)
      }
    }, 1000)
  }

  private handleBack = () => {
    if (window.history.length > 1) window.history.back()
    else window.close()
  }

  private handleMouseMove = () => {
    this.showTemporarily()
  }

  private handleMouseLeave = () => {
    if (!this.playlistOpen && !this.isPointerInsideOverlay && !this.isPointerOnProgress) {
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

  private handleProgressEnter = () => {
    this.isPointerOnProgress = true
    this.setVisible(true)
    // 鼠标进入进度条时取消隐藏定时器
    if (this.visibleTimer) {
      window.clearTimeout(this.visibleTimer)
      this.visibleTimer = null
    }
  }

  private handleProgressLeave = () => {
    this.isPointerOnProgress = false
    this.showTemporarily()
  }

  private handlePlaylistToggle = async () => {
    const nextOpen = !this.playlistOpen
    console.log('[115m] handlePlaylistToggle:', { nextOpen, sidebarEl: !!this.sidebarEl, playlistListEl: !!this.playlistListEl })
    if (nextOpen) {
      const items = await this.options.onPlaylistToggle(true)
      console.log('[115m] playlist items received:', items.length, items)
      this.renderPlaylist(items)
    }
    this.setPlaylistOpen(nextOpen)
  }

  private handleRuntimeMessage = (message: any) => {
    if (message?.type === 'MOVE_SUCCESS_REFRESH') {
      this.options.onRefreshBreadcrumbs?.()
      this.showToast('文件已移动')
    }
  }
}


// Alias for attribute escaping (same logic)
const esc = escapeHtml
