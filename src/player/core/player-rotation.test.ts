import { describe, expect, it } from 'vitest'
import { computeRotationScale, getNextRotationDegrees, normalizeRotationDegrees } from './player-rotation'

describe('player rotation helpers', () => {
  it('normalizes rotation degrees to 0-359', () => {
    expect(normalizeRotationDegrees(0)).toBe(0)
    expect(normalizeRotationDegrees(360)).toBe(0)
    expect(normalizeRotationDegrees(450)).toBe(90)
    expect(normalizeRotationDegrees(-90)).toBe(270)
  })

  it('rotates clockwise by 90 degrees each time', () => {
    expect(getNextRotationDegrees(0)).toBe(90)
    expect(getNextRotationDegrees(90)).toBe(180)
    expect(getNextRotationDegrees(270)).toBe(0)
  })

  it('only scales when rotated by 90 or 270 degrees', () => {
    expect(computeRotationScale({
      containerWidth: 1920,
      containerHeight: 1080,
      videoWidth: 1920,
      videoHeight: 1080,
      rotation: 0,
    })).toBe(1)

    expect(computeRotationScale({
      containerWidth: 1920,
      containerHeight: 1080,
      videoWidth: 1920,
      videoHeight: 1080,
      rotation: 90,
    })).toBeCloseTo(0.5625)
  })
})
