import { describe, expect, it } from 'vitest'
import type { DestinationListItem } from '../../api/gdcDestinations'
import type { OperationalSnapshotResponse } from '../../api/operationalSnapshot'
import {
  buildDestinationRuntimeLookup,
  listRuntimeMetricsForDestination,
} from './destination-runtime-metrics'

function catalogRow(id: number, enabled = true): DestinationListItem {
  return {
    id,
    name: `Dest ${id}`,
    destination_type: 'SYSLOG_UDP',
    config_json: { host: '10.0.0.1', port: 514 },
    rate_limit_json: {},
    enabled,
    streams_using_count: 2,
    routes: [
      { route_id: 10, stream_id: 1, stream_name: 'Stream A', route_enabled: true, route_status: 'ENABLED' },
      { route_id: 11, stream_id: 2, stream_name: 'Stream B', route_enabled: true, route_status: 'ENABLED' },
    ],
    created_at: null,
    updated_at: null,
  }
}

describe('destination-runtime-metrics', () => {
  it('builds list runtime metrics from operational snapshot only', () => {
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
        total_eps_1m: 10,
        total_eps_5m: 10,
        avg_latency_ms: 12,
        last_activity_at: null,
      },
      streams: [],
      routes: [],
      destinations: [
        {
          destination_id: 7,
          destination_name: 'Dest 7',
          destination_type: 'SYSLOG_UDP',
          enabled: true,
          health_status: 'HEALTHY',
          inbound_eps_1m: 4.2,
          failed_eps_1m: 0.8,
          avg_latency_ms: 10,
          route_count: 2,
          last_success_at: null,
          last_error_at: null,
          last_error_message: null,
        },
      ],
      problems: [],
      updated_at: '2026-06-22T00:00:00Z',
    }
    const lookup = buildDestinationRuntimeLookup(snapshot)
    const metrics = listRuntimeMetricsForDestination(catalogRow(7), lookup)
    expect(metrics.connectedStreams).toBe(2)
    expect(metrics.connectedRoutes).toBe(2)
    expect(metrics.currentEps).toBe(4.2)
    expect(metrics.successRatePct).toBeCloseTo(84, 1)
    expect(metrics.health).toBe('Healthy')
  })

  it('returns idle health without snapshot row instead of fake healthy', () => {
    const lookup = buildDestinationRuntimeLookup(null)
    const metrics = listRuntimeMetricsForDestination(catalogRow(99), lookup)
    expect(metrics.currentEps).toBeNull()
    expect(metrics.successRatePct).toBeNull()
    expect(metrics.health).toBe('Idle')
  })

  it('shows healthy when connectivity test passed but runtime snapshot is absent', () => {
    const lookup = buildDestinationRuntimeLookup(null)
    const row = {
      ...catalogRow(99),
      last_connectivity_test_success: true,
      last_connectivity_test_at: '2026-06-23T10:00:00Z',
    }
    const metrics = listRuntimeMetricsForDestination(row, lookup)
    expect(metrics.health).toBe('Healthy')
  })

  it('prefers healthy over critical snapshot when no delivery traffic yet', () => {
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
        total_eps_1m: 0,
        total_eps_5m: 0,
        avg_latency_ms: null,
        last_activity_at: null,
      },
      streams: [],
      routes: [],
      destinations: [
        {
          destination_id: 99,
          destination_name: 'Dest 99',
          destination_type: 'SYSLOG_TCP',
          enabled: true,
          health_status: 'ERROR',
          inbound_eps_1m: 0,
          failed_eps_1m: 0,
          avg_latency_ms: null,
          route_count: 1,
          last_success_at: null,
          last_error_at: null,
          last_error_message: null,
        },
      ],
      problems: [],
      updated_at: '2026-06-22T00:00:00Z',
    }
    const lookup = buildDestinationRuntimeLookup(snapshot)
    const row = {
      ...catalogRow(99),
      last_connectivity_test_success: true,
      last_connectivity_test_at: '2026-06-23T10:00:00Z',
    }
    const metrics = listRuntimeMetricsForDestination(row, lookup)
    expect(metrics.health).toBe('Healthy')
  })
})
