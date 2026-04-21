import homeCss from './home.css?inline'
import { extractFileInfo } from './core/extractors'
import { openPlayer } from './core/player-open'
import { injectActionButtons } from './core/action-buttons'
import { addDownloadIntercept } from './core/download-intercept'

import { renderPreview } from './core/preview'
import { renderMediaWall } from './core/media-wall'
import { initSidebar, injectSidebarPrehide } from './core/sidebar'
import { findScrollBox, ScrollPositionManager } from './core/scroll-history'
import { sendRuntimeMessageSafe } from './core/runtime'

class HomeController {
  private boundDocs = new WeakSet<Document>()
  private scannedItems = new WeakSet<HTMLElement>()
  private playBoundItems = new WeakSet<HTMLElement>()
  private observers: MutationObserver[] = []
  private lastOpen: { pickCode: string, ts: number } | null = null
  private openingLock = false
  private scrollManagers = new WeakMap<Document, ScrollPositionManager>()

  init() {
    this.bindDocument(document)
    this.bindWangpanFrame()
    this.watchFrameAppear()
    globalThis.chrome?.runtime?.onMessage?.addListener(this.handleRuntimeMessage)
  }

  destroy() {
    this.observers.forEach(o => o.disconnect())
    this.observers = []
    globalThis.chrome?.runtime?.onMessage?.removeListener(this.handleRuntimeMessage)
  }

  private handleRuntimeMessage = (message: any) => {
    if (message?.type !== 'DELETE_SUCCESS_REFRESH') return
    this.removeDeletedItem(message.data?.fileId, message.data?.pickCode)
  }

  private removeDeletedItem(fileId?: string, pickCode?: string) {
    if (!fileId && !pickCode) return

    const docs = [document]
    const frame = document.querySelector('iframe[name="wangpan"]') as HTMLIFrameElement | null
    if (frame?.contentDocument) docs.push(frame.contentDocument)

    for (const doc of docs) {
      const selectors: string[] = []
      if (fileId) {
        selectors.push(`[file_id="${fileId}"]`, `[fid="${fileId}"]`, `[fileid="${fileId}"]`)
      }
      if (pickCode) {
        selectors.push(`[pick_code="${pickCode}"]`, `[pickcode="${pickCode}"]`)
      }
      if (selectors.length === 0) continue
      doc.querySelectorAll(selectors.join(',')).forEach(node => node.remove())
    }
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

    injectSidebarPrehide(doc)
    this.injectStyles(doc)
    this.scanAndRender(doc)
    this.initScrollHistory(doc)

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

  private bindItemPlay(item: HTMLElement) {
    if (this.playBoundItems.has(item)) return

    const file = extractFileInfo(item)
    if (!file || !file.isVideo) return

    const fileNameNode = (item.querySelector('.file-thumb') || item.querySelector('.file-name .name') || item.querySelector('.file-name')) as HTMLElement | null
    if (!fileNameNode) return

    const handleClickPlayer = (event: Event) => {
      const now = Date.now()
      if (this.openingLock) {
        event.preventDefault()
        event.stopPropagation()
        event.stopImmediatePropagation()
        return
      }
      if (this.lastOpen && this.lastOpen.pickCode === file.pickCode && now - this.lastOpen.ts < 1500) {
        event.preventDefault()
        event.stopPropagation()
        event.stopImmediatePropagation()
        return
      }

      this.openingLock = true
      this.lastOpen = { pickCode: file.pickCode, ts: now }
      window.setTimeout(() => {
        this.openingLock = false
      }, 1500)

      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      void openPlayer(file)
    }

    fileNameNode.addEventListener('click', handleClickPlayer as EventListener, true)
    item.addEventListener('dblclick', handleClickPlayer as EventListener, true)
    this.playBoundItems.add(item)
  }

  /**
   * 初始化滚动位置记忆
   * 115 网盘切换目录时会重建 .list-cell，需要监听其出现并重新绑定。
   */
  private initScrollHistory(doc: Document) {
    const tryBind = () => {
      const scrollBox = findScrollBox(doc)
      if (!scrollBox) return

      // 如果已经绑定了同一个滚动容器，跳过
      const manager = this.scrollManagers.get(doc)
      if (manager) {
        manager.unbind()
      }
      const m = new ScrollPositionManager()
      m.bind(scrollBox, doc)
      this.scrollManagers.set(doc, m)
    }

    // 初次尝试
    tryBind()

    // 监听 .list-cell 重建（切换目录时整个容器会被替换）
    const observer = new MutationObserver(() => tryBind())
    observer.observe(doc.documentElement, { childList: true, subtree: true })
    this.observers.push(observer)
  }

  private scanAndRender(doc: Document) {
    const list = doc.querySelector('.list-contents')
    if (!list) return

    renderMediaWall(doc)

    const items = doc.querySelectorAll('li[pick_code],li[pickcode],div[pick_code],div[pickcode]')
    items.forEach((node) => {
      const item = node as HTMLElement
      if (this.scannedItems.has(item)) return
      this.scannedItems.add(item)

      const file = extractFileInfo(item)
      if (!file) return

      // 下载拦截对所有文件生效
      addDownloadIntercept(item, file)

      if (!file.isVideo) return

      this.bindItemPlay(item)
      injectActionButtons(item, file)
      renderPreview(item, file)
    })
  }
}

let controller: HomeController | null = null

function init() {
  if (window.top !== window) return
  if (/\/web\/lixian\/master\/video\//.test(window.location.pathname)) return
  injectSidebarPrehide(document)
  initSidebar(document)
  controller = new HomeController()
  controller.init()
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init)
}
else {
  init()
}

// 监听来自 TreeDG callback 的移动成功事件
window.addEventListener('115m-move-success', () => {
  void sendRuntimeMessageSafe({ type: 'MOVE_SUCCESS_REFRESH' })
})

window.addEventListener('beforeunload', () => {
  controller?.destroy()
  controller = null
})
