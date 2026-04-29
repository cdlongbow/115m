const ARCHIVE_EXTENSIONS = ['zip', 'rar', '7z', 'tar', 'gz', 'tgz', 'bz2', 'xz']
const LAST_ARCHIVE_NAME_KEY = 'm115:last-unarchive-name'

function isArchiveFileName(name: string): boolean {
  const lower = name.trim().toLowerCase()
  return ARCHIVE_EXTENSIONS.some(ext => lower.endsWith(`.${ext}`))
}

function stripArchiveExtension(name: string): string {
  const trimmed = name.trim()
  const lower = trimmed.toLowerCase()
  for (const ext of ARCHIVE_EXTENSIONS) {
    if (lower.endsWith(`.${ext}`)) {
      return trimmed.slice(0, trimmed.length - ext.length - 1)
    }
  }
  return trimmed
}

function rememberArchiveName(name: string) {
  try {
    sessionStorage.setItem(LAST_ARCHIVE_NAME_KEY, stripArchiveExtension(name))
  }
  catch {
    // ignore storage errors
  }
}

function readRememberedArchiveName(): string | null {
  try {
    const value = sessionStorage.getItem(LAST_ARCHIVE_NAME_KEY)?.trim() || ''
    return value || null
  }
  catch {
    return null
  }
}

function getSelectedArchiveName(doc: Document): string | null {
  const remembered = readRememberedArchiveName()
  if (remembered) {
    return remembered
  }

  const selectors = [
    'li.selected[rel="item"]',
    'li.selected[title]',
    'li.selected[pick_code]',
    'li.selected[pickcode]',
    '[rel="item"].selected',
    '.list-contents li.selected',
    '.list-contents li.cur',
    '.list-contents li.hover',
    '.list-contents [rel="item"].selected',
    '.list-contents [rel="item"].cur',
    '.list-contents [rel="item"].hover',
    '.list-contents [pick_code].selected',
    '.list-contents [pick_code].cur',
    '.list-contents [pick_code].hover',
  ]

  for (const selector of selectors) {
    const node = doc.querySelector<HTMLElement>(selector)
    if (!node) continue

    const name = node?.getAttribute('title')
      || node?.querySelector('.file-name .name')?.textContent?.trim()
      || node?.querySelector('.file-name')?.textContent?.trim()
      || ''

    const icon = (node.getAttribute('ico') || '').toLowerCase()
    const isArchive = isArchiveFileName(name)
      || ARCHIVE_EXTENSIONS.includes(icon)
      || /zip|rar|7z|tar|gz|tgz|bz2|xz/i.test(node.querySelector('.file-typename')?.textContent || '')

    if (name && isArchive) {
      return stripArchiveExtension(name)
    }
  }

  return null
}

function bindArchiveNameCapture(doc: Document) {
  doc.addEventListener('click', (event) => {
    const target = event.target as HTMLElement | null
    if (!target) return

    const item = target.closest<HTMLElement>('li[pick_code],li[pickcode],div[pick_code],div[pickcode],[rel="item"]')
    if (!item) return

    const name = item.getAttribute('title')
      || item.querySelector('.file-name .name')?.textContent?.trim()
      || item.querySelector('.file-name')?.textContent?.trim()
      || ''

    if (name && isArchiveFileName(name)) {
      rememberArchiveName(name)
    }
  }, true)
}

function createFillBar(doc: Document, input: HTMLInputElement, archiveName: string): HTMLElement {
  const bar = doc.createElement('div')
  bar.className = 'm115-unzip-fill-bar'

  const fillText = doc.createElement('span')
  fillText.className = 'm115-unzip-fill-text'
  fillText.textContent = archiveName
  fillText.title = '点击填充压缩包名'
  fillText.addEventListener('click', () => {
    input.value = archiveName
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
    input.focus()
    input.setSelectionRange(archiveName.length, archiveName.length)
  })

  bar.appendChild(fillText)
  return bar
}

function enhanceCreateFolderDialog(doc: Document) {
  const dialogs = Array.from(doc.querySelectorAll<HTMLElement>('.dialog-box.dialog-mini.window-current'))
  for (const dialog of dialogs) {
    const title = dialog.querySelector('[rel="base_title"]')?.textContent?.trim() || ''
    if (title !== '新建文件夹') {
      continue
    }

    if (dialog.querySelector('.m115-unzip-fill-bar')) {
      continue
    }

    const input = dialog.querySelector<HTMLInputElement>('input[rel="txt"], .dialog-input input.text')
    if (!input) {
      continue
    }

    const archiveName = getSelectedArchiveName(doc)
    if (!archiveName) {
      continue
    }

    if (!input.value.trim()) {
      input.value = archiveName
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new Event('change', { bubbles: true }))
      input.setSelectionRange(archiveName.length, archiveName.length)
    }

    const fillBar = createFillBar(doc, input, archiveName)
    input.parentElement?.insertAdjacentElement('beforebegin', fillBar)
  }
}

function injectStyles(doc: Document) {
  if (doc.getElementById('m115-unzip-fill-style')) {
    return
  }

  const style = doc.createElement('style')
  style.id = 'm115-unzip-fill-style'
  style.textContent = `
    .m115-unzip-fill-bar {
      display: flex;
      align-items: center;
      margin: 0 0 8px;
      color: #9ca3af;
      font-size: 12px;
      line-height: 1.4;
      flex-wrap: nowrap;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .m115-unzip-fill-text {
      color: #2563eb;
      cursor: pointer;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      min-width: 0;
    }

    .m115-unzip-fill-text:hover {
      text-decoration: underline;
    }
  `
  doc.head?.appendChild(style)
}

export function initUnarchiveHelper(doc: Document) {
  injectStyles(doc)
  bindArchiveNameCapture(doc)
  enhanceCreateFolderDialog(doc)

  const observer = new MutationObserver(() => {
    enhanceCreateFolderDialog(doc)
  })

  observer.observe(doc.documentElement, {
    childList: true,
    subtree: true,
  })

  return () => observer.disconnect()
}
