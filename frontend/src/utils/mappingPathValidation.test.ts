import { describe, expect, it } from 'vitest'
import { isEnvelopeRelativeMappingPath } from './mappingPathValidation'

describe('isEnvelopeRelativeMappingPath', () => {
  it('allows extracted-event-relative paths', () => {
    expect(isEnvelopeRelativeMappingPath('$.eventTime', '$.Records', '$.event')).toBe(false)
    expect(isEnvelopeRelativeMappingPath('$.id', '$', '')).toBe(false)
    expect(isEnvelopeRelativeMappingPath('$.user.name', '$.Records', '$.event')).toBe(false)
  })

  it('rejects envelope-relative paths for named arrays', () => {
    expect(isEnvelopeRelativeMappingPath('$.Records[0].event.eventTime', '$.Records', '$.event')).toBe(true)
    expect(isEnvelopeRelativeMappingPath('$.Records[*].event.eventTime', '$.Records', '$.event')).toBe(true)
  })

  it('rejects root-array index paths when event source is $', () => {
    expect(isEnvelopeRelativeMappingPath('$[0].id', '$', '')).toBe(true)
    expect(isEnvelopeRelativeMappingPath('$[*].id', '$', '')).toBe(true)
  })

  it('rejects event-root prefix when root is applied at extraction', () => {
    expect(isEnvelopeRelativeMappingPath('$.event.eventTime', '$.Records', '$.event')).toBe(true)
  })
})
