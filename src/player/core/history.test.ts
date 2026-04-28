import { describe, expect, it } from 'vitest'
import { buildPlaylistProgressSnapshot, isCompletedPlayback, loadVideoRotation, saveVideoRotation, shouldRestorePlayHistory } from './history'

describe('play history restore guard', () => {
  it('skips restoring progress near the end of playback', () => {
    expect(shouldRestorePlayHistory(118, 120)).toBe(false)
    expect(shouldRestorePlayHistory(99, 100)).toBe(false)
  })

  it('restores progress when enough playback remains', () => {
    expect(shouldRestorePlayHistory(45, 120)).toBe(true)
    expect(shouldRestorePlayHistory(12)).toBe(true)
  })

  it('treats finished playback as completed state', () => {
    expect(isCompletedPlayback(176, 180)).toBe(true)
    expect(isCompletedPlayback(150, 180)).toBe(false)
  })

  it('does not restore empty progress', () => {
    expect(shouldRestorePlayHistory(0, 120)).toBe(false)
  })

  it('builds playlist progress only for resumable history', () => {
    expect(buildPlaylistProgressSnapshot({ currentTime: 45, duration: 120 })).toEqual({
      progressSec: 45,
      progressPercent: 37.5,
    })
    expect(buildPlaylistProgressSnapshot({ currentTime: 118, duration: 120 })).toBeNull()
    expect(buildPlaylistProgressSnapshot({ currentTime: 0, duration: 120 })).toBeNull()
  })
})

describe('video rotation storage', () => {
  it('persists per-video rotation in localStorage', () => {
    const store = new Map<string, string>()
    const localStorageMock = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value)
      },
    }

    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: localStorageMock,
    })

    expect(loadVideoRotation('pick-a')).toBe(0)
    saveVideoRotation('pick-a', 90)
    saveVideoRotation('pick-b', 180)

    expect(loadVideoRotation('pick-a')).toBe(90)
    expect(loadVideoRotation('pick-b')).toBe(180)
    expect(loadVideoRotation('pick-c')).toBe(0)
  })
})
