import { describe, expect, it } from 'vitest'
import { parseJsonObject, pickInitialRawResponseFromSourceConfig } from './jsonUtils'

describe('jsonUtils', () => {
  it('parseJsonObject rejects non-object root', () => {
    expect(() => parseJsonObject('[]', 'x')).toThrow(/object/)
  })

  it('pickInitialRawResponseFromSourceConfig prefers sample_payload', () => {
    expect(
      pickInitialRawResponseFromSourceConfig({
        sample_payload: { a: 1 },
        raw_sample_payload: { b: 2 },
      }),
    ).toEqual({ a: 1 })
  })
})
