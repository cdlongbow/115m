import type { M3u8Item } from '../../lib/types'
import { getQualityDisplayName } from './quality'
import type { QualityPreference } from './history'

export interface InitialPlaybackPlan {
  url: string
  type: 'native' | 'hls'
  currentQuality: number
  currentQualityLabel: string
  isNativeVideo: boolean
}

export function resolveInitialPlayback(params: {
  qualityPreference: QualityPreference | null
  ultraUrl: string | null
  m3u8List: M3u8Item[]
}): InitialPlaybackPlan | null {
  const { qualityPreference, ultraUrl, m3u8List } = params

  if (qualityPreference) {
    if (qualityPreference.label === '无损' && ultraUrl) {
      return {
        url: ultraUrl,
        type: 'native',
        currentQuality: 9999,
        currentQualityLabel: '无损',
        isNativeVideo: true,
      }
    }

    const preferredItem = qualityPreference.label === '115原画'
      ? m3u8List.find(item => item.quality === 9999) || m3u8List[0]
      : m3u8List.find(item => item.quality === qualityPreference.quality)

    if (preferredItem) {
      return {
        url: preferredItem.url,
        type: 'hls',
        currentQuality: preferredItem.quality,
        currentQualityLabel: qualityPreference.label,
        isNativeVideo: false,
      }
    }
  }

  if (ultraUrl) {
    return {
      url: ultraUrl,
      type: 'native',
      currentQuality: 9999,
      currentQualityLabel: '无损',
      isNativeVideo: true,
    }
  }

  const bestQuality = m3u8List[0]
  if (bestQuality) {
    return {
      url: bestQuality.url,
      type: 'hls',
      currentQuality: bestQuality.quality,
      currentQualityLabel: getQualityDisplayName(bestQuality.quality, true),
      isNativeVideo: false,
    }
  }

  return null
}
