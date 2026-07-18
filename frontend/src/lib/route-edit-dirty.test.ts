import { describe, expect, it } from 'vitest'
import { routeEditSnapshotsEqual, type RouteEditDeliverySnapshot } from './route-edit-dirty'

const base = (): RouteEditDeliverySnapshot => ({
  routeName: 'Route A',
  description: 'desc',
  enabled: true,
  deliveryMode: 'Reliable',
  failurePolicy: 'Retry',
  rateLimitEnabled: true,
  perSecond: 10,
  burstSize: 20,
  maxRetry: 3,
  retryBackoff: 'Exponential',
  initialBackoffSec: 1,
  maxBackoffSec: 30,
  maxDeliveryTimeSec: 60,
  batchSize: 50,
  destinationId: 1,
})

describe('route-edit-dirty', () => {
  it('treats identical snapshots as clean', () => {
    expect(routeEditSnapshotsEqual(base(), base())).toBe(true)
  })

  it('detects field-level changes including delivery settings', () => {
    const dirty = { ...base(), maxRetry: 5 }
    expect(routeEditSnapshotsEqual(base(), dirty)).toBe(false)
    expect(routeEditSnapshotsEqual(base(), { ...base(), destinationId: 2 })).toBe(false)
  })
})
