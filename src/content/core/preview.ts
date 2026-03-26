import { getVideoCovers } from '../../lib/videoThumbnail'
import type { FileInfo } from './types'
import { Scheduler } from './utils'

const coverScheduler = new Scheduler(2)

interface CoverItem {
  imgUrl: string
  time: number
}

interface LightboxController {
  open: (covers: CoverItem[], startIndex: number) => void
}

const lightboxByDoc = new WeakMap<Document, LightboxController>()

function createLightboxController(doc: Document): LightboxController {
  const lightbox = doc.createElement('div')
  lightbox.className = 'm115-lightbox'

  const prevBtn = doc.createElement('button')
  prevBtn.className = 'm115-lightbox-btn m115-lightbox-prev'
  prevBtn.type = 'button'
  prevBtn.textContent = '<'

  const nextBtn = doc.createElement('button')
  nextBtn.className = 'm115-lightbox-btn m115-lightbox-next'
  nextBtn.type = 'button'
  nextBtn.textContent = '>'

  const mainImg = doc.createElement('img')
  mainImg.className = 'm115-lightbox-main-img'
  mainImg.alt = '预览大图'

  lightbox.appendChild(prevBtn)
  lightbox.appendChild(mainImg)
  lightbox.appendChild(nextBtn)
  doc.body.appendChild(lightbox)

  let activeCovers: CoverItem[] = []
  let currentIndex = 0
  let wheelLock = false

  const close = () => {
    lightbox.classList.remove('active')
  }

  const render = () => {
    const current = activeCovers[currentIndex]
    if (!current) return
    mainImg.src = current.imgUrl
  }

  const move = (step: number) => {
    if (activeCovers.length <= 1) return
    currentIndex = (currentIndex + step + activeCovers.length) % activeCovers.length
    render()
  }

  prevBtn.addEventListener('click', (event) => {
    event.stopPropagation()
    move(-1)
  })

  nextBtn.addEventListener('click', (event) => {
    event.stopPropagation()
    move(1)
  })

  mainImg.addEventListener('click', (event) => {
    event.stopPropagation()
    close()
  })

  lightbox.addEventListener('wheel', (event) => {
    event.preventDefault()
    if (wheelLock) return
    wheelLock = true
    window.setTimeout(() => {
      wheelLock = false
    }, 120)

    move(event.deltaY > 0 ? 1 : -1)
  }, { passive: false })

  return {
    open(covers: CoverItem[], startIndex: number) {
      if (!covers.length) return
      activeCovers = covers
      currentIndex = Math.max(0, Math.min(startIndex, covers.length - 1))
      render()
      lightbox.classList.add('active')
    },
  }
}

function getLightboxController(doc: Document): LightboxController {
  const exists = lightboxByDoc.get(doc)
  if (exists) return exists
  const created = createLightboxController(doc)
  lightboxByDoc.set(doc, created)
  return created
}

export function renderPreview(item: HTMLElement, file: FileInfo) {
  if (item.querySelector('.m115-cover-container')) return

  item.classList.add('with-ext-video-cover')

  const container = document.createElement('div')
  container.className = 'm115-cover-container'

  const skeleton = document.createElement('div')
  skeleton.className = 'm115-cover-skeleton'
  container.appendChild(skeleton)
  item.appendChild(container)

  void coverScheduler.add(async () => {
    try {
      const covers = await getVideoCovers(file.pickCode, file.duration, 5)
      if (!covers.length) {
        container.innerHTML = '<div class="m115-cover-empty">暂无预览图</div>'
        return
      }

      const row = document.createElement('div')
      row.className = 'm115-cover-loaded'
      const lightbox = getLightboxController(item.ownerDocument)

      covers.forEach((cover, index) => {
        const thumb = document.createElement('span')
        thumb.className = 'm115-cover-thumb'

        const img = document.createElement('img')
        img.className = 'm115-cover-img'
        img.src = cover.imgUrl
        img.alt = `预览 ${Math.floor(cover.time)}s`

        thumb.addEventListener('click', (event) => {
          event.preventDefault()
          event.stopPropagation()
          lightbox.open(covers, index)
        })

        thumb.appendChild(img)
        row.appendChild(thumb)
      })

      container.innerHTML = ''
      container.appendChild(row)
    }
    catch {
      container.innerHTML = '<div class="m115-cover-error">预览图加载失败</div>'
    }
  })
}
