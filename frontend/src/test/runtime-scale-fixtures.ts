import type { OperationalSnapshotResponse, OperationalStreamSnapshot } from '../api/operationalSnapshot'
import type { RouteRead } from '../api/gdcRoutes'

function baseStream(id: number, name: string): OperationalStreamSnapshot {
  return {
    stream_id: id,
    stream_name: name,
    connector_id: 1,
    source_id: 1,
    enabled: true,
    status: 'RUNNING',
    health_status: id % 7 === 0 ? 'ERROR' : id % 5 === 0 ? 'DEGRADED' : 'HEALTHY',
    eps_1m: id % 10,
    eps_5m: id % 10,
    success_rate_5m: 95,
    failure_rate_5m: 5,
    avg_latency_ms: 20,
    route_count: 1,
    healthy_route_count: 1,
    failed_route_count: 0,
    last_success_at: '2026-05-22T12:00:00Z',
    last_error_at: null,
    last_error_message: null,
    checkpoint_updated_at: null,
    checkpoint_lag_seconds: null,
  }
}

export function buildOperationalSnapshotWithStreams(streamCount: number): OperationalSnapshotResponse {
  const streams = Array.from({ length: streamCount }, (_, i) => baseStream(i + 1, `Scale Stream ${i + 1}`))
  return {
    global: {
      health_status: 'HEALTHY',
      total_streams: streamCount,
      enabled_streams: streamCount,
      running_streams: streamCount,
      error_streams: 0,
      total_routes: 0,
      enabled_routes: 0,
      total_destinations: 0,
      enabled_destinations: 0,
      total_eps_1m: streamCount,
      total_eps_5m: streamCount,
      avg_latency_ms: 20,
      last_activity_at: '2026-05-22T12:00:00Z',
    },
    streams,
    routes: [],
    destinations: [],
    problems: [],
    updated_at: '2026-05-22T12:05:00Z',
  }
}

export function buildOperationalSnapshotWithRoutes(routeCount: number): OperationalSnapshotResponse {
  const routes = Array.from({ length: routeCount }, (_, i) => {
    const routeId = i + 1
    return {
      route_id: routeId,
      stream_id: 1,
      stream_name: 'Scale Stream 1',
      destination_id: 2,
      destination_name: 'Scale Destination',
      destination_type: 'WEBHOOK_POST',
      enabled: true,
      failure_policy: 'LOG_AND_CONTINUE',
      health_status: 'HEALTHY' as const,
      delivered_eps_1m: 1,
      failed_eps_1m: 0,
      success_rate_5m: 100,
      retry_rate_5m: 0,
      avg_latency_ms: 10,
      last_success_at: '2026-05-22T12:00:00Z',
      last_error_at: null,
      last_error_message: null,
    }
  })
  return {
    global: {
      health_status: 'HEALTHY',
      total_streams: 1,
      enabled_streams: 1,
      running_streams: 1,
      error_streams: 0,
      total_routes: routeCount,
      enabled_routes: routeCount,
      total_destinations: 1,
      enabled_destinations: 1,
      total_eps_1m: routeCount,
      total_eps_5m: routeCount,
      avg_latency_ms: 10,
      last_activity_at: '2026-05-22T12:00:00Z',
    },
    streams: [baseStream(1, 'Scale Stream 1')],
    routes,
    destinations: [
      {
        destination_id: 2,
        destination_name: 'Scale Destination',
        destination_type: 'WEBHOOK_POST',
        enabled: true,
        health_status: 'HEALTHY',
        inbound_eps_1m: routeCount,
        failed_eps_1m: 0,
        avg_latency_ms: 10,
        route_count: routeCount,
        last_success_at: null,
        last_error_at: null,
        last_error_message: null,
      },
    ],
    problems: [],
    updated_at: '2026-05-22T12:05:00Z',
  }
}

export function buildRouteReadList(routeCount: number): RouteRead[] {
  return Array.from({ length: routeCount }, (_, i) => ({
    id: i + 1,
    stream_id: 1,
    destination_id: 2,
    enabled: true,
    failure_policy: 'LOG_AND_CONTINUE',
    formatter_config_json: {},
    rate_limit_json: { enabled: false },
    status: 'ENABLED',
  }))
}
