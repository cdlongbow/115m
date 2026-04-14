import { describe, expect, it } from 'vitest'
import {
  buildNavigateToVideoUrl,
  buildUpdatedMarkedUrl,
  readOverlayMetaQuery,
  readPathFromLocation,
  readPlayerBootstrapConfig,
  readPlaylistCidFromLocation,
} from './player-query'

describe('player query helpers', () => {
  it('reads bootstrap config from location search', () => {
    expect(readPlayerBootstrapConfig('?pickCode=abc&traceId=t1&clickTs=123')).toEqual({
      pickCode: 'abc',
      traceId: 't1',
      clickTs: 123,
    })
  })

  it('reads cid and sanitized path from location search', () => {
    expect(readPlaylistCidFromLocation('?cid=88')).toBe('88')
    expect(readPathFromLocation(`?path=${encodeURIComponent(JSON.stringify([{ cid: '1', name: '目录' }, { cid: '', name: 'bad' }]))}`)).toEqual([
      { cid: '1', name: '目录' },
    ])
  })

  it('builds stable navigation urls', () => {
    expect(buildNavigateToVideoUrl('/player', '?cid=88', 'next123', '下一集')).toBe('/player?cid=88&pick_code=next123&pickCode=next123&title=%E4%B8%8B%E4%B8%80%E9%9B%86')
    expect(buildUpdatedMarkedUrl('/player', '?pickCode=abc', true)).toBe('/player?pickCode=abc&marked=1')
  })

  it('reads overlay meta from location search', () => {
    expect(readOverlayMetaQuery('?title=视频A&fileSize=1GB&fileId=9&cid=3&marked=1')).toEqual({
      title: '视频A',
      fileSize: '1GB',
      fileId: '9',
      cid: '3',
      parentId: '3',
      isMarked: true,
      path: [],
    })
  })
})
