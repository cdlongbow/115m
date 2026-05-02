import type { MediaWallFolderItem } from './media-wall-types'

export function openNativeFolder(sourceItem: HTMLElement, hiddenClass: string) {
  const anchor = (sourceItem.querySelector('.file-name .name,[menu="open"],[rel="view_folder"]') as HTMLElement | null) || sourceItem
  sourceItem.classList.remove(hiddenClass)

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
    sourceItem.classList.add(hiddenClass)
  }, 0)
}

export function buildFolderItem(item: HTMLElement): MediaWallFolderItem | null {
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
    open: () => openNativeFolder(item, 'm115-wall-hidden-item'),
  }
}

export function renderFoldersSection(
  doc: Document,
  folders: MediaWallFolderItem[],
  forwardNativeContextMenu: (sourceItem: HTMLElement, event: MouseEvent) => void,
  scheduleMediaWallRefresh: (doc: Document) => void,
) {
  const section = doc.createElement('section')
  section.className = 'm115-wall-section'

  const title = doc.createElement('div')
  title.className = 'm115-wall-title'
  title.textContent = '文件夹'
  section.appendChild(title)

  const grid = doc.createElement('div')
  grid.className = 'm115-folder-grid'
  folders.forEach((folder) => {
    const card = doc.createElement('button')
    card.type = 'button'
    card.className = 'm115-folder-card'
    card.title = folder.title

    // 1. Back Layer (Folder Shell Background + Tab)
    const shellBack = doc.createElement('span')
    shellBack.className = 'm115-folder-shell-back'
    card.appendChild(shellBack)

    // 2. Content Layer (Representing papers/content inside)
    const shellContent = doc.createElement('span')
    shellContent.className = 'm115-folder-shell-content'
    card.appendChild(shellContent)

    // 3. Front Layer (Folder Cover + Main Info)
    const shellFront = doc.createElement('span')
    shellFront.className = 'm115-folder-shell-front'

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

    shellFront.appendChild(coverWrap)
    shellFront.appendChild(footer)
    card.appendChild(shellFront)

    // 4. Actions Layer (Star/Remark)
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

    card.appendChild(actions)

    card.addEventListener('click', () => folder.open())
    card.addEventListener('contextmenu', (event) => {
      event.preventDefault()
      event.stopPropagation()
      forwardNativeContextMenu(folder.sourceItem, event)
    })
    grid.appendChild(card)
  })

  section.appendChild(grid)
  return section
}
