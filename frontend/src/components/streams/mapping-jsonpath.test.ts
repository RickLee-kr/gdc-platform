import { describe, expect, it } from 'vitest'
import { resolveJsonPath } from './mapping-jsonpath'

describe('resolveJsonPath', () => {
  const doc = {
    data: [
      {
        malop: { id: 'x', score: 3 },
        behavior: [{ score: 82 }],
      },
    ],
  }

  it('resolves nested object paths', () => {
    expect(resolveJsonPath(doc, '$')).toEqual(doc)
    expect(resolveJsonPath(doc, '$.data[0].malop.id')).toBe('x')
    expect(resolveJsonPath(doc, '$.data[0].behavior[0].score')).toBe(82)
  })

  it('returns undefined for invalid paths', () => {
    expect(resolveJsonPath(doc, '$.missing')).toBeUndefined()
    expect(resolveJsonPath(doc, '$.data[99]')).toBeUndefined()
  })
})
