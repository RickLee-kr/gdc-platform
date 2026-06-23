import { describe, expect, it } from 'vitest'
import { countOperationalIssues, effectiveStreamSeverity, worstOperationalSeverity } from './stream-operational-status'

describe('stream-operational-status', () => {
  it('flags routesError as warning even when status is RUNNING', () => {
    expect(
      effectiveStreamSeverity({
        status: 'RUNNING',
        routesError: 1,
        deliveryPctKnown: true,
        deliveryPct: 99,
      }),
    ).toBe('warning')
  })

  it('treats idle route counts as healthy when delivery success is strong', () => {
    expect(
      effectiveStreamSeverity({
        status: 'RUNNING',
        routesDegraded: 2,
        routesError: 0,
        deliveryPctKnown: true,
        deliveryPct: 100,
      }),
    ).toBe('healthy')
  })

  it('counts operational issues across rows', () => {
    const count = countOperationalIssues([
      { status: 'RUNNING', routesError: 0, deliveryPctKnown: true, deliveryPct: 99 },
      { status: 'DEGRADED', routesError: 0, deliveryPctKnown: true, deliveryPct: 80 },
      { status: 'ERROR', routesError: 2, deliveryPctKnown: true, deliveryPct: 50 },
    ])
    expect(count).toBe(2)
  })

  it('picks critical over warning for group worst', () => {
    expect(worstOperationalSeverity(['healthy', 'warning', 'critical'])).toBe('critical')
  })
})
