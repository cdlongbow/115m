import { sendRuntimeMessageSafe } from './runtime'
import { escapeHtml } from '../../shared/utils'

// ─── Types ───
interface FolderItem {
  cid: string
  name: string
  pid: string
}

interface BreadcrumbItem {
  cid: string
  name: string
}

interface RecentMoveRecord {
  cid: string
  name: string
  path: string      // 用于显示的路径文本
  timestamp: number
}

const RECENT_MOVES_KEY = '115m_recent_moves'
const MAX_RECENT = 8

// ─── CSS Styles ───
const DIALOG_STYLES = `
  .move-dialog-mask {
    position: fixed; inset: 0; z-index: 10000000;
    background: rgba(0,0,0,.55); backdrop-filter: blur(6px);
    display: flex; align-items: center; justify-content: center;
    animation: mdFadeIn .2s ease;
  }
  @keyframes mdFadeIn { from { opacity: 0 } to { opacity: 1 } }
  @keyframes mdSlideUp { from { opacity: 0; transform: translateY(20px) scale(.97) } to { opacity: 1; transform: translateY(0) scale(1) } }

  .move-dialog-box {
    width: 640px; max-width: 92vw; max-height: 80vh;
    background: #1e1e22; border-radius: 16px;
    box-shadow: 0 24px 80px rgba(0,0,0,.6), 0 0 0 1px rgba(255,255,255,.06);
    display: flex; flex-direction: column;
    animation: mdSlideUp .25s ease;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    color: #e8e8ec;
  }

  /* Header */
  .move-dialog-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 18px 24px 14px; border-bottom: 1px solid rgba(255,255,255,.06);
    flex-shrink: 0;
  }
  .move-dialog-header h3 {
    margin: 0; font-size: 16px; font-weight: 600; color: #fff;
  }
  .move-dialog-close {
    width: 32px; height: 32px; border-radius: 8px; border: none;
    background: transparent; color: rgba(255,255,255,.5);
    cursor: pointer; font-size: 20px; line-height: 1;
    display: flex; align-items: center; justify-content: center;
    transition: all .15s;
  }
  .move-dialog-close:hover { background: rgba(255,255,255,.08); color: #fff; }

  /* Toolbar (search + buttons) */
  .move-dialog-toolbar {
    display: flex; align-items: center; gap: 8px;
    padding: 12px 24px; flex-shrink: 0;
  }
  .move-dialog-search {
    flex: 1; height: 36px; border-radius: 8px;
    border: 1px solid rgba(255,255,255,.1);
    background: rgba(255,255,255,.05);
    padding: 0 12px; color: #e8e8ec; font-size: 13px;
    outline: none; transition: border-color .15s;
  }
  .move-dialog-search::placeholder { color: rgba(255,255,255,.3); }
  .move-dialog-search:focus { border-color: rgba(79,140,255,.6); }

  .move-dialog-tbtn {
    height: 36px; padding: 0 14px; border-radius: 8px; border: none;
    background: rgba(255,255,255,.06); color: rgba(255,255,255,.7);
    font-size: 13px; cursor: pointer; white-space: nowrap;
    display: flex; align-items: center; gap: 5px;
    transition: all .15s;
  }
  .move-dialog-tbtn:hover { background: rgba(255,255,255,.1); color: #fff; }
  .move-dialog-tbtn svg { width: 16px; height: 16px; }

  /* Breadcrumbs */
  .move-dialog-crumbs {
    display: flex; align-items: center; gap: 2px;
    padding: 4px 24px 8px; flex-shrink: 0; flex-wrap: wrap;
    font-size: 13px; min-height: 28px;
  }
  .move-dialog-crumb {
    background: none; border: none; color: rgba(79,140,255,.85);
    cursor: pointer; padding: 2px 6px; border-radius: 4px;
    font-size: 13px; transition: all .12s;
  }
  .move-dialog-crumb:hover { background: rgba(79,140,255,.1); color: #5fa0ff; }
  .move-dialog-crumb.current {
    color: rgba(255,255,255,.6); cursor: default; pointer-events: none;
  }
  .move-dialog-crumb-sep { color: rgba(255,255,255,.2); font-size: 11px; margin: 0 1px; }

  /* Folder List */
  .move-dialog-list {
    flex: 1; overflow-y: auto; padding: 0 16px 8px;
    min-height: 200px; max-height: 50vh;
  }
  .move-dialog-list::-webkit-scrollbar { width: 5px; }
  .move-dialog-list::-webkit-scrollbar-track { background: transparent; }
  .move-dialog-list::-webkit-scrollbar-thumb { background: rgba(255,255,255,.12); border-radius: 4px; }

  .move-dialog-item {
    display: flex; align-items: center; gap: 10px;
    padding: 10px 12px; border-radius: 8px; cursor: pointer;
    transition: background .12s; user-select: none;
  }
  .move-dialog-item:hover { background: rgba(255,255,255,.06); }
  .move-dialog-item.selected { background: rgba(79,140,255,.12); }

  .move-dialog-item-icon {
    width: 36px; height: 36px; border-radius: 6px;
    background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
    display: flex; align-items: center; justify-content: center;
    flex-shrink: 0;
  }
  .move-dialog-item-icon svg { width: 20px; height: 20px; fill: #fff; }

  .move-dialog-item-name {
    flex: 1; font-size: 14px; color: #e0e0e4;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .move-dialog-item-arrow {
    color: rgba(255,255,255,.2); font-size: 16px; flex-shrink: 0;
    transition: color .12s;
  }
  .move-dialog-item:hover .move-dialog-item-arrow { color: rgba(255,255,255,.4); }

  /* Empty & Loading */
  .move-dialog-empty {
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    padding: 48px 20px; color: rgba(255,255,255,.3); font-size: 14px; gap: 8px;
  }
  .move-dialog-loading {
    display: flex; align-items: center; justify-content: center;
    padding: 48px 20px; color: rgba(255,255,255,.4); font-size: 14px; gap: 8px;
  }
  .move-dialog-spinner {
    width: 20px; height: 20px; border: 2px solid rgba(255,255,255,.15);
    border-top-color: #5fa0ff; border-radius: 50%;
    animation: mdSpin .7s linear infinite;
  }
  @keyframes mdSpin { to { transform: rotate(360deg) } }

  /* Footer */
  .move-dialog-footer {
    display: flex; align-items: center; justify-content: flex-end; gap: 10px;
    padding: 14px 24px 18px; border-top: 1px solid rgba(255,255,255,.06);
    flex-shrink: 0;
  }
  .move-dialog-btn {
    height: 38px; padding: 0 24px; border-radius: 8px; border: none;
    font-size: 14px; cursor: pointer; font-weight: 500;
    transition: all .15s; display: flex; align-items: center; gap: 6px;
  }
  .move-dialog-btn.cancel {
    background: rgba(255,255,255,.06); color: rgba(255,255,255,.7);
  }
  .move-dialog-btn.cancel:hover { background: rgba(255,255,255,.1); }
  .move-dialog-btn.primary {
    background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
    color: #fff; box-shadow: 0 2px 12px rgba(59,130,246,.3);
  }
  .move-dialog-btn.primary:hover {
    box-shadow: 0 4px 20px rgba(59,130,246,.45); transform: translateY(-1px);
  }
  .move-dialog-btn.primary:disabled {
    opacity: .4; cursor: not-allowed; transform: none;
    box-shadow: none;
  }

  /* New-folder inline row */
  .move-dialog-newfolder {
    display: flex; align-items: center; gap: 8px;
    padding: 8px 16px 12px; flex-shrink: 0;
  }
  .move-dialog-newfolder input {
    flex: 1; height: 36px; border-radius: 8px;
    border: 1px solid rgba(79,140,255,.4);
    background: rgba(79,140,255,.06);
    padding: 0 12px; color: #e8e8ec; font-size: 13px;
    outline: none;
  }
  .move-dialog-newfolder input:focus { border-color: rgba(79,140,255,.7); }

  /* Recent moves panel */
  .move-dialog-recent-header {
    padding: 8px 24px 4px; font-size: 12px; color: rgba(255,255,255,.3);
    text-transform: uppercase; letter-spacing: .5px;
  }
`

// ─── SVG Icons ───
const ICON_FOLDER = '<svg viewBox="0 0 24 24"><path d="M10 4H4a2 2 0 00-2 2v12a2 2 0 002 2h16a2 2 0 002-2V8a2 2 0 00-2-2h-8l-2-2z"/></svg>'
const ICON_FOLDER_PLUS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 4H4a2 2 0 00-2 2v12a2 2 0 002 2h16a2 2 0 002-2V8a2 2 0 00-2-2h-8l-2-2z"/><line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/></svg>'
const ICON_CLOCK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>'

// ─── API Helpers ───
async function apiFetchFolders(cid: string): Promise<{ folders: FolderItem[], path: BreadcrumbItem[] }> {
  const params = new URLSearchParams({
    aid: '1', cid, offset: '0', limit: '500',
    show_dir: '1', nf: '1', qid: '0', type: '0',
    source: '', format: 'json', star: '', is_q: '',
    is_share: '', o: 'file_name', asc: '1', cur: '1',
    natsort: '1',
  })
  const url = `https://webapi.115.com/files?${params}`

  const res = await sendRuntimeMessageSafe<{ ok: boolean, text: string }>({
    type: 'MAIN_WORLD_GET',
    data: { url },
  })

  if (!res?.ok || !res.text) return { folders: [], path: [] }

  try {
    const json = JSON.parse(res.text)
    if (!json.state) return { folders: [], path: [] }

    // nf=1 已让 API 只返回文件夹，只需检查 cid 存在且排除文件（有 sha 的是文件）
    const folders: FolderItem[] = (json.data ?? [])
      .filter((item: any) => item.cid !== undefined && !item.sha)
      .map((item: any) => ({
        cid: String(item.cid),
        name: item.n || '',
        pid: String(item.pid || item.parent_id || cid),
      }))

    const path: BreadcrumbItem[] = (json.path ?? []).map((p: any) => ({
      cid: String(p.cid),
      name: p.name,
    }))

    return { folders, path }
  } catch {
    return { folders: [], path: [] }
  }
}

async function apiCreateFolder(parentCid: string, name: string): Promise<{ ok: boolean, cid?: string, error?: string }> {
  const body = `pid=${encodeURIComponent(parentCid)}&cname=${encodeURIComponent(name)}`
  const res = await sendRuntimeMessageSafe<{ ok: boolean, text: string }>({
    type: 'MAIN_WORLD_FETCH',
    data: { url: 'https://webapi.115.com/files/add', body },
  })

  if (!res?.ok || !res.text) return { ok: false, error: '网络请求失败' }

  try {
    const json = JSON.parse(res.text)
    if (json.state) {
      return { ok: true, cid: String(json.cid || json.file_id || '') }
    }
    return { ok: false, error: json.error || '创建失败' }
  } catch {
    return { ok: false, error: '解析返回数据失败' }
  }
}

async function apiMoveFile(fileId: string, targetCid: string): Promise<{ ok: boolean, error?: string }> {
  const body = `pid=${encodeURIComponent(targetCid)}&fid[0]=${encodeURIComponent(fileId)}&move_proid=`
  const res = await sendRuntimeMessageSafe<{ ok: boolean, text: string }>({
    type: 'MAIN_WORLD_FETCH',
    data: { url: 'https://webapi.115.com/files/move', body },
  })

  if (!res?.ok || !res.text) return { ok: false, error: '网络请求失败' }

  try {
    const json = JSON.parse(res.text)
    if (json.state) return { ok: true }
    return { ok: false, error: json.error || json.error_msg || '移动失败' }
  } catch {
    return { ok: false, error: '解析返回数据失败' }
  }
}

async function apiSearchFolders(keyword: string): Promise<FolderItem[]> {
  const params = new URLSearchParams({
    aid: '1', offset: '0', limit: '50',
    search_value: keyword, format: 'json',
    fc: '1',  // folders only
  })
  const url = `https://webapi.115.com/files/search?${params}`

  const res = await sendRuntimeMessageSafe<{ ok: boolean, text: string }>({
    type: 'MAIN_WORLD_GET',
    data: { url },
  })

  if (!res?.ok || !res.text) return []

  try {
    const json = JSON.parse(res.text)
    if (!json.state) return []
    return (json.data ?? []).map((item: any) => ({
      cid: String(item.cid),
      name: item.n || '',
      pid: String(item.pid || ''),
    }))
  } catch {
    return []
  }
}

// ─── Recent Moves Storage ───
function getRecentMoves(): RecentMoveRecord[] {
  try {
    const raw = localStorage.getItem(RECENT_MOVES_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function saveRecentMove(record: Omit<RecentMoveRecord, 'timestamp'>) {
  const recent = getRecentMoves().filter(r => r.cid !== record.cid)
  recent.unshift({ ...record, timestamp: Date.now() })
  if (recent.length > MAX_RECENT) recent.length = MAX_RECENT
  localStorage.setItem(RECENT_MOVES_KEY, JSON.stringify(recent))
}

// ─── Dialog Class ───
export class MoveDialog {
  private mask!: HTMLDivElement
  private listEl!: HTMLDivElement
  private crumbsEl!: HTMLDivElement
  private searchInput!: HTMLInputElement
  private moveBtn!: HTMLButtonElement
  private newFolderRow!: HTMLDivElement
  private styleEl!: HTMLStyleElement

  private currentCid = '0'
  private selectedCid: string | null = null
  private breadcrumbs: BreadcrumbItem[] = [{ cid: '0', name: '根目录' }]
  private folders: FolderItem[] = []
  private isSearchMode = false
  private isRecentMode = false
  private isNewFolderVisible = false

  private resolvePromise!: (moved: boolean) => void

  constructor(
    private fileId: string,
    private initialCid: string,
    private onMoved: () => void,
  ) {}

  show(): Promise<boolean> {
    return new Promise((resolve) => {
      this.resolvePromise = resolve
      this.injectStyles()
      this.buildDOM()
      this.loadFolder(this.initialCid || '0')
    })
  }

  private injectStyles() {
    this.styleEl = document.createElement('style')
    this.styleEl.textContent = DIALOG_STYLES
    document.head.appendChild(this.styleEl)
  }

  private buildDOM() {
    // ── Mask ──
    this.mask = document.createElement('div')
    this.mask.className = 'move-dialog-mask'
    this.mask.addEventListener('click', (e) => {
      if (e.target === this.mask) this.close(false)
    })

    // ── Dialog Box ──
    const box = document.createElement('div')
    box.className = 'move-dialog-box'
    box.addEventListener('click', (e) => e.stopPropagation())

    // ── Header ──
    const header = document.createElement('div')
    header.className = 'move-dialog-header'
    header.innerHTML = `<h3>移动到</h3>`
    const closeBtn = document.createElement('button')
    closeBtn.className = 'move-dialog-close'
    closeBtn.innerHTML = '✕'
    closeBtn.addEventListener('click', () => this.close(false))
    header.appendChild(closeBtn)

    // ── Toolbar ──
    const toolbar = document.createElement('div')
    toolbar.className = 'move-dialog-toolbar'

    this.searchInput = document.createElement('input')
    this.searchInput.className = 'move-dialog-search'
    this.searchInput.type = 'text'
    this.searchInput.placeholder = '搜索文件夹...'
    let searchTimer: ReturnType<typeof setTimeout>
    this.searchInput.addEventListener('input', () => {
      clearTimeout(searchTimer)
      searchTimer = setTimeout(() => this.onSearch(), 400)
    })
    this.searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.searchInput.value = ''
        this.exitSearchMode()
      }
    })

    const newFolderBtn = document.createElement('button')
    newFolderBtn.className = 'move-dialog-tbtn'
    newFolderBtn.innerHTML = `${ICON_FOLDER_PLUS}<span>新建文件夹</span>`
    newFolderBtn.addEventListener('click', () => this.toggleNewFolder())

    const recentBtn = document.createElement('button')
    recentBtn.className = 'move-dialog-tbtn'
    recentBtn.innerHTML = `${ICON_CLOCK}<span>最近</span>`
    recentBtn.addEventListener('click', () => this.showRecent())

    toolbar.append(this.searchInput, newFolderBtn, recentBtn)

    // ── New Folder Row (hidden by default) ──
    this.newFolderRow = document.createElement('div')
    this.newFolderRow.className = 'move-dialog-newfolder'
    this.newFolderRow.style.display = 'none'
    const nfInput = document.createElement('input')
    nfInput.placeholder = '输入新文件夹名称'
    nfInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.createFolder(nfInput.value.trim())
      if (e.key === 'Escape') this.toggleNewFolder()
    })
    const nfConfirm = document.createElement('button')
    nfConfirm.className = 'move-dialog-btn primary'
    nfConfirm.textContent = '创建'
    nfConfirm.style.cssText = 'height:36px;padding:0 16px;font-size:13px;'
    nfConfirm.addEventListener('click', () => this.createFolder(nfInput.value.trim()))
    const nfCancel = document.createElement('button')
    nfCancel.className = 'move-dialog-btn cancel'
    nfCancel.textContent = '取消'
    nfCancel.style.cssText = 'height:36px;padding:0 12px;font-size:13px;'
    nfCancel.addEventListener('click', () => this.toggleNewFolder())
    this.newFolderRow.append(nfInput, nfConfirm, nfCancel)

    // ── Breadcrumbs ──
    this.crumbsEl = document.createElement('div')
    this.crumbsEl.className = 'move-dialog-crumbs'

    // ── Folder List ──
    this.listEl = document.createElement('div')
    this.listEl.className = 'move-dialog-list'

    // ── Footer ──
    const footer = document.createElement('div')
    footer.className = 'move-dialog-footer'
    const cancelBtn = document.createElement('button')
    cancelBtn.className = 'move-dialog-btn cancel'
    cancelBtn.textContent = '取消'
    cancelBtn.addEventListener('click', () => this.close(false))

    this.moveBtn = document.createElement('button')
    this.moveBtn.className = 'move-dialog-btn primary'
    this.moveBtn.textContent = '移动到这里'
    this.moveBtn.addEventListener('click', () => this.doMove())

    footer.append(cancelBtn, this.moveBtn)

    // ── Assemble ──
    box.append(header, toolbar, this.newFolderRow, this.crumbsEl, this.listEl, footer)
    this.mask.appendChild(box)
    document.body.appendChild(this.mask)

    // Focus search
    setTimeout(() => this.searchInput.focus(), 100)
  }

  // ─── Loading & Rendering ───

  private showLoading() {
    this.listEl.innerHTML = `<div class="move-dialog-loading"><div class="move-dialog-spinner"></div>加载中...</div>`
  }

  private async loadFolder(cid: string) {
    this.isSearchMode = false
    this.isRecentMode = false
    this.currentCid = cid
    this.selectedCid = null
    this.showLoading()

    const { folders, path } = await apiFetchFolders(cid)
    this.folders = folders
    if (path.length > 0) {
      this.breadcrumbs = path
    }
    this.renderBreadcrumbs()
    this.renderFolders()
  }

  private renderBreadcrumbs() {
    this.crumbsEl.innerHTML = ''
    if (this.isSearchMode) {
      const tag = document.createElement('span')
      tag.className = 'move-dialog-crumb current'
      tag.textContent = '🔍 搜索结果'
      this.crumbsEl.appendChild(tag)

      const backBtn = document.createElement('button')
      backBtn.className = 'move-dialog-crumb'
      backBtn.textContent = '← 返回'
      backBtn.style.marginLeft = '8px'
      backBtn.addEventListener('click', () => this.exitSearchMode())
      this.crumbsEl.appendChild(backBtn)
      return
    }
    if (this.isRecentMode) {
      const tag = document.createElement('span')
      tag.className = 'move-dialog-crumb current'
      tag.textContent = '🕐 最近移动'
      this.crumbsEl.appendChild(tag)

      const backBtn = document.createElement('button')
      backBtn.className = 'move-dialog-crumb'
      backBtn.textContent = '← 返回'
      backBtn.style.marginLeft = '8px'
      backBtn.addEventListener('click', () => this.exitSearchMode())
      this.crumbsEl.appendChild(backBtn)
      return
    }

    this.breadcrumbs.forEach((bc, i) => {
      if (i > 0) {
        const sep = document.createElement('span')
        sep.className = 'move-dialog-crumb-sep'
        sep.textContent = '›'
        this.crumbsEl.appendChild(sep)
      }
      const btn = document.createElement('button')
      btn.className = 'move-dialog-crumb'
      if (i === this.breadcrumbs.length - 1) btn.classList.add('current')
      btn.textContent = bc.name
      btn.addEventListener('click', () => {
        if (i < this.breadcrumbs.length - 1) this.loadFolder(bc.cid)
      })
      this.crumbsEl.appendChild(btn)
    })
  }

  private renderFolders() {
    this.listEl.innerHTML = ''
    if (this.folders.length === 0) {
      this.listEl.innerHTML = `<div class="move-dialog-empty"><span style="font-size:32px">📂</span><span>当前目录下没有文件夹</span></div>`
      return
    }

    for (const folder of this.folders) {
      const row = document.createElement('div')
      row.className = 'move-dialog-item'
      row.innerHTML = `
        <div class="move-dialog-item-icon">${ICON_FOLDER}</div>
        <div class="move-dialog-item-name">${this.escapeHtml(folder.name)}</div>
        <div class="move-dialog-item-arrow">›</div>
      `

      // Single click = select, double click = enter
      row.addEventListener('click', (e) => {
        e.stopPropagation()
        this.selectFolder(folder.cid, row)
      })
      row.addEventListener('dblclick', (e) => {
        e.stopPropagation()
        this.loadFolder(folder.cid)
      })

      this.listEl.appendChild(row)
    }
  }

  private selectFolder(cid: string, el: HTMLDivElement) {
    // Deselect all
    this.listEl.querySelectorAll('.move-dialog-item.selected').forEach(item => {
      item.classList.remove('selected')
    })
    el.classList.add('selected')
    this.selectedCid = cid
  }

  // ─── Actions ───

  private async onSearch() {
    const keyword = this.searchInput.value.trim()
    if (!keyword) {
      this.exitSearchMode()
      return
    }

    this.isSearchMode = true
    this.isRecentMode = false
    this.selectedCid = null
    this.showLoading()

    const folders = await apiSearchFolders(keyword)
    this.folders = folders
    this.renderBreadcrumbs()
    this.renderFolders()

    if (folders.length === 0) {
      this.listEl.innerHTML = `<div class="move-dialog-empty"><span style="font-size:32px">🔍</span><span>没有找到匹配的文件夹</span></div>`
    }
  }

  private exitSearchMode() {
    this.searchInput.value = ''
    this.isSearchMode = false
    this.isRecentMode = false
    this.loadFolder(this.currentCid)
  }

  private showRecent() {
    this.isRecentMode = true
    this.isSearchMode = false
    this.selectedCid = null

    const recent = getRecentMoves()
    this.renderBreadcrumbs()

    this.listEl.innerHTML = ''
    if (recent.length === 0) {
      this.listEl.innerHTML = `<div class="move-dialog-empty"><span style="font-size:32px">🕐</span><span>暂无最近移动记录</span></div>`
      return
    }

    const header = document.createElement('div')
    header.className = 'move-dialog-recent-header'
    header.textContent = '最近移动到'
    this.listEl.appendChild(header)

    for (const record of recent) {
      const row = document.createElement('div')
      row.className = 'move-dialog-item'
      row.innerHTML = `
        <div class="move-dialog-item-icon">${ICON_FOLDER}</div>
        <div style="flex:1;overflow:hidden;">
          <div class="move-dialog-item-name">${this.escapeHtml(record.name)}</div>
          <div style="font-size:11px;color:rgba(255,255,255,.25);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${this.escapeHtml(record.path)}</div>
        </div>
        <div class="move-dialog-item-arrow">›</div>
      `
      row.addEventListener('click', (e) => {
        e.stopPropagation()
        this.selectFolder(record.cid, row)
      })
      row.addEventListener('dblclick', (e) => {
        e.stopPropagation()
        this.loadFolder(record.cid)
      })
      this.listEl.appendChild(row)
    }
  }

  private toggleNewFolder() {
    this.isNewFolderVisible = !this.isNewFolderVisible
    this.newFolderRow.style.display = this.isNewFolderVisible ? 'flex' : 'none'
    if (this.isNewFolderVisible) {
      const input = this.newFolderRow.querySelector('input') as HTMLInputElement
      input.value = ''
      setTimeout(() => input.focus(), 50)
    }
  }

  private async createFolder(name: string) {
    if (!name) return

    const parentCid = this.selectedCid || this.currentCid
    const confirmBtn = this.newFolderRow.querySelector('.primary') as HTMLButtonElement
    confirmBtn.textContent = '创建中...'
    confirmBtn.disabled = true

    const result = await apiCreateFolder(parentCid, name)
    confirmBtn.textContent = '创建'
    confirmBtn.disabled = false

    if (result.ok) {
      this.toggleNewFolder()
      // If parent is current browsing dir, reload to show new folder
      if (parentCid === this.currentCid) {
        await this.loadFolder(this.currentCid)
      }
      // Auto-select newly created folder
      if (result.cid) {
        this.selectedCid = result.cid
        const items = this.listEl.querySelectorAll('.move-dialog-item')
        items.forEach(item => {
          const nameEl = item.querySelector('.move-dialog-item-name')
          if (nameEl?.textContent === name) {
            item.classList.add('selected')
          }
        })
      }
    } else {
      this.showInlineError(result.error || '创建失败')
    }
  }

  private async doMove() {
    // Target = selected folder, or current browsing folder
    const targetCid = this.selectedCid || this.currentCid

    if (!targetCid || targetCid === '0') {
      // 不建议移动到根目录，但允许
    }

    this.moveBtn.textContent = '移动中...'
    this.moveBtn.disabled = true

    const result = await apiMoveFile(this.fileId, targetCid)

    if (result.ok) {
      // Save to recent
      const targetName = this.getTargetName(targetCid)
      const pathStr = this.breadcrumbs.map(b => b.name).join(' > ')
      saveRecentMove({ cid: targetCid, name: targetName, path: pathStr })

      // Notify background to refresh 115 wangpan tabs
      sendRuntimeMessageSafe({ type: 'MOVE_SUCCESS_REFRESH' }).catch(() => {})

      this.close(true)
      this.onMoved()
    } else {
      this.moveBtn.textContent = '移动到这里'
      this.moveBtn.disabled = false
      this.showInlineError(result.error || '移动失败')
    }
  }

  private getTargetName(cid: string): string {
    // Check if it's one of the displayed folders
    const folder = this.folders.find(f => f.cid === cid)
    if (folder) return folder.name
    // Check breadcrumbs
    const crumb = this.breadcrumbs.find(b => b.cid === cid)
    if (crumb) return crumb.name
    return '未知文件夹'
  }

  private showInlineError(msg: string) {
    // Show a temporary toast within the dialog
    const toast = document.createElement('div')
    toast.style.cssText = `
      position: absolute; bottom: 70px; left: 50%; transform: translateX(-50%);
      background: #e74c3c; color: #fff; padding: 8px 20px; border-radius: 8px;
      font-size: 13px; box-shadow: 0 4px 16px rgba(231,76,60,.4);
      animation: mdFadeIn .2s ease; z-index: 10;
    `
    toast.textContent = msg
    this.mask.querySelector('.move-dialog-box')!.appendChild(toast)
    setTimeout(() => toast.remove(), 3000)
  }

  private close(moved: boolean) {
    this.mask.style.opacity = '0'
    this.mask.style.transition = 'opacity .15s'
    setTimeout(() => {
      this.mask.remove()
      this.styleEl.remove()
    }, 150)
    this.resolvePromise(moved)
  }

  private escapeHtml(str: string): string {
    return escapeHtml(str)
  }
}
