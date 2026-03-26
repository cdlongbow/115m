import type { M3u8Item } from '../../lib/types'
import type { QualityOption } from './types'

export const ORIGINAL_PLACEHOLDER_URL = 'm115://original'

export function getQualityDisplayName(quality: number, fromM3u8 = false): string {
  const map: Record<number, string> = {
    9999: fromM3u8 ? '115原画' : '无损',
    2160: '4K',
    1080: '1080P',
    720: '720P',
    480: '480P',
    360: '360P',
  }
  return map[quality] || '自动'
}

export function buildQualityOptions(
  currentUrl: string,
  ultraUrl: string | null,
  m3u8List: M3u8Item[],
  currentQuality: number,
  currentQualityLabel: string,
): QualityOption[] {
  const options: QualityOption[] = []

  if (ultraUrl) {
    options.push({
      label: '无损',
      quality: 9999,
      url: ultraUrl,
    })
  }

  const original = m3u8List.find(item => item.quality === 9999) || m3u8List[0]
  if (original) {
    options.push({
      label: '115原画',
      quality: 9999,
      url: original.url,
    })
  }
  else if (ultraUrl) {
    options.push({
      label: '115原画',
      quality: 9999,
      url: ORIGINAL_PLACEHOLDER_URL,
    })
  }

  if (options.length === 0 && currentUrl) {
    options.push({
      label: currentQualityLabel,
      quality: currentQuality,
      url: currentUrl,
    })
  }

  const dedup = new Map<string, QualityOption>()
  options.forEach((opt) => {
    if (!dedup.has(opt.url)) {
      dedup.set(opt.url, opt)
    }
  })

  return Array.from(dedup.values()).sort((a, b) => {
    const rank = (label: string, quality: number) => {
      if (label === '无损') return 10000
      if (label === '115原画') return 9999
      return quality
    }
    return rank(b.label, b.quality) - rank(a.label, a.quality)
  })
}

export function buildArtplayerQuality(
  qualityOptions: QualityOption[],
  currentUrl: string,
  currentQualityLabel: string,
): { html: string, url: string, default: boolean }[] {
  return qualityOptions.map(opt => ({
    html: opt.label,
    url: opt.url,
    default: opt.url === ORIGINAL_PLACEHOLDER_URL
      ? currentQualityLabel === '115原画'
      : currentUrl === opt.url,
  }))
}
