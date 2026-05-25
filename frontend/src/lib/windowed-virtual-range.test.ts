import { describe, expect, it } from 'vitest'
import { computeWindowedRange } from './windowed-virtual-range'

describe('computeWindowedRange', () => {
  it('returns empty range for zero items', () => {
    expect(computeWindowedRange(0, 400, 0, 50)).toEqual({
      startIndex: 0,
      endIndex: -1,
      offsetTop: 0,
      totalSize: 0,
    })
  })

  it('windows visible indices with overscan', () => {
    const r = computeWindowedRange(500, 400, 100, 50, 2)
    expect(r.startIndex).toBe(8)
    expect(r.endIndex).toBeGreaterThan(r.startIndex)
    expect(r.totalSize).toBe(5000)
  })
})
