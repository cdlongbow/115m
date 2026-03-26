import type { FileInfo } from './types'
import { parseDuration } from './utils'

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

  return {
    pickCode,
    fileName,
    duration: parseDuration(durationRaw),
    isVideo: item.getAttribute('iv') === '1',
  }
}
