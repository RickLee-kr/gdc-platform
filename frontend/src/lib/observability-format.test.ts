import { describe, expect, it } from 'vitest'
import { formatThroughputEps } from './observability-format'

describe('formatThroughputEps', () => {
  it('does not round non-zero throughput to zero', () => {
    expect(formatThroughputEps(1.234)).toBe('1.23')
    expect(formatThroughputEps(0.01234)).toBe('0.012')
    expect(formatThroughputEps(0.001)).toBe('<0.01')
    expect(formatThroughputEps(0)).toBe('0')
  })
})

