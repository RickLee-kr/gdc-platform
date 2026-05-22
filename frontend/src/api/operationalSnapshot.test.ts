import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as rawApi from '../api'
import {
  clearOperationalSnapshotCache,
  getOperationalSnapshot,
  operationalSnapshotRequestKey,
  type OperationalSnapshotResponse,
} from './operationalSnapshot'

const snapshot: OperationalSnapshotResponse = {
  global: {
    health_status: 'HEALTHY',
    total_streams: 1,
    enabled_streams: 1,
    running_streams: 1,
    error_streams: 0,
    total_routes: 1,
    enabled_routes: 1,
    total_destinations: 1,
    enabled_destinations: 1,
    total_eps_1m: 2.5,
    total_eps_5m: 2.0,
    avg_latency_ms: 12,
    last_activity_at: '2026-05-22T12:00:00Z',
  },
  streams: [],
  routes: [
    {
      route_id: 10,
      stream_id: 1,
      stream_name: 'Alerts',
      destination_id: 2,
      destination_name: 'Webhook',
      destination_type: 'WEBHOOK_POST',
      enabled: true,
      failure_policy: 'LOG_AND_CONTINUE',
      health_status: 'HEALTHY',
      delivered_eps_1m: 1.2,
      failed_eps_1m: 0,
      success_rate_5m: 100,
      retry_rate_5m: 0,
      avg_latency_ms: 15,
      last_success_at: '2026-05-22T12:00:00Z',
      last_error_at: null,
      last_error_message: null,
    },
  ],
  destinations: [],
  problems: [],
  updated_at: '2026-05-22T12:00:00Z',
}

describe('getOperationalSnapshot', () => {
  beforeEach(() => {
    clearOperationalSnapshotCache()
    vi.restoreAllMocks()
  })

  it('calls GET /api/v1/runtime/operational-snapshot', async () => {
    const spy = vi.spyOn(rawApi, 'safeRequestJson').mockResolvedValue(snapshot)
    const res = await getOperationalSnapshot()
    expect(res?.routes[0]?.route_id).toBe(10)
    expect(spy).toHaveBeenCalledTimes(1)
    expect(String(spy.mock.calls[0]?.[0])).toBe('/api/v1/runtime/operational-snapshot')
  })

  it('deduplicates in-flight requests', async () => {
    const spy = vi.spyOn(rawApi, 'safeRequestJson').mockResolvedValue(snapshot)
    await Promise.all([getOperationalSnapshot(), getOperationalSnapshot()])
    expect(spy).toHaveBeenCalledTimes(1)
    expect(operationalSnapshotRequestKey()).toBe('latest')
  })
})
