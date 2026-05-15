import { describe, expect, it } from 'vitest'
import { canUseNativeUltraSource, isConservativeNativeUltraExtension, shouldFallbackNativeSilentAudio, shouldRetryNativePlayback } from './native-playback'

describe('shouldRetryNativePlayback', () => {
  it('allows one retry before first successful playing', () => {
    expect(shouldRetryNativePlayback({ retryCount: 0, hasStartedPlaying: false })).toBe(true)
    expect(shouldRetryNativePlayback({ retryCount: 1, hasStartedPlaying: false })).toBe(false)
  })

  it('does not auto retry once native playback already started', () => {
    expect(shouldRetryNativePlayback({ retryCount: 0, hasStartedPlaying: true })).toBe(false)
  })

  it('allows native ultra for conservative browser-playable containers only', () => {
    expect(canUseNativeUltraSource('video.mp4', 'https://example.com/file.mp4')).toBe(true)
    expect(canUseNativeUltraSource('video.webm', 'https://example.com/file.webm')).toBe(true)
    expect(canUseNativeUltraSource('video.mkv', 'https://example.com/file.mkv')).toBe(false)
    expect(canUseNativeUltraSource('video.ts', 'https://example.com/file.ts')).toBe(false)
  })

  it('falls back silent native audio for stable containers and manually selected mkv', () => {
    expect(shouldFallbackNativeSilentAudio({ title: 'video.mp4', ultraUrl: null, nativeUltraConservative: true })).toBe(true)
    expect(shouldFallbackNativeSilentAudio({ title: 'video.mkv', ultraUrl: 'https://example.com/file.mkv', nativeUltraConservative: false })).toBe(true)
    expect(shouldFallbackNativeSilentAudio({ title: 'video.mov', ultraUrl: 'https://example.com/file.mov', nativeUltraConservative: false })).toBe(false)
  })
})
