import { describe, expect, it } from 'vitest'
import { ORIGINAL_PLACEHOLDER_URL } from './quality'
import {
  applyFallbackToHlsState,
  applySelectedQualityOption,
  isOriginalPlaceholderOption,
  refreshPlaybackQualityState,
  resolveOriginalPlaceholderUrl,
  syncPlaybackStateByUrl,
  type PlaybackState,
} from './playback-state'

function createState(overrides: Partial<PlaybackState> = {}): PlaybackState {
  return {
    ultraUrl: 'https://lossless.example/video.mp4',
    m3u8List: [
      { name: 'YH', quality: 9999, url: 'https://origin.example/master.m3u8' },
      { name: 'UD', quality: 1080, url: 'https://origin.example/1080.m3u8' },
    ],
    qualityOptions: [],
    currentQuality: 9999,
    currentQualityLabel: '无损',
    isNativeVideo: true,
    ...overrides,
  }
}

describe('playback state helpers', () => {
  it('refreshes quality options and syncs current source by url', () => {
    const next = refreshPlaybackQualityState(createState(), 'https://origin.example/master.m3u8')

    expect(next.currentQualityLabel).toBe('115原画')
    expect(next.isNativeVideo).toBe(false)
    expect(next.qualityOptions.map(item => item.label)).toEqual(['无损', '115原画', '1080P'])
  })

  it('returns a patch for switching selected quality', () => {
    const patch = applySelectedQualityOption(createState(), {
      label: '115原画',
      quality: 9999,
      url: 'https://origin.example/master.m3u8',
    })

    expect(patch).toEqual({
      currentQuality: 9999,
      currentQualityLabel: '115原画',
      isNativeVideo: false,
    })
  })

  it('returns best hls fallback url and patch', () => {
    const result = applyFallbackToHlsState(createState({ isNativeVideo: true }))

    expect(result.url).toBe('https://origin.example/master.m3u8')
    expect(result.patch).toEqual({
      isNativeVideo: false,
      currentQuality: 9999,
      currentQualityLabel: '115原画',
    })
  })

  it('resolves original placeholder url from loaded m3u8 list', () => {
    expect(resolveOriginalPlaceholderUrl(createState())).toBe('https://origin.example/master.m3u8')
    expect(isOriginalPlaceholderOption({ label: '115原画', quality: 9999, url: ORIGINAL_PLACEHOLDER_URL })).toBe(true)
  })

  it('returns empty patch when current url is unknown', () => {
    expect(syncPlaybackStateByUrl(createState(), 'https://unknown.example/video.m3u8')).toEqual({})
  })
})
