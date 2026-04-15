import { describe, expect, it } from 'vitest'
import { buildPlayButtonState } from './player-center-controls'

describe('player center controls helpers', () => {
  it('builds play state for paused video', () => {
    const state = buildPlayButtonState(true)
    expect(state.title).toBe('播放')
    expect(state.html).toContain('M8 5v14l11-7z')
  })

  it('builds pause state for playing video', () => {
    const state = buildPlayButtonState(false)
    expect(state.title).toBe('暂停')
    expect(state.html).toContain('M8 5h3v14H8z')
  })
})
