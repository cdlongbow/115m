import { getVideoCovers } from '../../lib/videoThumbnail'
import type { FileInfo } from './types'
import { Scheduler } from './utils'

const coverScheduler = new Scheduler(2)

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

      covers.forEach((cover) => {
        const thumb = document.createElement('span')
        thumb.className = 'm115-cover-thumb'

        const img = document.createElement('img')
        img.className = 'm115-cover-img'
        img.src = cover.imgUrl
        img.alt = `预览 ${Math.floor(cover.time)}s`

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
