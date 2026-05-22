import { describe, expect, it } from 'vitest'
import type { OperationalSnapshotResponse } from '../../api/operationalSnapshot'
import {
  countHealthBuckets,
  resolveUrlFiltersFromSnapshot,
  sortProblems,
  streamMatchesTab,
} from './runtime-overview-helpers'

const baseSnapshot: OperationalSnapshotResponse = {
  global: {
    health_status: 'HEALTHY',
    total_streams: 2,
    enabled_streams: 2,
    running_streams: 1,
    error_streams: 0,
    total_routes: 2,
    enabled_routes: 2,
    total_destinations: 1,
    enabled_destinations: 1,
    total_eps_1m: 0,
    total_eps_5m: 0,
    avg_latency_ms: null,
    last_activity_at: null,
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
      avg_latency_ms: 10,
      route_count: 1,
      healthy_route_count: 1,
      failed_route_count: 0,
      last_success_at: null,
      last_error_at: null,
      last_error_message: null,
      checkpoint_updated_at: null,
      checkpoint_lag_seconds: null,
    },
    {
      stream_id: 2,
      stream_name: 'B',
      connector_id: 1,
      source_id: 1,
      enabled: false,
      status: 'STOPPED',
      health_status: 'IDLE',
      eps_1m: 0,
      eps_5m: 0,
      success_rate_5m: 0,
      failure_rate_5m: 0,
      avg_latency_ms: null,
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
  routes: [
    {
      route_id: 10,
      stream_id: 1,
      stream_name: 'A',
      destination_id: 3,
      destination_name: 'D',
      destination_type: 'WEBHOOK_POST',
      enabled: true,
      failure_policy: 'LOG_AND_CONTINUE',
      health_status: 'ERROR',
      delivered_eps_1m: 0,
      failed_eps_1m: 1,
      success_rate_5m: 50,
      retry_rate_5m: 12,
      avg_latency_ms: 20,
      last_success_at: null,
      last_error_at: '2026-05-22T11:00:00Z',
      last_error_message: 'timeout',
    },
  ],
  destinations: [],
  problems: [
    {
      severity: 'warning',
      scope: 'stream',
      stream_id: 1,
      route_id: null,
      destination_id: null,
      title: 'Warn',
      message: 'm',
      last_seen_at: '2026-05-22T10:00:00Z',
    },
    {
      severity: 'critical',
      scope: 'route',
      stream_id: 1,
      route_id: 10,
      destination_id: null,
      title: 'Crit',
      message: 'm',
      last_seen_at: '2026-05-22T11:00:00Z',
    },
  ],
  updated_at: '2026-05-22T12:00:00Z',
}

describe('runtime-overview-helpers', () => {
  it('sorts problems critical before warning', () => {
    const sorted = sortProblems(baseSnapshot.problems)
    expect(sorted[0]?.severity).toBe('critical')
    expect(sorted[1]?.severity).toBe('warning')
  })

  it('resolves route_id to stream from snapshot', () => {
    const r = resolveUrlFiltersFromSnapshot(baseSnapshot, { routeId: 10 })
    expect(r.effectiveStreamId).toBe(1)
    expect(r.error).toBeNull()
  })

  it('detects stream mismatch for route filter', () => {
    const r = resolveUrlFiltersFromSnapshot(baseSnapshot, { streamId: 2, routeId: 10 })
    expect(r.error).toBe('stream_mismatch')
  })

  it('filters streams by health tab', () => {
    const healthy = baseSnapshot.streams[0]!
    const disabled = baseSnapshot.streams[1]!
    expect(streamMatchesTab(healthy, 'healthy')).toBe(true)
    expect(streamMatchesTab(disabled, 'disabled')).toBe(true)
    expect(streamMatchesTab(disabled, 'healthy')).toBe(false)
  })

  it('counts route health buckets', () => {
    const c = countHealthBuckets(baseSnapshot.routes)
    expect(c.error).toBe(1)
  })
})
