import { describe, expect, it } from 'vitest'
import { OP_COPY, OP_LABEL, sanitizeOperatorDisplayText } from './operator-vocabulary'

describe('operator-vocabulary', () => {
  it('sanitizes backend metric copy for operator display', () => {
    expect(sanitizeOperatorDisplayText('Committed delivery_logs telemetry rows')).toContain('delivery records')
    expect(sanitizeOperatorDisplayText('StreamRunner execution')).toContain('stream pipeline')
    expect(sanitizeOperatorDisplayText('Route send failed')).toBe(OP_LABEL.deliveryFailed)
    expect(sanitizeOperatorDisplayText('Open Runtime')).toBe(OP_LABEL.viewDeliveryActivity)
  })

  it('does not expose forbidden engine terms in operator labels', () => {
    const forbidden = ['StreamRunner', 'delivery_logs', 'runtime_engine', 'policy_engine', 'protection_engine']
    const corpus = [...Object.values(OP_LABEL), ...Object.values(OP_COPY)].join(' ')
    for (const term of forbidden) {
      expect(corpus.toLowerCase()).not.toContain(term.toLowerCase())
    }
  })
})
