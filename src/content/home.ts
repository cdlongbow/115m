import homeCss from './home.css?inline'
import { extractFileInfo, isPlayIntentTarget } from './core/extractors'
import { openPlayer } from './core/player-open'
import { renderPreview } from './core/preview'

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
    if (doc.getElementById('m115-style')) return
    const style = doc.createElement('style')
    style.id = 'm115-style'
    style.textContent = homeCss
    doc.head?.appendChild(style)
  }

  private bindPlayClick(doc: Document) {
    doc.addEventListener('click', (event) => {
      const mouse = event as MouseEvent
      if (mouse.button !== 0) return

      const target = event.target as HTMLElement | null
      if (!target) return
      if (!isPlayIntentTarget(target)) return

      const item = target.closest('li[pick_code],li[pickcode],div[pick_code],div[pickcode]') as HTMLElement | null
      if (!item) return

      const file = extractFileInfo(item)
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

      openPlayer(file)
    }, true)
  }

  private scanAndRender(doc: Document) {
    const list = doc.querySelector('.list-contents')
    if (!list) return

    const items = doc.querySelectorAll('li[pick_code],li[pickcode],div[pick_code],div[pickcode]')
    items.forEach((node) => {
      const item = node as HTMLElement
      if (this.scannedItems.has(item)) return
      this.scannedItems.add(item)

      const file = extractFileInfo(item)
      if (!file || !file.isVideo || file.duration <= 0) return
      renderPreview(item, file)
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
