import { describe, expect, it } from 'vitest'
import { canUseNativeUltraSource, shouldRetryNativePlayback } from './native-playback'

describe('shouldRetryNativePlayback', () => {
  it('allows one retry before first successful playing', () => {
    expect(shouldRetryNativePlayback({ retryCount: 0, hasStartedPlaying: false })).toBe(true)
    expect(shouldRetryNativePlayback({ retryCount: 1, hasStartedPlaying: false })).toBe(false)
  })

  it('does not auto retry once native playback already started', () => {
    expect(shouldRetryNativePlayback({ retryCount: 0, hasStartedPlaying: true })).toBe(false)
  })

  it('only allows native ultra for browser-friendly containers', () => {
    expect(canUseNativeUltraSource('video.mp4', 'https://example.com/file.mp4')).toBe(true)
    expect(canUseNativeUltraSource('video.ts', 'https://example.com/file.ts')).toBe(false)
    expect(canUseNativeUltraSource('video.mkv', 'https://example.com/file.mkv')).toBe(false)
  })
})
