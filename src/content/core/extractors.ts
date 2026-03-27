import type { BreadcrumbItem, FileInfo } from './types'
import { parseDuration } from './utils'

function readAttr(item: HTMLElement, names: string[]): string {
  for (const name of names) {
    const value = item.getAttribute(name)
    if (value) return value
  }
  return ''
}

function extractBreadcrumbs(doc: Document): BreadcrumbItem[] {
  const docs: Document[] = []
  try {
    if (window.top?.document) {
      docs.push(window.top.document)
    }
  }
  catch {
    // ignore cross-frame access issues
  }
  docs.push(doc)

  for (const currentDoc of docs) {
    const container = currentDoc.querySelector('.top-file-path .file-path') as HTMLElement | null
    if (!container) continue

    const nodes = Array.from(container.querySelectorAll('a.folder, a')) as HTMLAnchorElement[]
    const items = nodes
      .map((node) => {
        const cid = node.getAttribute('cid') || ''
        const name = node.getAttribute('cate_name')
          || node.getAttribute('titletext')
          || node.querySelector('span')?.textContent?.trim()
          || node.textContent?.replace('›', '').trim()
          || ''

        return cid && name ? { cid, name } : null
      })
      .filter((item): item is BreadcrumbItem => !!item)
      .filter(item => item.cid !== '0')

    if (items.length > 0) {
      return items
    }
  }

  const currentCid = new URLSearchParams(window.location.search).get('cid') || ''
  return currentCid ? [{ cid: currentCid, name: '当前目录' }] : []
}

export function isPlayIntentTarget(target: HTMLElement): boolean {
  if (target.closest('.file-opr,[menu],.m115-cover-container')) return false
  return !!target.closest('.file-name .name,.file-name,.name,.file-thumb')
}

export function extractFileInfo(item: HTMLElement): FileInfo | null {
  const pickCode = item.getAttribute('pick_code') || item.getAttribute('pickcode') || ''
  if (!pickCode) return null

  const durationNode = item.querySelector('.duration') as HTMLElement | null
  const durationRaw = durationNode?.getAttribute('duration') || durationNode?.textContent?.trim() || ''
  const fileName = item.getAttribute('title') || item.querySelector('.file-name .name')?.textContent?.trim() || '视频'
  const fileSize = item.querySelector('.size,.file-size,.meta-size,.list-size')?.textContent?.trim() || ''
  const fileId = readAttr(item, ['file_id', 'fid', 'fileid'])
  const parentId = readAttr(item, ['cid', 'parent_id', 'pid']) || new URLSearchParams(window.location.search).get('cid') || ''
  const isMarked = !!item.querySelector('.icon-star,.isstar,.file-mark .selected,.file-opr .icon-operate-fav.active')

  return {
    pickCode,
    fileName,
    duration: parseDuration(durationRaw),
    isVideo: item.getAttribute('iv') === '1',
    fileId: fileId || undefined,
    parentId: parentId || undefined,
    fileSize: fileSize || undefined,
    isMarked,
    breadcrumbs: extractBreadcrumbs(item.ownerDocument),
  }
}
