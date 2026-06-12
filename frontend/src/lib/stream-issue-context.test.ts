import { describe, expect, it } from 'vitest'
import { deriveStreamHeroHeadline, issueChipLabel, issueWhySummary } from './stream-issue-context'

describe('stream-issue-context', () => {
  const base = {
    id: '42',
    status: 'RUNNING' as const,
    connectorName: 'Okta Prod',
    deliveryPctKnown: true,
    deliveryPct: 99,
    routesError: 0,
    lastActivityRelative: '2m ago',
    recentErrors: [],
  }

  it('derives healthy headline', () => {
    expect(deriveStreamHeroHeadline('RUNNING', 0, true, 99)).toBe('Stream Healthy')
  })

  it('derives delivery delayed headline', () => {
    expect(deriveStreamHeroHeadline('DEGRADED', 0, true, 80)).toBe('Delivery Delayed')
  })

  it('summarizes why from recent errors', () => {
    const why = issueWhySummary({
      ...base,
      recentErrors: [{ message: 'Destination timeout' }],
    })
    expect(why).toBe('Destination timeout')
  })

  it('labels healthy chip', () => {
    expect(issueChipLabel(base)).toBe('Healthy')
  })
})
