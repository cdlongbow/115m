import { sendRuntimeMessageSafe } from './runtime'

interface MediaWallFolderItem {
  id: string
  title: string
  coverUrl: string
  sourceItem: HTMLElement
  isStarred: boolean
  hasRemark: boolean
  starAction: HTMLElement | null
  remarkAction: HTMLElement | null
  open: () => void
}

interface MediaWallImageItem {
  id: string
  title: string
  thumbUrl: string
  originalUrl: string
  fileId: string
  parentId: string
  pickCode: string
  sourceItem: HTMLElement
}

interface MediaWallState {
  listEl: HTMLElement | null
  signature: string
}

interface LightboxController {
  open: (items: MediaWallImageItem[], startIndex: number) => void
}

const stateByDoc = new WeakMap<Document, MediaWallState>()
const refreshTimersByDoc = new WeakMap<Document, number[]>()
const lightboxByDoc = new WeakMap<Document, LightboxController>()

const HIDDEN_CLASS = 'm115-wall-hidden-item'
const WALL_ID = 'm115-media-wall'
const WHEEL_MODE_KEY = 'm115_image_viewer_wheel_mode'

function readAttr(item: HTMLElement, names: string[]): string {
  for (const name of names) {
    const value = item.getAttribute(name)
    if (value) return value
  }
  return ''
}

function isImageExtension(name: string): boolean {
  const ext = name.split('.').pop()?.toLowerCase()
  if (!ext) return false
  return ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'ico', 'svg', 'tif', 'tiff', 'avif', 'heic', 'heif'].includes(ext)
}

function toOriginalImageUrl(url: string): string {
  return url.replace(/_\d+(\?|$)/, '_0$1')
}

function getWheelMode(doc: Document): 'zoom' | 'switch' {
  try {
    const value = doc.defaultView?.localStorage?.getItem(WHEEL_MODE_KEY)
    return value === 'switch' ? 'switch' : 'zoom'
  }
  catch {
    return 'zoom'
  }
}

function setWheelMode(doc: Document, value: 'zoom' | 'switch') {
  try {
    doc.defaultView?.localStorage?.setItem(WHEEL_MODE_KEY, value)
  }
  catch {
    // ignore storage failures
  }
}

function createToast(doc: Document, message: string) {
  const toast = doc.createElement('div')
  toast.className = 'm115-viewer-toast'
  toast.textContent = message
  doc.body.appendChild(toast)
  window.setTimeout(() => toast.remove(), 1600)
}

function preloadImage(url: string) {
  if (!url) return
  const img = new Image()
  img.src = url
}

function scheduleMediaWallRefresh(doc: Document) {
  const previous = refreshTimersByDoc.get(doc) || []
  previous.forEach(timer => window.clearTimeout(timer))
  const timers = [0, 180, 520].map(delay => window.setTimeout(() => renderMediaWall(doc), delay))
  refreshTimersByDoc.set(doc, timers)
}

function openNativeFolder(sourceItem: HTMLElement) {
  const anchor = (sourceItem.querySelector('.file-name .name,[menu="open"],[rel="view_folder"]') as HTMLElement | null) || sourceItem
  sourceItem.classList.remove(HIDDEN_CLASS)

  const previousStyle = sourceItem.getAttribute('style') || ''
  sourceItem.style.setProperty('position', 'fixed', 'important')
  sourceItem.style.setProperty('left', '-9999px', 'important')
  sourceItem.style.setProperty('top', '0', 'important')
  sourceItem.style.setProperty('width', '1px', 'important')
  sourceItem.style.setProperty('height', '1px', 'important')
  sourceItem.style.setProperty('overflow', 'hidden', 'important')
  sourceItem.style.setProperty('opacity', '0', 'important')
  sourceItem.style.setProperty('pointer-events', 'none', 'important')

  const init: MouseEventInit = {
    bubbles: true,
    cancelable: true,
    view: window,
    button: 0,
    buttons: 1,
  }

  anchor.dispatchEvent(new MouseEvent('mousedown', init))
  anchor.dispatchEvent(new MouseEvent('mouseup', init))
  anchor.dispatchEvent(new MouseEvent('click', init))

  window.setTimeout(() => {
    if (previousStyle) sourceItem.setAttribute('style', previousStyle)
    else sourceItem.removeAttribute('style')
    sourceItem.classList.add(HIDDEN_CLASS)
  }, 0)
}

function buildFolderItem(item: HTMLElement): MediaWallFolderItem | null {
  if (item.getAttribute('file_type') !== '0') return null

  const title = item.getAttribute('title') || item.querySelector('.file-name .name')?.textContent?.trim() || '文件夹'
  const coverUrl = item.getAttribute('img_url') || ''
  if (!coverUrl) return null

  const link = item.querySelector('.file-name .name,[rel="view_folder"]') as HTMLElement | null
  const starAction = item.querySelector('.icon-star,[menu="star"],.tpstar,.tpstar-disabled') as HTMLElement | null
  const remarkAction = item.querySelector('.icon-remarks,[menu="remark"],.file-remark,.remarks') as HTMLElement | null

  return {
    id: item.getAttribute('cate_id') || title,
    title,
    coverUrl,
    sourceItem: item,
    isStarred: starAction?.getAttribute('is_star') === '1',
    hasRemark: !!remarkAction && getComputedStyle(remarkAction).display !== 'none',
    starAction,
    remarkAction,
    open: () => openNativeFolder(item),
  }
}

function buildImageItem(item: HTMLElement): MediaWallImageItem | null {
  if (item.getAttribute('file_type') !== '1') return null
  if (item.getAttribute('iv') === '1') return null

  const title = item.getAttribute('title') || item.querySelector('.file-name .name')?.textContent?.trim() || '图片'
  const thumbUrl = item.getAttribute('path') || item.querySelector('img')?.getAttribute('src') || ''
  if (!thumbUrl || !isImageExtension(title)) return null

  return {
    id: readAttr(item, ['file_id', 'fid', 'fileid', 'pick_code']) || title,
    title,
    thumbUrl,
    originalUrl: toOriginalImageUrl(thumbUrl),
    fileId: readAttr(item, ['file_id', 'fid', 'fileid']),
    parentId: readAttr(item, ['p_id', 'pid', 'parent_id', 'cid']) || new URLSearchParams(location.search).get('cid') || '0',
    pickCode: readAttr(item, ['pick_code', 'pickcode']),
    sourceItem: item,
  }
}

function getFolderStateSignature(item: HTMLElement): string {
  const starAction = item.querySelector('.icon-star,[menu="star"],.tpstar,.tpstar-disabled') as HTMLElement | null
  const remarkAction = item.querySelector('.icon-remarks,[menu="remark"],.file-remark,.remarks') as HTMLElement | null
  return [
    item.getAttribute('title') || '',
    item.getAttribute('img_url') || '',
    starAction?.getAttribute('is_star') || '',
    remarkAction ? getComputedStyle(remarkAction).display : 'none',
    item.getAttribute('has_desc') || '',
  ].join(':')
}

function getImageStateSignature(item: HTMLElement): string {
  return [
    item.getAttribute('title') || '',
    item.getAttribute('path') || item.querySelector('img')?.getAttribute('src') || '',
  ].join(':')
}

function buildSignature(list: HTMLElement, folders: MediaWallFolderItem[], images: MediaWallImageItem[]) {
  const itemStates = Array.from(list.querySelectorAll<HTMLElement>('li[rel="item"]')).map((item) => {
    const key = readAttr(item, ['file_id', 'cate_id', 'pick_code']) || item.getAttribute('title') || ''
    if (item.getAttribute('file_type') === '0') return `${key}:${getFolderStateSignature(item)}`
    if (item.getAttribute('file_type') === '1') return `${key}:${getImageStateSignature(item)}`
    return `${item.getAttribute('file_type') || ''}:${key}`
  })
  return `${folders.map(item => item.id).join(',')}|${images.map(item => item.id).join(',')}|${itemStates.join(',')}`
}

function clearWall(list: HTMLElement) {
  list.querySelector(`#${WALL_ID}`)?.remove()
  list.querySelectorAll<HTMLElement>(`.${HIDDEN_CLASS}`).forEach((item) => item.classList.remove(HIDDEN_CLASS))
}

function forwardNativeContextMenu(sourceItem: HTMLElement, event: MouseEvent) {
  const anchor = (sourceItem.querySelector('.file-name .name,[menu="open"],[rel="view_folder"],.file-thumb img,.photo-icon img') as HTMLElement | null) || sourceItem
  sourceItem.classList.remove(HIDDEN_CLASS)

  const previousStyle = sourceItem.getAttribute('style') || ''
  sourceItem.style.setProperty('position', 'fixed', 'important')
  sourceItem.style.setProperty('left', `${event.clientX}px`, 'important')
  sourceItem.style.setProperty('top', `${event.clientY}px`, 'important')
  sourceItem.style.setProperty('width', '1px', 'important')
  sourceItem.style.setProperty('height', '1px', 'important')
  sourceItem.style.setProperty('overflow', 'hidden', 'important')
  sourceItem.style.setProperty('opacity', '0', 'important')
  sourceItem.style.setProperty('pointer-events', 'none', 'important')

  const init: MouseEventInit = {
    bubbles: true,
    cancelable: true,
    view: window,
    button: 2,
    buttons: 2,
    clientX: event.clientX,
    clientY: event.clientY,
    screenX: event.screenX,
    screenY: event.screenY,
  }

  anchor.dispatchEvent(new MouseEvent('mousedown', init))
  anchor.dispatchEvent(new MouseEvent('mouseup', init))
  anchor.dispatchEvent(new MouseEvent('contextmenu', init))

  window.setTimeout(() => {
    if (previousStyle) sourceItem.setAttribute('style', previousStyle)
    else sourceItem.removeAttribute('style')
    sourceItem.classList.add(HIDDEN_CLASS)
  }, 0)
}

function createLightboxController(doc: Document): LightboxController {
  const overlay = doc.createElement('div')
  overlay.className = 'm115-viewer'

  const toolbar = doc.createElement('div')
  toolbar.className = 'm115-viewer-toolbar'

  const titleEl = doc.createElement('div')
  titleEl.className = 'm115-viewer-title'

  const toolbarActions = doc.createElement('div')
  toolbarActions.className = 'm115-viewer-actions'

  const wheelBtn = doc.createElement('button')
  wheelBtn.type = 'button'
  wheelBtn.className = 'm115-viewer-tool-btn'

  const deleteBtn = doc.createElement('button')
  deleteBtn.type = 'button'
  deleteBtn.className = 'm115-viewer-tool-btn'
  deleteBtn.textContent = '删除'

  const closeBtn = doc.createElement('button')
  closeBtn.type = 'button'
  closeBtn.className = 'm115-viewer-tool-btn'
  closeBtn.textContent = '关闭'

  toolbarActions.appendChild(wheelBtn)
  toolbarActions.appendChild(deleteBtn)
  toolbarActions.appendChild(closeBtn)
  toolbar.appendChild(titleEl)
  toolbar.appendChild(toolbarActions)

  const stage = doc.createElement('div')
  stage.className = 'm115-viewer-stage'

  const prevBtn = doc.createElement('button')
  prevBtn.type = 'button'
  prevBtn.className = 'm115-viewer-nav m115-viewer-prev'
  prevBtn.textContent = '<'

  const nextBtn = doc.createElement('button')
  nextBtn.type = 'button'
  nextBtn.className = 'm115-viewer-nav m115-viewer-next'
  nextBtn.textContent = '>'

  const mediaFrame = doc.createElement('div')
  mediaFrame.className = 'm115-viewer-frame'

  const imageEl = doc.createElement('img')
  imageEl.className = 'm115-viewer-image'

  mediaFrame.appendChild(imageEl)
  stage.appendChild(prevBtn)
  stage.appendChild(mediaFrame)
  stage.appendChild(nextBtn)

  const thumbs = doc.createElement('div')
  thumbs.className = 'm115-viewer-thumbs'

  overlay.appendChild(toolbar)
  overlay.appendChild(stage)
  overlay.appendChild(thumbs)
  doc.body.appendChild(overlay)

  let items: MediaWallImageItem[] = []
  let currentIndex = 0
  let wheelMode = getWheelMode(doc)
  let zoomScale = 1
  let wheelLock = false

  const updateWheelButton = () => {
    wheelBtn.textContent = wheelMode === 'zoom' ? '滚轮: 缩放' : '滚轮: 切图'
  }

  const applyZoom = () => {
    imageEl.style.transform = `translate(-50%, -50%) scale(${zoomScale})`
  }

  const preloadNeighbors = () => {
    ;[-2, -1, 1, 2].forEach((offset) => {
      const item = items[currentIndex + offset]
      if (item) preloadImage(item.originalUrl)
    })
  }

  const syncThumbs = () => {
    thumbs.innerHTML = ''
    items.forEach((item, index) => {
      const btn = doc.createElement('button')
      btn.type = 'button'
      btn.className = `m115-viewer-thumb ${index === currentIndex ? 'is-active' : ''}`
      const img = doc.createElement('img')
      img.src = item.thumbUrl
      img.alt = item.title
      img.loading = 'lazy'
      btn.appendChild(img)
      btn.addEventListener('click', () => {
        currentIndex = index
        render()
      })
      thumbs.appendChild(btn)
    })
  }

  const render = () => {
    const current = items[currentIndex]
    if (!current) return
    titleEl.textContent = current.title
    imageEl.src = current.originalUrl
    imageEl.alt = current.title
    zoomScale = 1
    applyZoom()
    syncThumbs()
    preloadNeighbors()
  }

  const close = () => {
    overlay.classList.remove('active')
    imageEl.src = ''
  }

  const move = (step: number) => {
    if (items.length <= 1) return
    currentIndex = (currentIndex + step + items.length) % items.length
    render()
  }

  const deleteCurrent = async () => {
    const current = items[currentIndex]
    if (!current) return
    if (!current.fileId || !current.parentId || !current.pickCode) {
      createToast(doc, '当前图片缺少删除信息')
      return
    }

    const result = await sendRuntimeMessageSafe<{ ok?: boolean, error?: string }>({
      type: 'DELETE_FILE',
      data: { fileId: current.fileId, parentId: current.parentId, pickCode: current.pickCode },
    })

    if (!result?.ok) {
      createToast(doc, result?.error || '删除失败')
      return
    }

    current.sourceItem.remove()
    items.splice(currentIndex, 1)
    if (items.length === 0) {
      close()
    }
    else {
      currentIndex = Math.min(currentIndex, items.length - 1)
      render()
    }
    scheduleMediaWallRefresh(doc)
    createToast(doc, '已删除')
  }

  wheelBtn.addEventListener('click', () => {
    wheelMode = wheelMode === 'zoom' ? 'switch' : 'zoom'
    setWheelMode(doc, wheelMode)
    updateWheelButton()
    createToast(doc, wheelMode === 'zoom' ? '滚轮模式：缩放' : '滚轮模式：切图')
  })

  deleteBtn.addEventListener('click', () => {
    void deleteCurrent()
  })

  closeBtn.addEventListener('click', close)
  prevBtn.addEventListener('click', (event) => {
    event.stopPropagation()
    move(-1)
  })
  nextBtn.addEventListener('click', (event) => {
    event.stopPropagation()
    move(1)
  })

  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) close()
  })

  overlay.addEventListener('wheel', (event) => {
    event.preventDefault()
    if (wheelMode === 'switch') {
      if (wheelLock) return
      wheelLock = true
      window.setTimeout(() => { wheelLock = false }, 140)
      move(event.deltaY > 0 ? 1 : -1)
      return
    }
    const next = Math.max(1, Math.min(4, zoomScale + (event.deltaY < 0 ? 0.18 : -0.18)))
    zoomScale = next
    applyZoom()
  }, { passive: false })

  doc.addEventListener('keydown', (event) => {
    if (!overlay.classList.contains('active')) return
    if (event.key === 'Escape') close()
    if (event.key === 'ArrowLeft') move(-1)
    if (event.key === 'ArrowRight') move(1)
  })

  updateWheelButton()

  return {
    open(nextItems: MediaWallImageItem[], startIndex: number) {
      if (!nextItems.length) return
      items = [...nextItems]
      currentIndex = Math.max(0, Math.min(startIndex, items.length - 1))
      overlay.classList.add('active')
      wheelMode = getWheelMode(doc)
      updateWheelButton()
      render()
    },
  }
}

function getLightboxController(doc: Document): LightboxController {
  const existing = lightboxByDoc.get(doc)
  if (existing) return existing
  const created = createLightboxController(doc)
  lightboxByDoc.set(doc, created)
  return created
}

function renderFoldersSection(doc: Document, folders: MediaWallFolderItem[]) {
  const section = doc.createElement('section')
  section.className = 'm115-wall-section'

  const title = doc.createElement('div')
  title.className = 'm115-wall-title'
  title.textContent = '文件夹'
  section.appendChild(title)

  const grid = doc.createElement('div')
  grid.className = 'm115-folder-grid'
  folders.forEach((folder) => {
    const button = doc.createElement('button')
    button.type = 'button'
    button.className = 'm115-folder-card'
    button.title = folder.title

    const tab = doc.createElement('span')
    tab.className = 'm115-folder-tab'

    const body = doc.createElement('span')
    body.className = 'm115-folder-body'

    const coverWrap = doc.createElement('span')
    coverWrap.className = 'm115-folder-cover-wrap'
    coverWrap.style.setProperty('--m115-folder-cover-url', `url("${folder.coverUrl}")`)

    const cover = doc.createElement('img')
    cover.className = 'm115-folder-cover'
    cover.src = folder.coverUrl
    cover.alt = folder.title
    cover.loading = 'lazy'
    coverWrap.appendChild(cover)

    const footer = doc.createElement('span')
    footer.className = 'm115-folder-footer'

    const name = doc.createElement('span')
    name.className = 'm115-folder-name'
    name.textContent = folder.title

    footer.appendChild(name)

    const actions = doc.createElement('span')
    actions.className = 'm115-folder-actions'

    const starBtn = doc.createElement('button')
    starBtn.type = 'button'
    starBtn.className = `m115-folder-action-btn ${folder.isStarred ? 'is-active' : ''}`
    starBtn.dataset.role = 'star'
    starBtn.title = folder.isStarred ? '取消星标' : '星标'
    starBtn.setAttribute('aria-label', folder.isStarred ? '取消星标' : '星标')
    const starIcon = doc.createElement('span')
    starIcon.className = 'm115-folder-icon'
    starIcon.setAttribute('aria-hidden', 'true')
    starIcon.innerHTML = '<svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg"><path d="M8 2.2L9.68 5.6L13.43 6.14L10.72 8.77L11.36 12.5L8 10.73L4.64 12.5L5.28 8.77L2.57 6.14L6.32 5.6L8 2.2Z" stroke="currentColor" stroke-width="1.25" stroke-linejoin="round"/></svg>'
    starBtn.appendChild(starIcon)
    starBtn.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      const nextActive = !starBtn.classList.contains('is-active')
      starBtn.classList.toggle('is-active', nextActive)
      starBtn.title = nextActive ? '取消星标' : '星标'
      starBtn.setAttribute('aria-label', nextActive ? '取消星标' : '星标')
      folder.starAction?.click()
      scheduleMediaWallRefresh(doc)
    })
    actions.appendChild(starBtn)

    if (folder.hasRemark) {
      const remarkBtn = doc.createElement('button')
      remarkBtn.type = 'button'
      remarkBtn.className = 'm115-folder-action-btn m115-folder-remark-badge'
      remarkBtn.dataset.role = 'remark'
      remarkBtn.title = '备注'
      remarkBtn.setAttribute('aria-label', '备注')
      remarkBtn.textContent = '备注'
      remarkBtn.addEventListener('click', (event) => {
        event.preventDefault()
        event.stopPropagation()
        folder.remarkAction?.click()
        scheduleMediaWallRefresh(doc)
      })
      actions.appendChild(remarkBtn)
    }

    body.appendChild(coverWrap)
    body.appendChild(footer)
    button.appendChild(tab)
    button.appendChild(body)
    button.appendChild(actions)
    button.addEventListener('click', () => folder.open())
    button.addEventListener('contextmenu', (event) => {
      event.preventDefault()
      event.stopPropagation()
      forwardNativeContextMenu(folder.sourceItem, event)
    })
    grid.appendChild(button)
  })

  section.appendChild(grid)
  return section
}

function renderImagesSection(doc: Document, images: MediaWallImageItem[]) {
  const section = doc.createElement('section')
  section.className = 'm115-wall-section'

  const title = doc.createElement('div')
  title.className = 'm115-wall-title'
  title.textContent = '图片'
  section.appendChild(title)

  const grid = doc.createElement('div')
  grid.className = 'm115-image-grid'
  const lightbox = getLightboxController(doc)

  images.forEach((image, index) => {
    const button = doc.createElement('button')
    button.type = 'button'
    button.className = 'm115-image-card'
    button.title = image.title

    const thumbWrap = doc.createElement('span')
    thumbWrap.className = 'm115-image-thumb-wrap'

    const thumb = doc.createElement('img')
    thumb.className = 'm115-image-thumb'
    thumb.src = image.thumbUrl
    thumb.alt = image.title
    thumb.loading = 'lazy'

    const name = doc.createElement('span')
    name.className = 'm115-image-name'
    name.textContent = image.title

    thumbWrap.appendChild(thumb)
    button.appendChild(thumbWrap)
    button.appendChild(name)
    button.addEventListener('click', () => lightbox.open(images, index))
    button.addEventListener('contextmenu', (event) => {
      event.preventDefault()
      event.stopPropagation()
      forwardNativeContextMenu(image.sourceItem, event)
    })
    grid.appendChild(button)
  })

  section.appendChild(grid)
  return section
}

export function renderMediaWall(doc: Document) {
  const list = doc.querySelector('.list-contents') as HTMLElement | null
  if (!list) return

  const allItems = Array.from(list.querySelectorAll<HTMLElement>('li[rel="item"]'))
  const folders = allItems.map(buildFolderItem).filter((item): item is MediaWallFolderItem => !!item)
  const images = allItems.map(buildImageItem).filter((item): item is MediaWallImageItem => !!item)
  const signature = buildSignature(list, folders, images)
  const previous = stateByDoc.get(doc)
  if (previous?.listEl === list && previous.signature === signature) return

  clearWall(list)
  if (folders.length === 0 && images.length === 0) {
    stateByDoc.set(doc, { listEl: list, signature })
    return
  }

  const wall = doc.createElement('div')
  wall.id = WALL_ID
  wall.className = 'm115-media-wall'
  if (folders.length > 0) wall.appendChild(renderFoldersSection(doc, folders))
  if (images.length > 0) wall.appendChild(renderImagesSection(doc, images))
  list.insertBefore(wall, list.firstChild)

  allItems.forEach((item) => {
    if (buildFolderItem(item) || buildImageItem(item)) {
      item.classList.add(HIDDEN_CLASS)
    }
  })

  stateByDoc.set(doc, { listEl: list, signature })
}
