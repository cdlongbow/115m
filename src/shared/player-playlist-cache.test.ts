import { beforeEach, describe, expect, it } from 'vitest'
import { readTemporaryPlayerPlaylist, saveTemporaryPlayerPlaylist } from './player-playlist-cache'

function createMemoryStorage(): Storage {
  const store = new Map<string, string>()
  return {
    get length() {
      return store.size
    },
    clear() {
      store.clear()
    },
    getItem(key: string) {
      return store.has(key) ? store.get(key)! : null
    },
    key(index: number) {
      return [...store.keys()][index] || null
    },
    removeItem(key: string) {
      store.delete(key)
    },
    setItem(key: string, value: string) {
      store.set(key, value)
    },
  }
}

describe('player playlist cache', () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, 'localStorage', {
      value: createMemoryStorage(),
      configurable: true,
      writable: true,
    })
  })

  it('saves and restores normalized temporary playlists', () => {
    const token = saveTemporaryPlayerPlaylist([
      { pickCode: 'a', fileId: '1', name: 'A', size: '1 MB', isMarked: true, duration: 10 },
      { pickCode: 'a', fileId: '1', name: 'A-dup' },
      { pickCode: 'b', fileId: '', name: 'B' },
    ])

    expect(token).toBeTruthy()
    expect(readTemporaryPlayerPlaylist(token)).toEqual([
      { pickCode: 'a', fileId: '1', name: 'A', size: '1 MB', isMarked: true, duration: 10 },
      { pickCode: 'b', fileId: '', name: 'B', size: '', isMarked: false, duration: 0 },
    ])
  })

  it('returns empty array for unknown tokens', () => {
    expect(readTemporaryPlayerPlaylist('missing')).toEqual([])
  })
})
