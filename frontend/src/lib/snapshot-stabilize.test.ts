import { describe, expect, it } from 'vitest'
import type { OperationalSnapshotResponse } from '../api/operationalSnapshot'
import { stabilizeOperationalSnapshot } from './snapshot-stabilize'

function baseSnapshot(): OperationalSnapshotResponse {
  return {
    global: {
      health_status: 'HEALTHY',
      total_streams: 1,
      enabled_streams: 1,
      running_streams: 1,
      error_streams: 0,
      total_routes: 0,
      enabled_routes: 0,
      total_destinations: 0,
      enabled_destinations: 0,
      total_eps_1m: 1,
      total_eps_5m: 1,
      avg_latency_ms: 1,
      last_activity_at: '2026-05-22T12:00:00Z',
    },
    streams: [
      {
        stream_id: 1,
        stream_name: 'A',
        connector_id: 1,
        source_id: 1,
        enabled: true,
        status: 'RUNNING',
        health_status: 'HEALTHY',
        eps_1m: 1,
        eps_5m: 1,
        success_rate_5m: 100,
        failure_rate_5m: 0,
        avg_latency_ms: 1,
        route_count: 0,
        healthy_route_count: 0,
        failed_route_count: 0,
        last_success_at: null,
        last_error_at: null,
        last_error_message: null,
        checkpoint_updated_at: null,
        checkpoint_lag_seconds: null,
      },
    ],
    routes: [],
    destinations: [],
    problems: [],
    updated_at: '2026-05-22T12:00:00Z',
  }
}

describe('stabilizeOperationalSnapshot', () => {
  it('reuses stream object references when metrics unchanged', () => {
    const first = stabilizeOperationalSnapshot(null, baseSnapshot())
    const second = stabilizeOperationalSnapshot(first, { ...baseSnapshot(), updated_at: '2026-05-22T12:00:01Z' })
    expect(second).not.toBe(first)
    expect(second?.streams[0]).toBe(first?.streams[0])
  })

  it('replaces stream reference when eps changes', () => {
    const first = stabilizeOperationalSnapshot(null, baseSnapshot())
    const next = baseSnapshot()
    next.streams[0]!.eps_1m = 99
    const second = stabilizeOperationalSnapshot(first, next)
    expect(second?.streams[0]).not.toBe(first?.streams[0])
  })
})
