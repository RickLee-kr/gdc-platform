import { describe, expect, it } from 'vitest'
import type { OperationalSnapshotResponse } from '../../api/operationalSnapshot'
import {
  buildRouteConsoleRows,
  buildRouteRowsFromOperationalSnapshot,
  formatEps,
  formatSuccessRate,
  getLastActivityAt,
  getRouteHealthPresentation,
  getRouteProblemSummary,
  metricsFromOperationalRoute,
} from './routes-overview-helpers'
import type { RouteRead } from '../../api/gdcRoutes'
import type { DestinationListItem } from '../../api/gdcDestinations'
import type { RouteHealthRow, StreamRead } from '../../api/types/gdcApi'

describe('buildRouteConsoleRows', () => {
  it('uses backend route health rows before local metrics classification', () => {
    const routes: RouteRead[] = [
      {
        id: 10,
        stream_id: 1,
        destination_id: 2,
        name: 'r',
        enabled: true,
        failure_policy: 'LOG_AND_CONTINUE',
        formatter_config_json: {},
        rate_limit_json: {},
        status: 'ENABLED',
      },
    ]
    const streams: StreamRead[] = [{ id: 1, name: 's', connector_id: 1, source_id: 1, status: 'RUNNING' }]
    const destinations: DestinationListItem[] = [
      {
        id: 2,
        name: 'd',
        destination_type: 'WEBHOOK_POST',
        enabled: true,
        config_json: {},
        rate_limit_json: {},
        created_at: null,
        updated_at: null,
        streams_using_count: 1,
        routes: [],
      },
    ]
    const healthByRouteId = new Map<number, RouteHealthRow>([
      [
        10,
        {
          route_id: 10,
          stream_id: 1,
          destination_id: 2,
          score: 75,
          level: 'DEGRADED',
          factors: [],
          metrics: {
            failure_count: 0,
            success_count: 10,
            retry_event_count: 0,
            retry_count_sum: 0,
            failure_rate: 0,
            retry_rate: 0,
            latency_ms_avg: null,
            latency_ms_p95: null,
            last_failure_at: null,
            last_success_at: null,
            historical_failure_count: 0,
            historical_delivery_failure_rate: 0,
            live_delivery_failure_rate: 0,
            recent_success_ratio: 1,
            health_recovery_score: 1,
            recent_failure_count: 0,
            recent_success_count: 10,
            recent_failure_rate: 0,
            recent_window_since: null,
            recent_window_until: null,
            current_runtime_health: null,
          },
        },
      ],
    ])

    const rows = buildRouteConsoleRows(routes, streams, destinations, new Map(), healthByRouteId)
    expect(rows[0]?.uiStatus).toBe('Warning')
  })
})

describe('buildRouteRowsFromOperationalSnapshot', () => {
  const snapshot: OperationalSnapshotResponse = {
    global: {
      health_status: 'DEGRADED',
      total_streams: 1,
      enabled_streams: 1,
      running_streams: 1,
      error_streams: 0,
      total_routes: 1,
      enabled_routes: 1,
      total_destinations: 1,
      enabled_destinations: 1,
      total_eps_1m: 1,
      total_eps_5m: 1,
      avg_latency_ms: 20,
      last_activity_at: '2026-05-22T11:00:00Z',
    },
    streams: [],
    routes: [
      {
        route_id: 42,
        stream_id: 7,
        stream_name: 'Ops stream',
        destination_id: 9,
        destination_name: 'Syslog sink',
        destination_type: 'SYSLOG_UDP',
        enabled: true,
        failure_policy: 'RETRY_AND_BACKOFF',
        health_status: 'DEGRADED',
        delivered_eps_1m: 3.5,
        failed_eps_1m: 0.2,
        success_rate_5m: 92.5,
        retry_rate_5m: 4,
        avg_latency_ms: 180,
        last_success_at: '2026-05-22T11:59:00Z',
        last_error_at: '2026-05-22T11:58:00Z',
        last_error_message: 'connection reset',
      },
    ],
    destinations: [],
    problems: [],
    updated_at: '2026-05-22T12:00:00Z',
  }

  it('maps snapshot route fields into console rows', () => {
    const rows = buildRouteRowsFromOperationalSnapshot(snapshot, [])
    expect(rows).toHaveLength(1)
    expect(rows[0]?.uiStatus).toBe('Warning')
    expect(rows[0]?.stream?.name).toBe('Ops stream')
    expect(rows[0]?.destination?.name).toBe('Syslog sink')
    expect(rows[0]?.metrics?.eps_current).toBe(3.5)
    expect(rows[0]?.metrics?.success_rate).toBe(92.5)
    expect(rows[0]?.metrics?.avg_latency_ms).toBe(180)
    expect(rows[0]?.metrics?.last_error_message).toBe('connection reset')
  })

  it('exposes snapshot helper utilities', () => {
    const route = snapshot.routes[0]!
    expect(getRouteHealthPresentation(route.health_status).uiStatus).toBe('Warning')
    expect(formatEps(route.delivered_eps_1m)).toContain('3.5')
    expect(formatSuccessRate(route.success_rate_5m)).toBe('92.5%')
    expect(getLastActivityAt(route)).toBe('2026-05-22T11:59:00Z')
    expect(getRouteProblemSummary(route)).toBe('connection reset')
    expect(metricsFromOperationalRoute(route).failed_last_hour).toBe(Math.round(0.2 * 60))
  })
})
