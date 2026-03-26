import { getVideoCovers } from '../lib/videoThumbnail'
import homeCss from './home.css?inline'

interface FileInfo {
  pickCode: string
  fileName: string
  duration: number
  isVideo: boolean
}

async function sendRuntimeMessageSafe<T = unknown>(message: unknown): Promise<T | null> {
  try {
    return await chrome.runtime.sendMessage(message) as T
  }
  catch {
    return null
  }
}

function parseDuration(value?: string): number {
  if (!value) return 0
  const parts = value.split(':').map(Number)
  if (parts.some(Number.isNaN)) return 0
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  if (parts.length === 1) return parts[0]
  return 0
}

class Scheduler {
  private running = 0
  private queue: Array<() => void> = []

  constructor(private readonly limit = 2) {}

  async add<T>(task: () => Promise<T>): Promise<T> {
    if (this.running >= this.limit) {
      await new Promise<void>((resolve) => this.queue.push(resolve))
    }
    this.running += 1
    try {
      return await task()
    }
    finally {
      this.running -= 1
      this.queue.shift()?.()
    }
  }
}

const coverScheduler = new Scheduler(2)

class HomeController {
  private boundDocs = new WeakSet<Document>()
  private scannedItems = new WeakSet<HTMLElement>()
  private observers: MutationObserver[] = []
  private lastOpen: { pickCode: string, ts: number } | null = null
  private openingLock = false

  init() {
    this.bindDocument(document)
    this.bindWangpanFrame()
    this.watchFrameAppear()
  }

  destroy() {
    this.observers.forEach(o => o.disconnect())
    this.observers = []
  }

  private bindWangpanFrame() {
    const frame = document.querySelector('iframe[name="wangpan"]') as HTMLIFrameElement | null
    const doc = frame?.contentDocument
    if (!doc) return
    this.bindDocument(doc)
  }

  private watchFrameAppear() {
    const observer = new MutationObserver(() => this.bindWangpanFrame())
    observer.observe(document.documentElement, { childList: true, subtree: true })
    this.observers.push(observer)
  }

  private bindDocument(doc: Document) {
    if (this.boundDocs.has(doc)) return
    this.boundDocs.add(doc)

    this.injectStyles(doc)
    this.bindPlayClick(doc)
    this.scanAndRender(doc)

    const observer = new MutationObserver(() => this.scanAndRender(doc))
    observer.observe(doc.documentElement, { childList: true, subtree: true })
    this.observers.push(observer)
  }

  private injectStyles(doc: Document) {
    if (doc.getElementById('master115-style')) return
    const style = doc.createElement('style')
    style.id = 'master115-style'
    style.textContent = homeCss
    doc.head?.appendChild(style)
  }

  private bindPlayClick(doc: Document) {
    doc.addEventListener('click', (event) => {
      const mouse = event as MouseEvent
      if (mouse.button !== 0) return

      const target = event.target as HTMLElement | null
      if (!target) return
      if (!this.isPlayIntentTarget(target)) return

      const item = target.closest('li[pick_code],li[pickcode],div[pick_code],div[pickcode]') as HTMLElement | null
      if (!item) return

      const file = this.extractFileInfo(item)
      if (!file || !file.isVideo) return

      const now = Date.now()
      if (this.openingLock) return
      if (this.lastOpen && this.lastOpen.pickCode === file.pickCode && now - this.lastOpen.ts < 1500) return

      this.openingLock = true
      this.lastOpen = { pickCode: file.pickCode, ts: now }
      window.setTimeout(() => {
        this.openingLock = false
      }, 1500)

      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()

      this.openPlayer(file)
    }, true)
  }

  private isPlayIntentTarget(target: HTMLElement): boolean {
    if (target.closest('.file-opr,[menu],.master115-cover-container')) return false
    return !!target.closest('.file-name .name,.file-name,.name,.file-thumb')
  }

  private extractFileInfo(item: HTMLElement): FileInfo | null {
    const pickCode = item.getAttribute('pick_code') || item.getAttribute('pickcode') || ''
    if (!pickCode) return null

    const durationNode = item.querySelector('.duration') as HTMLElement | null
    const durationRaw = durationNode?.getAttribute('duration') || durationNode?.textContent?.trim() || ''
    const fileName = item.getAttribute('title') || item.querySelector('.file-name .name')?.textContent?.trim() || '视频'

    return {
      pickCode,
      fileName,
      duration: parseDuration(durationRaw),
      isVideo: item.getAttribute('iv') === '1',
    }
  }

  private openPlayer(file: FileInfo) {
    const now = Date.now()
    const playerUrl = chrome.runtime.getURL('src/player/index.html')
    const traceId = `${file.pickCode}-${now}`
    const url = `${playerUrl}?pickCode=${encodeURIComponent(file.pickCode)}&title=${encodeURIComponent(file.fileName)}&traceId=${encodeURIComponent(traceId)}&clickTs=${now}`

    void sendRuntimeMessageSafe({
      type: 'PREFETCH_VIDEO_SOURCE',
      data: { pickCode: file.pickCode },
    })

    void sendRuntimeMessageSafe({
      type: 'OPEN_TAB',
      url,
    })
  }

  private scanAndRender(doc: Document) {
    const list = doc.querySelector('.list-contents')
    if (!list) return

    const items = doc.querySelectorAll('li[pick_code],li[pickcode],div[pick_code],div[pickcode]')
    items.forEach((node) => {
      const item = node as HTMLElement
      if (this.scannedItems.has(item)) return
      this.scannedItems.add(item)

      const file = this.extractFileInfo(item)
      if (!file || !file.isVideo || file.duration <= 0) return
      this.renderPreview(item, file)
    })
  }

  private renderPreview(item: HTMLElement, file: FileInfo) {
    if (item.querySelector('.master115-cover-container')) return

    item.classList.add('with-ext-video-cover')

    const container = document.createElement('div')
    container.className = 'master115-cover-container'

    const skeleton = document.createElement('div')
    skeleton.className = 'master115-cover-skeleton'
    container.appendChild(skeleton)
    item.appendChild(container)

    void coverScheduler.add(async () => {
      try {
        const covers = await getVideoCovers(file.pickCode, file.duration, 5)
        if (!covers.length) {
          container.innerHTML = '<div class="master115-cover-empty">暂无预览图</div>'
          return
        }

        const row = document.createElement('div')
        row.className = 'master115-cover-loaded'

        covers.forEach((cover) => {
          const thumb = document.createElement('span')
          thumb.className = 'master115-cover-thumb'

          const img = document.createElement('img')
          img.className = 'master115-cover-img'
          img.src = cover.imgUrl
          img.alt = `预览 ${Math.floor(cover.time)}s`

          thumb.appendChild(img)
          row.appendChild(thumb)
        })

        container.innerHTML = ''
        container.appendChild(row)
      }
      catch {
        container.innerHTML = '<div class="master115-cover-error">预览图加载失败</div>'
      }
    })
  }
}

let controller: HomeController | null = null

function init() {
  if (window.top !== window) return
  controller = new HomeController()
  controller.init()
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init)
}
else {
  init()
}

window.addEventListener('beforeunload', () => {
  controller?.destroy()
  controller = null
})
