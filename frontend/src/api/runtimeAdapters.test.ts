import { describe, expect, it } from 'vitest'
import type { LogExplorerRow } from '../components/logs/logs-types'
import { logsOverviewCounts } from './logsOverviewAdapter'
import {
  buildRuntimeDetailNumericOverlay,
  formatRouteHealthDestination,
  formatRouteHealthTypeLabel,
  mergeStreamHealthSignals,
  routeHealthRowsFromApi,
} from './runtimeHealthAdapter'
import { mapBackendStreamStatus } from './streamRows'
import { timelineItemsToRecentLogLines, timelineItemsToRunHistoryRows } from './runtimeTimelineAdapter'
import type { RouteHealthItem, StreamHealthResponse, StreamRuntimeStatsResponse } from './types/gdcApi'

function routeFixture(overrides: Partial<RouteHealthItem> = {}): RouteHealthItem {
  return {
    route_id: 2,
    destination_id: 40,
    destination_type: 'WEBHOOK',
    route_enabled: true,
    destination_enabled: true,
    failure_policy: 'retry',
    route_status: 'ENABLED',
    health: 'HEALTHY',
    success_count: 8,
    failure_count: 2,
    rate_limited_count: 0,
    consecutive_failure_count: 0,
    ...overrides,
  }
}

describe('mapBackendStreamStatus', () => {
  it('maps null/blank to UNKNOWN', () => {
    expect(mapBackendStreamStatus(null)).toBe('UNKNOWN')
    expect(mapBackendStreamStatus(undefined)).toBe('UNKNOWN')
    expect(mapBackendStreamStatus('   ')).toBe('UNKNOWN')
  })

  it('maps known backend literals', () => {
    expect(mapBackendStreamStatus('RUNNING')).toBe('RUNNING')
    expect(mapBackendStreamStatus('ERROR')).toBe('ERROR')
    expect(mapBackendStreamStatus('RATE_LIMITED_SOURCE')).toBe('DEGRADED')
    expect(mapBackendStreamStatus('PAUSED')).toBe('STOPPED')
    expect(mapBackendStreamStatus('IDLE')).toBe('STOPPED')
  })

  it('maps unrecognized strings to UNKNOWN', () => {
    expect(mapBackendStreamStatus('MY_NEW_STATE')).toBe('UNKNOWN')
  })
})

describe('logsOverviewCounts', () => {
  it('returns zeros for null/undefined input', () => {
    expect(logsOverviewCounts(null)).toEqual({ total: 0, errors: 0, warnings: 0, info: 0, debug: 0 })
    expect(logsOverviewCounts(undefined)).toEqual({ total: 0, errors: 0, warnings: 0, info: 0, debug: 0 })
  })

  it('counts levels', () => {
    const rows: LogExplorerRow[] = [
      {
        id: '1',
        eventId: 'e1',
        timeIso: '2026-01-01T00:00:00Z',
        level: 'ERROR',
        connector: '—',
        stream: '—',
        route: '—',
        message: 'x',
        durationMs: 0,
        contextJson: {},
        relatedEventId: null,
      },
      {
        id: '2',
        eventId: 'e2',
        timeIso: '2026-01-01T00:00:01Z',
        level: 'WARN',
        connector: '—',
        stream: '—',
        route: '—',
        message: 'y',
        durationMs: 0,
        contextJson: {},
        relatedEventId: null,
      },
      {
        id: '3',
        eventId: 'e3',
        timeIso: '2026-01-01T00:00:02Z',
        level: 'INFO',
        connector: '—',
        stream: '—',
        route: '—',
        message: 'z',
        durationMs: 0,
        contextJson: {},
        relatedEventId: null,
      },
    ]
    expect(logsOverviewCounts(rows)).toEqual({ total: 3, errors: 1, warnings: 1, info: 1, debug: 0 })
  })
})

describe('runtimeHealthAdapter labels', () => {
  it('formats destination line readably', () => {
    expect(formatRouteHealthDestination({ route_id: 5, destination_id: 12 })).toBe('Destination #12 · Route #5')
    expect(formatRouteHealthDestination({ route_id: 5, destination_id: 12, destination_name: 'Main Syslog' })).toBe(
      'Main Syslog · Route #5',
    )
  })

  it('notes disabled routes in type label', () => {
    expect(
      formatRouteHealthTypeLabel({
        destination_type: 'WEBHOOK',
        route_enabled: false,
        destination_enabled: true,
      }),
    ).toContain('off')
  })
})

describe('routeHealthRowsFromApi', () => {
  it('returns null without routes', () => {
    expect(routeHealthRowsFromApi(null)).toBeNull()
    expect(
      routeHealthRowsFromApi({
        stream_id: 1,
        stream_status: 'RUNNING',
        health: 'HEALTHY',
        limit: 50,
        summary: {
          total_routes: 0,
          healthy_routes: 0,
          degraded_routes: 0,
          unhealthy_routes: 0,
          disabled_routes: 0,
          idle_routes: 0,
        },
        routes: [],
      }),
    ).toBeNull()
  })

  it('avoids NaN delivery pct when counts are zero', () => {
    const health: StreamHealthResponse = {
      stream_id: 1,
      stream_status: 'RUNNING',
      health: 'DEGRADED',
      limit: 80,
      summary: {
        total_routes: 1,
        healthy_routes: 0,
        degraded_routes: 1,
        unhealthy_routes: 0,
        disabled_routes: 0,
        idle_routes: 0,
      },
      routes: [routeFixture({ success_count: 0, failure_count: 0, health: 'IDLE' })],
    }
    const rows = routeHealthRowsFromApi(health)
    expect(rows).not.toBeNull()
    expect(rows![0]!.deliveryPct).toBe(0)
    expect(Number.isFinite(rows![0]!.deliveryPct)).toBe(true)
    expect(rows![0]!.status).toBe('Degraded')
  })

  it('maps unknown health to Unknown', () => {
    const health: StreamHealthResponse = {
      stream_id: 1,
      stream_status: 'RUNNING',
      health: 'DEGRADED',
      limit: 80,
      summary: {
        total_routes: 1,
        healthy_routes: 0,
        degraded_routes: 0,
        unhealthy_routes: 0,
        disabled_routes: 0,
        idle_routes: 0,
      },
      routes: [routeFixture({ health: 'SOMETHING_NEW' as never })],
    }
    const rows = routeHealthRowsFromApi(health)
    expect(rows?.[0]?.status).toBe('Unknown')
  })
})

describe('mergeStreamHealthSignals', () => {
  it('keeps finite error rate and stable labels with empty attempts', () => {
    const base = [
      { label: 'Error Rate (1h)', value: 'x', tone: 'neutral' as const },
      { label: 'Successive Failures', value: '0', tone: 'neutral' as const },
      { label: 'Polling', value: 'x', tone: 'neutral' as const },
    ]
    const stats: StreamRuntimeStatsResponse = {
      stream_id: 1,
      stream_status: 'RUNNING',
      checkpoint: null,
      summary: {
        total_logs: 0,
        route_send_success: 0,
        route_send_failed: 0,
        route_retry_success: 0,
        route_retry_failed: 0,
        route_skip: 0,
        source_rate_limited: 0,
        destination_rate_limited: 0,
        route_unknown_failure_policy: 0,
        run_complete: 0,
      },
      last_seen: { success_at: null, failure_at: null, rate_limited_at: null },
      routes: [],
      recent_logs: [],
    }
    const health: StreamHealthResponse = {
      stream_id: 1,
      stream_status: 'RUNNING',
      health: 'HEALTHY',
      limit: 50,
      summary: {
        total_routes: 1,
        healthy_routes: 1,
        degraded_routes: 0,
        unhealthy_routes: 0,
        disabled_routes: 0,
        idle_routes: 0,
      },
      routes: [routeFixture({ consecutive_failure_count: 0 })],
    }
    const merged = mergeStreamHealthSignals(base, stats, health)
    expect(merged[0]?.value).toBe('0.00%')
    expect(merged[0]?.tone).toBe('ok')
    expect(merged[1]?.value).toBe('0')
    expect(merged[2]?.detail).toContain('runtime API data')
  })
})

describe('buildRuntimeDetailNumericOverlay', () => {
  it('leaves delivery null when no send attempts', () => {
    const stats: StreamRuntimeStatsResponse = {
      stream_id: 1,
      stream_status: 'RUNNING',
      checkpoint: null,
      summary: {
        total_logs: 0,
        route_send_success: 0,
        route_send_failed: 0,
        route_retry_success: 0,
        route_retry_failed: 0,
        route_skip: 0,
        source_rate_limited: 0,
        destination_rate_limited: 0,
        route_unknown_failure_policy: 0,
        run_complete: 0,
      },
      last_seen: { success_at: null, failure_at: null, rate_limited_at: null },
      routes: [],
      recent_logs: [],
    }
    const o = buildRuntimeDetailNumericOverlay(stats, null)
    expect(o.deliveryPct).toBeNull()
    expect(o.eventsPerMinApprox).toBe(0)
  })
})

describe('runtimeTimelineAdapter', () => {
  it('returns empty arrays for null/undefined items', () => {
    expect(timelineItemsToRunHistoryRows(null)).toEqual([])
    expect(timelineItemsToRecentLogLines(undefined)).toEqual([])
  })

  it('guards missing timestamps and latency', () => {
    const rows = timelineItemsToRunHistoryRows([
      {
        id: 1,
        created_at: '',
        stream_id: null,
        route_id: null,
        destination_id: null,
        stage: 'route_send',
        level: 'INFO',
        status: null,
        message: 'ok',
        error_code: null,
        retry_count: 0,
        http_status: null,
        latency_ms: Number.NaN,
      },
    ])
    expect(rows[0]!.startedAt).toBe('—')
    expect(rows[0]!.duration).toBe('—')
  })
})
