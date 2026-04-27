import { describe, expect, it } from 'vitest'
import { buildNavControlItem } from './player-center-controls'

describe('player center controls helpers', () => {
  it('renders previous nav control config', () => {
    const item = buildNavControlItem({
      controlName: 'prev',
      direction: 'prev',
      index: 9,
      enabled: true,
      title: '上一集：测试',
      onClick: () => {},
    })

    expect(item.position).toBe('left')
    expect(item.html).toContain('m115-nav-control-button')
    expect(item.tooltip).toBe('上一集：测试')
  })

  it('marks disabled nav control config', () => {
    const item = buildNavControlItem({
      controlName: 'next',
      direction: 'next',
      index: 11,
      enabled: false,
      title: '没有下一集',
      onClick: () => {},
    })

    expect(item.html).toContain('is-disabled')
    expect(item.style.opacity).toBe('.38')
  })
})
