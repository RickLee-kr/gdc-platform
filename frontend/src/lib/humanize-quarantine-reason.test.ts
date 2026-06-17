import { describe, expect, it } from 'vitest'
import { humanizeQuarantineReason } from './humanize-quarantine-reason'

describe('humanizeQuarantineReason', () => {
  it('humanizes schema drift unknown sensitive', () => {
    expect(humanizeQuarantineReason('policy:schema_drift:unknown_sensitive')).toBe(
      'Schema Drift Policy — Unknown Sensitive Field',
    )
  })

  it('humanizes schema drift unknown normal', () => {
    expect(humanizeQuarantineReason('policy:schema_drift:unknown_normal')).toBe(
      'Schema Drift Policy — Unknown Normal Field',
    )
  })

  it('humanizes governance policy rule', () => {
    expect(humanizeQuarantineReason('policy:Customer PII Policy')).toBe('Policy Rule — Customer PII Policy')
  })

  it('shows manual quarantine when source is manual', () => {
    expect(humanizeQuarantineReason('operator_hold', { quarantineSource: 'manual' })).toBe('Manual Quarantine')
  })
})
