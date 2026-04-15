import { describe, expect, it } from 'vitest'
import { isCompletedPlayback, shouldRestorePlayHistory } from './history'

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
})
