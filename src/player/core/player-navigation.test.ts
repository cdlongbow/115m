import { describe, expect, it } from 'vitest'
import { getNextPlaylistItem, getPlaybackEndCountdownPlan, getPreviousPlaylistItem } from './player-navigation'

const items = [
  { pickCode: 'a', fileId: '1', name: 'A' },
  { pickCode: 'b', fileId: '2', name: 'B' },
  { pickCode: 'c', fileId: '3', name: 'C' },
]

describe('player navigation helpers', () => {
  it('returns previous item', () => {
    expect(getPreviousPlaylistItem(items, 'b')?.pickCode).toBe('a')
  })

  it('returns next item', () => {
    expect(getNextPlaylistItem(items, 'b')?.pickCode).toBe('c')
  })

  it('builds countdown plan when next exists', () => {
    const plan = getPlaybackEndCountdownPlan(items, 'b')
    expect(plan.next?.pickCode).toBe('c')
    expect(plan.countdownSec).toBe(3)
  })

  it('returns empty plan on last item', () => {
    const plan = getPlaybackEndCountdownPlan(items, 'c')
    expect(plan.next).toBeNull()
    expect(plan.countdownSec).toBe(0)
  })
})
