import { describe, expect, it } from 'vitest'
import {
  deriveOverallHealth,
  deriveOperationalIssues,
  deriveRecentAlertsSummary,
  deriveTrafficOverview,
} from './dashboard-charter-metrics'
import type { DashboardSummaryResponse, HealthOverviewResponse, ObservabilitySummaryResponse } from '../../api/types/gdcApi'

const health = (): HealthOverviewResponse => ({
  time: { window: '1h', since: '2026-01-01T00:00:00Z', until: '2026-01-01T01:00:00Z' },
  filters: { stream_id: null, route_id: null, destination_id: null },
  scoring_mode: 'current_runtime',
  streams: { healthy: 5, degraded: 2, unhealthy: 1, critical: 0, excluded_no_outcome: 3 },
  routes: { healthy: 8, degraded: 0, unhealthy: 0, critical: 0 },
  destinations: { healthy: 2, degraded: 1, unhealthy: 0, critical: 0 },
  average_stream_score: 80,
  average_route_score: 90,
  average_destination_score: 95,
  worst_routes: [],
  worst_streams: [],
  worst_destinations: [],
})

describe('dashboard-charter-metrics', () => {
  it('derives overall health posture from stream breakdown', () => {
    expect(deriveOverallHealth(health())).toEqual({
      healthy: 5,
      warning: 2,
      critical: 1,
      posture: 'critical',
    })
  })

  it('derives traffic overview from observability totals', () => {
    const observability: ObservabilitySummaryResponse = {
      snapshot_id: 's1',
      generated_at: '2026-01-01T01:00:00Z',
      window: '1h',
      window_start: '2026-01-01T00:00:00Z',
      window_end: '2026-01-01T01:00:00Z',
      metric_contract_version: 'v1',
      totals: {
        streams_total: 10,
        streams_running: 7,
        routes_total: 12,
        routes_enabled: 11,
        healthy_routes: 9,
        idle_routes: 1,
        unhealthy_routes: 1,
        delivery_success_events: 90,
        delivery_failed_events: 10,
        retry_success_events: 0,
        retry_failed_events: 0,
        runtime_telemetry_rows: 100,
        lifecycle_rows: 0,
        processed_events: 500,
        throughput_eps: 1,
        p95_latency_ms: null,
      },
      metric_contract: {},
      metric_meta: {},
    }
    expect(deriveTrafficOverview(observability, null, '1h')).toEqual({
      incomingEvents: 500,
      outgoingEvents: 90,
      deliverySuccessRatePct: 90,
      windowLabel: '1h',
    })
  })

  it('derives operational issues from health and dashboard summary', () => {
    const dashboard: DashboardSummaryResponse = {
      summary: {
        total_streams: 10,
        running_streams: 7,
        paused_streams: 0,
        error_streams: 0,
        stopped_streams: 0,
        rate_limited_source_streams: 0,
        rate_limited_destination_streams: 2,
        total_routes: 10,
        enabled_routes: 10,
        disabled_routes: 0,
        total_destinations: 2,
        enabled_destinations: 2,
        disabled_destinations: 0,
        recent_logs: 0,
        recent_successes: 0,
        recent_failures: 0,
        recent_rate_limited: 0,
        processed_events: 0,
        delivery_outcome_events: 0,
      },
      recent_problem_routes: [],
      recent_rate_limited_routes: [],
      recent_unhealthy_streams: [],
    }
    expect(deriveOperationalIssues(health(), dashboard, [])).toEqual({
      noDataStreams: 3,
      lowVolumeStreams: 2,
      schemaDriftCount: null,
      destinationCapacityWarnings: 2,
    })
  })

  it('summarizes alert presence without detail', () => {
    expect(
      deriveRecentAlertsSummary([
        { stream_id: 1, stream_name: 'A', connector_name: 'C', severity: 'ERROR', count: 3, latest_occurrence: '2026-01-01T00:00:00Z' },
        { stream_id: 2, stream_name: 'B', connector_name: 'D', severity: 'WARN', count: 1, latest_occurrence: '2026-01-01T00:05:00Z' },
      ]),
    ).toEqual({ total: 2, critical: 1, warning: 1, hasAlerts: true })
  })
})
