import { describe, expect, it } from 'vitest'
import { buildRouteConsoleRows } from './routes-overview-helpers'
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
