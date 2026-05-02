import { injectSidebarPrehide } from './sidebar'

export function watchWangpanFrame(onDocumentReady: (doc: Document) => void) {
  const boundFrames = new WeakSet<HTMLIFrameElement>()
  const observers: MutationObserver[] = []

  const bindFrame = () => {
    const frame = document.querySelector('iframe[name="wangpan"]') as HTMLIFrameElement | null
    if (frame && !boundFrames.has(frame)) {
      frame.addEventListener('load', bindFrame)
      boundFrames.add(frame)
    }
    const doc = frame?.contentDocument
    if (!doc) return
    onDocumentReady(doc)
  }

  bindFrame()

  const observer = new MutationObserver(bindFrame)
  observer.observe(document.documentElement, { childList: true, subtree: true })
  observers.push(observer)

  return () => {
    observers.forEach(o => o.disconnect())
  }
}

export function primeSidebarPrehideForPage() {
  injectSidebarPrehide(document)

  const tryInjectFrame = () => {
    const frame = document.querySelector('iframe[name="wangpan"]') as HTMLIFrameElement | null
    const doc = frame?.contentDocument
    if (doc) {
      injectSidebarPrehide(doc)
    }
  }

  tryInjectFrame()

  const observer = new MutationObserver(() => tryInjectFrame())
  observer.observe(document.documentElement, { childList: true, subtree: true })

  window.setTimeout(() => observer.disconnect(), 15000)
}
