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

  const zoomHint = doc.createElement('div')
  zoomHint.className = 'm115-viewer-zoom-hint'

  const toolbarMeta = doc.createElement('div')
  toolbarMeta.className = 'm115-viewer-meta'

  const toolbarActions = doc.createElement('div')
  toolbarActions.className = 'm115-viewer-actions'

  const closeBtn = doc.createElement('button')
  closeBtn.type = 'button'
  closeBtn.className = 'm115-viewer-tool-btn is-icon'
  closeBtn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>'
  closeBtn.title = '关闭'
  closeBtn.setAttribute('aria-label', '关闭')

  const zoomBadge = doc.createElement('button')
  zoomBadge.type = 'button'
  zoomBadge.className = 'm115-viewer-zoom-badge'

  toolbarMeta.appendChild(titleEl)
  toolbarMeta.appendChild(zoomHint)
  toolbarActions.appendChild(zoomBadge)
  toolbarActions.appendChild(closeBtn)
  toolbar.appendChild(toolbarMeta)
  toolbar.appendChild(toolbarActions)

  const stage = doc.createElement('div')
  stage.className = 'm115-viewer-stage'

  const prevBtn = doc.createElement('button')
  prevBtn.type = 'button'
  prevBtn.className = 'm115-viewer-nav m115-viewer-prev'
  prevBtn.innerHTML = '<svg viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"/></svg>'

  const nextBtn = doc.createElement('button')
  nextBtn.type = 'button'
  nextBtn.className = 'm115-viewer-nav m115-viewer-next'
  nextBtn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg>'

  const mediaFrame = doc.createElement('div')
  mediaFrame.className = 'm115-viewer-frame'

  const deleteBtn = doc.createElement('button')
  deleteBtn.type = 'button'
  deleteBtn.className = 'm115-viewer-frame-delete'
  deleteBtn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg>'
  deleteBtn.title = '删除'
  deleteBtn.setAttribute('aria-label', '删除')

  const imageEl = doc.createElement('img')
  imageEl.className = 'm115-viewer-image'

  mediaFrame.appendChild(deleteBtn)
  mediaFrame.appendChild(imageEl)
  stage.appendChild(prevBtn)
  stage.appendChild(mediaFrame)
  stage.appendChild(nextBtn)

  const thumbsWrap = doc.createElement('div')
  thumbsWrap.className = 'm115-viewer-thumbs-wrap'

  const thumbsToggle = doc.createElement('button')
  thumbsToggle.type = 'button'
  thumbsToggle.className = 'm115-viewer-thumbs-toggle'
  thumbsToggle.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>'
  thumbsToggle.title = '收起缩略图'
  thumbsToggle.setAttribute('aria-label', '收起缩略图')

  const thumbs = doc.createElement('div')
  thumbs.className = 'm115-viewer-thumbs'

  thumbsWrap.appendChild(thumbsToggle)
  thumbsWrap.appendChild(thumbs)

  overlay.appendChild(toolbar)
  overlay.appendChild(stage)
  overlay.appendChild(thumbsWrap)
  doc.body.appendChild(overlay)

  let items: MediaWallImageItem[] = []
  let currentIndex = 0
  let zoomScale = 1
  let translateX = 0
  let translateY = 0
  let isDragging = false
  let pointerId: number | null = null
  let pointerDownX = 0
  let pointerDownY = 0
  let clickSuppressUntil = 0
  let dragStartX = 0
  let dragStartY = 0
  let dragOriginX = 0
  let dragOriginY = 0
  let targetTranslateX = 0
  let targetTranslateY = 0
  let settleAnimationFrame = 0
  let dragAnimationFrame = 0
  let lastDragTime = 0
  let velocityX = 0
  let velocityY = 0
  let lastPointerX = 0
  let lastPointerY = 0
  let lastTapAt = 0
  let lastTapX = 0
  let lastTapY = 0
  let thumbsCollapsed = false

  const DRAG_THRESHOLD = 6
  const EDGE_RESISTANCE = 0.5
  const DOUBLE_TAP_DELAY = 260
  const INERTIA_FACTOR = 60
  const SETTLE_LERP = 0.34

  const updateThumbsToggle = () => {
    thumbsToggle.innerHTML = thumbsCollapsed
      ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 12h10"/></svg>'
      : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>'
    thumbsToggle.title = thumbsCollapsed ? '展开缩略图' : '收起缩略图'
    thumbsToggle.setAttribute('aria-label', thumbsToggle.title)
    thumbsWrap.classList.toggle('is-collapsed', thumbsCollapsed)
  }

  const getDragBounds = () => {
    const frameRect = mediaFrame.getBoundingClientRect()
    const naturalWidth = imageEl.naturalWidth || frameRect.width || 1
    const naturalHeight = imageEl.naturalHeight || frameRect.height || 1
    const fitScale = Math.min(frameRect.width / naturalWidth, frameRect.height / naturalHeight, 1)
    const renderedWidth = naturalWidth * fitScale * zoomScale
    const renderedHeight = naturalHeight * fitScale * zoomScale
    return {
      maxOffsetX: Math.max(0, (renderedWidth - frameRect.width) / 2),
      maxOffsetY: Math.max(0, (renderedHeight - frameRect.height) / 2),
    }
  }

  const applyEdgeResistance = (value: number, min: number, max: number) => {
    if (value < min) return min + (value - min) * EDGE_RESISTANCE
    if (value > max) return max + (value - max) * EDGE_RESISTANCE
    return value
  }

  const clampTranslate = () => {
    const { maxOffsetX, maxOffsetY } = getDragBounds()
    translateX = Math.max(-maxOffsetX, Math.min(maxOffsetX, translateX))
    translateY = Math.max(-maxOffsetY, Math.min(maxOffsetY, translateY))
  }

  const updateZoomUi = () => {
    const percent = Math.round(zoomScale * 100)
    zoomBadge.textContent = `${percent}%`
    zoomBadge.classList.toggle('is-active', zoomScale > 1)
    zoomHint.textContent = zoomScale > 1 ? '可拖动' : ''
    zoomHint.classList.toggle('is-active', zoomScale > 1)
    imageEl.classList.toggle('is-draggable', zoomScale > 1)
    imageEl.classList.toggle('is-dragging', isDragging)
    mediaFrame.classList.toggle('is-zoomed', zoomScale > 1)
    mediaFrame.classList.toggle('is-dragging', isDragging)
  }

  const applyZoom = () => {
    clampTranslate()
    targetTranslateX = translateX
    targetTranslateY = translateY
    imageEl.style.transform = `translate(calc(-50% + ${translateX}px), calc(-50% + ${translateY}px)) scale(${zoomScale})`
    updateZoomUi()
  }

  const applyDragFrame = () => {
    dragAnimationFrame = 0
    const { maxOffsetX, maxOffsetY } = getDragBounds()
    translateX = applyEdgeResistance(targetTranslateX, -maxOffsetX, maxOffsetX)
    translateY = applyEdgeResistance(targetTranslateY, -maxOffsetY, maxOffsetY)
    imageEl.style.transform = `translate(calc(-50% + ${translateX}px), calc(-50% + ${translateY}px)) scale(${zoomScale})`
    updateZoomUi()
  }

  const scheduleDragFrame = () => {
    if (dragAnimationFrame) return
    dragAnimationFrame = window.requestAnimationFrame(applyDragFrame)
  }

  const zoomAtPoint = (nextScale: number, clientX: number, clientY: number) => {
    const frameRect = mediaFrame.getBoundingClientRect()
    const naturalWidth = imageEl.naturalWidth || frameRect.width || 1
    const naturalHeight = imageEl.naturalHeight || frameRect.height || 1
    const fitScale = Math.min(frameRect.width / naturalWidth, frameRect.height / naturalHeight, 1)
    const baseWidth = naturalWidth * fitScale
    const baseHeight = naturalHeight * fitScale
    const currentScale = zoomScale
    const frameX = clientX - frameRect.left - frameRect.width / 2
    const frameY = clientY - frameRect.top - frameRect.height / 2
    const imagePointX = (frameX - translateX) / currentScale
    const imagePointY = (frameY - translateY) / currentScale

    zoomScale = nextScale
    translateX = frameX - imagePointX * nextScale
    translateY = frameY - imagePointY * nextScale

    if (!Number.isFinite(translateX)) translateX = 0
    if (!Number.isFinite(translateY)) translateY = 0
    if (!baseWidth || !baseHeight || nextScale === 1) {
      translateX = 0
      translateY = 0
    }

    if (zoomScale === 1) {
      targetTranslateX = 0
      targetTranslateY = 0
      isDragging = false
      pointerId = null
    }

    applyZoom()
  }

  const snapBackToBounds = () => {
    if (settleAnimationFrame) window.cancelAnimationFrame(settleAnimationFrame)

    const { maxOffsetX, maxOffsetY } = getDragBounds()
    targetTranslateX = Math.max(-maxOffsetX, Math.min(maxOffsetX, targetTranslateX))
    targetTranslateY = Math.max(-maxOffsetY, Math.min(maxOffsetY, targetTranslateY))

    const tick = () => {
      const nextX = translateX + (targetTranslateX - translateX) * SETTLE_LERP
      const nextY = translateY + (targetTranslateY - translateY) * SETTLE_LERP
      const doneX = Math.abs(targetTranslateX - nextX) < 0.5
      const doneY = Math.abs(targetTranslateY - nextY) < 0.5
      translateX = doneX ? targetTranslateX : nextX
      translateY = doneY ? targetTranslateY : nextY
      imageEl.style.transform = `translate(calc(-50% + ${translateX}px), calc(-50% + ${translateY}px)) scale(${zoomScale})`
      updateZoomUi()
      if (doneX && doneY) {
        translateX = targetTranslateX
        translateY = targetTranslateY
        imageEl.style.transform = `translate(calc(-50% + ${translateX}px), calc(-50% + ${translateY}px)) scale(${zoomScale})`
        updateZoomUi()
        settleAnimationFrame = 0
        return
      }
      settleAnimationFrame = window.requestAnimationFrame(tick)
    }

    settleAnimationFrame = window.requestAnimationFrame(tick)
  }

  const resetZoom = () => {
    if (settleAnimationFrame) {
      window.cancelAnimationFrame(settleAnimationFrame)
      settleAnimationFrame = 0
    }
    if (dragAnimationFrame) {
      window.cancelAnimationFrame(dragAnimationFrame)
      dragAnimationFrame = 0
    }
    zoomScale = 1
    translateX = 0
    translateY = 0
    targetTranslateX = 0
    targetTranslateY = 0
    isDragging = false
    pointerId = null
    applyZoom()
  }

  const adjustZoom = (delta: number, clientX?: number, clientY?: number) => {
    const next = Math.max(1, Math.min(4, zoomScale + delta))
    if (next === zoomScale) return
    if (typeof clientX === 'number' && typeof clientY === 'number') {
      zoomAtPoint(next, clientX, clientY)
      return
    }
    zoomScale = next
    if (zoomScale === 1) {
      translateX = 0
      translateY = 0
      targetTranslateX = 0
      targetTranslateY = 0
      isDragging = false
      pointerId = null
    }
    applyZoom()
  }

  const preloadNeighbors = () => {
    ;[-2, -1, 1, 2].forEach((offset) => {
      const item = items[currentIndex + offset]
      if (item) preloadImage(item.originalUrl)
    })
  }

  const ensureActiveThumbVisible = () => {
    const activeThumb = thumbs.querySelector<HTMLElement>('.m115-viewer-thumb.is-active')
    activeThumb?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' })
  }

  const syncThumbs = () => {
    thumbs.innerHTML = ''
    items.forEach((item, index) => {
      const btn = doc.createElement('button')
      btn.type = 'button'
      btn.className = `m115-viewer-thumb ${index === currentIndex ? 'is-active' : ''}`
      btn.title = item.title
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

    window.setTimeout(() => ensureActiveThumbVisible(), 0)
  }

  const render = () => {
    const current = items[currentIndex]
    if (!current) return
    const shortTitle = current.title.length > 26 ? `${current.title.slice(0, 26)}…` : current.title
    titleEl.textContent = `${shortTitle} · ${currentIndex + 1} / ${items.length}`
    titleEl.title = current.title
    imageEl.src = current.originalUrl
    imageEl.alt = current.title
    resetZoom()
    syncThumbs()
    preloadNeighbors()
  }

  imageEl.addEventListener('load', () => {
    clampTranslate()
    applyZoom()
  })

  imageEl.addEventListener('dblclick', (event) => {
    event.preventDefault()
    event.stopPropagation()
    clickSuppressUntil = Date.now() + 260
    lastTapAt = 0
    zoomAtPoint(zoomScale > 1 ? 1 : 2, event.clientX, event.clientY)
  })

  imageEl.addEventListener('click', (event) => {
    event.stopPropagation()
    if (Date.now() < clickSuppressUntil) return
    if (zoomScale > 1) return
    window.setTimeout(() => {
      if (Date.now() < clickSuppressUntil) return
      close()
    }, 220)
  })

  const close = () => {
    overlay.classList.remove('active')
    imageEl.src = ''
    resetZoom()
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

  zoomBadge.addEventListener('click', (event) => {
    event.stopPropagation()
    const rect = mediaFrame.getBoundingClientRect()
    const centerX = rect.left + rect.width / 2
    const centerY = rect.top + rect.height / 2
    if (zoomScale > 1) {
      zoomAtPoint(1, centerX, centerY)
      return
    }
    zoomAtPoint(2, centerX, centerY)
  })

  thumbsToggle.addEventListener('click', (event) => {
    event.stopPropagation()
    thumbsCollapsed = !thumbsCollapsed
    updateThumbsToggle()
  })

  imageEl.addEventListener('pointerdown', (event) => {
    pointerDownX = event.clientX
    pointerDownY = event.clientY
    lastPointerX = event.clientX
    lastPointerY = event.clientY
    lastDragTime = performance.now()
    velocityX = 0
    velocityY = 0
    if (zoomScale <= 1) return
    event.preventDefault()
    if (settleAnimationFrame) {
      window.cancelAnimationFrame(settleAnimationFrame)
      settleAnimationFrame = 0
    }
    pointerId = event.pointerId
    isDragging = true
    dragStartX = event.clientX
    dragStartY = event.clientY
    dragOriginX = targetTranslateX
    dragOriginY = targetTranslateY
    imageEl.setPointerCapture(event.pointerId)
    updateZoomUi()
  })

  imageEl.addEventListener('pointermove', (event) => {
    if (!isDragging || pointerId !== event.pointerId) return
    const deltaX = event.clientX - dragStartX
    const deltaY = event.clientY - dragStartY
    const now = performance.now()
    const elapsed = Math.max(1, now - lastDragTime)
    velocityX = (event.clientX - lastPointerX) / elapsed
    velocityY = (event.clientY - lastPointerY) / elapsed
    lastPointerX = event.clientX
    lastPointerY = event.clientY
    lastDragTime = now
    if (Math.abs(deltaX) > DRAG_THRESHOLD || Math.abs(deltaY) > DRAG_THRESHOLD) {
      clickSuppressUntil = Date.now() + 180
    }
    targetTranslateX = dragOriginX + deltaX
    targetTranslateY = dragOriginY + deltaY
    scheduleDragFrame()
  })

  const stopDragging = (event?: PointerEvent) => {
    if (event && pointerId !== null && pointerId === event.pointerId && imageEl.hasPointerCapture(event.pointerId)) {
      imageEl.releasePointerCapture(event.pointerId)
    }
    if (dragAnimationFrame) {
      window.cancelAnimationFrame(dragAnimationFrame)
      dragAnimationFrame = 0
    }
    if (event) {
      const movedX = event.clientX - pointerDownX
      const movedY = event.clientY - pointerDownY
      if (Math.abs(movedX) > DRAG_THRESHOLD || Math.abs(movedY) > DRAG_THRESHOLD) {
        clickSuppressUntil = Date.now() + 180
      }
    }
    if (!isDragging) return
    isDragging = false
    pointerId = null
    targetTranslateX += velocityX * INERTIA_FACTOR
    targetTranslateY += velocityY * INERTIA_FACTOR
    updateZoomUi()
    snapBackToBounds()
  }

  imageEl.addEventListener('pointerup', (event) => stopDragging(event))
  imageEl.addEventListener('pointercancel', (event) => stopDragging(event))
  imageEl.addEventListener('lostpointercapture', () => stopDragging())

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

  thumbs.addEventListener('wheel', (event) => {
    if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return
    event.preventDefault()
    thumbs.scrollBy({ left: event.deltaY, behavior: 'smooth' })
  }, { passive: false })

  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) close()
  })

  overlay.addEventListener('wheel', (event) => {
    event.preventDefault()
    const frameRect = mediaFrame.getBoundingClientRect()
    const insideFrame = event.clientX >= frameRect.left
      && event.clientX <= frameRect.right
      && event.clientY >= frameRect.top
      && event.clientY <= frameRect.bottom

    if (zoomScale > 1 && insideFrame) {
      adjustZoom(event.deltaY < 0 ? 0.18 : -0.18, event.clientX, event.clientY)
      return
    }

    move(event.deltaY > 0 ? 1 : -1)
  }, { passive: false })

  doc.addEventListener('keydown', (event) => {
    if (!overlay.classList.contains('active')) return
    if (event.key === 'Escape') close()
    if (event.key === 'ArrowLeft') move(-1)
    if (event.key === 'ArrowRight') move(1)
    if (event.key.toLowerCase() === 't') {
      thumbsCollapsed = !thumbsCollapsed
      updateThumbsToggle()
    }
  })

  updateThumbsToggle()

  return {
    open(nextItems: MediaWallImageItem[], startIndex: number) {
      if (!nextItems.length) return
      items = [...nextItems]
      currentIndex = Math.max(0, Math.min(startIndex, items.length - 1))
      overlay.classList.add('active')
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

    if (folder.starAction) {
      const starBtn = doc.createElement('button')
      starBtn.type = 'button'
      starBtn.className = `m115-folder-action ${folder.isStarred ? 'is-active' : ''}`
      starBtn.dataset.role = 'star'
      starBtn.title = folder.isStarred ? '取消星标' : '设为星标'
      starBtn.setAttribute('aria-label', starBtn.title)
      starBtn.textContent = folder.isStarred ? '已星标' : '星标'
      starBtn.addEventListener('click', (event) => {
        event.preventDefault()
        event.stopPropagation()
        folder.starAction?.click()
        scheduleMediaWallRefresh(doc)
      })
      actions.appendChild(starBtn)
    }

    if (folder.remarkAction) {
      const remarkBtn = doc.createElement('button')
      remarkBtn.type = 'button'
      remarkBtn.className = `m115-folder-action ${folder.hasRemark ? 'is-active' : ''}`
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

function collectMediaItems(list: HTMLElement) {
  const items = Array.from(list.querySelectorAll<HTMLElement>('li[rel="item"]'))
  const folders = items.map(buildFolderItem).filter((item): item is MediaWallFolderItem => !!item)
  const images = items.map(buildImageItem).filter((item): item is MediaWallImageItem => !!item)
  return { folders, images }
}

function ensureWallContainer(list: HTMLElement): HTMLElement {
  let wall = list.querySelector<HTMLElement>(`#${WALL_ID}`)
  if (wall) return wall
  wall = document.createElement('div')
  wall.id = WALL_ID
  wall.className = 'm115-media-wall'
  list.prepend(wall)
  return wall
}

function hideSourceItems(folders: MediaWallFolderItem[], images: MediaWallImageItem[]) {
  folders.forEach(folder => folder.sourceItem.classList.add(HIDDEN_CLASS))
  images.forEach(image => image.sourceItem.classList.add(HIDDEN_CLASS))
}

export function renderMediaWall(doc: Document) {
  const list = doc.querySelector('.list-contents') as HTMLElement | null
  if (!list) return

  const { folders, images } = collectMediaItems(list)
  const signature = buildSignature(list, folders, images)
  const previousState = stateByDoc.get(doc)
  if (previousState?.listEl === list && previousState.signature === signature) return

  clearWall(list)
  if (!folders.length && !images.length) {
    stateByDoc.set(doc, { listEl: list, signature })
    return
  }

  const wall = ensureWallContainer(list)
  wall.innerHTML = ''

  if (folders.length) wall.appendChild(renderFoldersSection(doc, folders))
  if (images.length) wall.appendChild(renderImagesSection(doc, images))

  hideSourceItems(folders, images)
  stateByDoc.set(doc, { listEl: list, signature })
}
