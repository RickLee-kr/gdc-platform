import { describe, expect, it } from 'vitest'
import { buildMonitoringKpis, donutFromTopStreams, globalErrorRatePct, mergeEventsOverTime } from './runtime-monitoring-aggregates'
import type { DashboardSummaryNumbers } from '../../api/types/gdcApi'
import type { StreamRuntimeMetricsResponse } from '../../api/types/gdcApi'

describe('mergeEventsOverTime', () => {
  it('sums events across streams per timestamp', () => {
    const m = new Map<number, StreamRuntimeMetricsResponse>()
    m.set(1, {
      stream: {
        id: 1,
        name: 'a',
        status: 'RUNNING',
        last_run_at: null,
        last_success_at: null,
        last_error_at: null,
        last_checkpoint: null,
      },
      kpis: {
        events_last_hour: 0,
        delivered_last_hour: 0,
        failed_last_hour: 0,
        delivery_success_rate: 0,
        avg_latency_ms: 0,
        max_latency_ms: 0,
        error_rate: 0,
      },
      events_over_time: [{ timestamp: '2026-01-01T10:00:00Z', events: 3, delivered: 0, failed: 0 }],
      route_health: [],
      checkpoint_history: [],
      recent_runs: [],
    })
    m.set(2, {
      stream: {
        id: 2,
        name: 'b',
        status: 'RUNNING',
        last_run_at: null,
        last_success_at: null,
        last_error_at: null,
        last_checkpoint: null,
      },
      kpis: {
        events_last_hour: 0,
        delivered_last_hour: 0,
        failed_last_hour: 0,
        delivery_success_rate: 0,
        avg_latency_ms: 0,
        max_latency_ms: 0,
        error_rate: 0,
      },
      events_over_time: [{ timestamp: '2026-01-01T10:00:00Z', events: 7, delivered: 0, failed: 0 }],
      route_health: [],
      checkpoint_history: [],
      recent_runs: [],
    })
    const pts = mergeEventsOverTime(m)
    expect(pts).toHaveLength(1)
    expect(pts[0]?.events).toBe(10)
  })
})

describe('buildMonitoringKpis', () => {
  const dash: DashboardSummaryNumbers = {
    total_streams: 4,
    running_streams: 3,
    paused_streams: 0,
    error_streams: 0,
    stopped_streams: 1,
    rate_limited_source_streams: 0,
    rate_limited_destination_streams: 0,
    total_routes: 2,
    enabled_routes: 2,
    disabled_routes: 0,
    total_destinations: 2,
    enabled_destinations: 2,
    disabled_destinations: 0,
    recent_logs: 20,
    recent_successes: 1,
    recent_failures: 9,
    recent_rate_limited: 0,
    processed_events: 900,
    delivery_outcome_events: 100,
    delivery_success_events: 96,
    delivery_failure_events: 4,
    current_runtime_streams_healthy: 2,
    current_runtime_streams_degraded: 1,
    current_runtime_streams_unhealthy: 1,
    current_runtime_streams_critical: 0,
  }

  it('uses delivery outcome events for failure rate instead of log rows', () => {
    expect(globalErrorRatePct(dash)).toBe(4)
  })

  it('uses dashboard health and selected window seconds without row fallback', () => {
    const kpis = buildMonitoringKpis(dash, [], new Map(), '15m', 900)
    expect(kpis.find((k) => k.id === 'streams')?.value).toBe('2 / 4')
    expect(kpis.find((k) => k.id === 'throughput')?.value).toBe('1.00 evt/s')
  })
})

describe('donutFromTopStreams', () => {
  it('uses the global throughput denominator for subset coverage percentages', () => {
    const slices = donutFromTopStreams(
      [
        { id: 1, name: 'a', eventsPerSec: 0.01 },
        { id: 2, name: 'b', eventsPerSec: 0.003 },
      ],
      0.034,
    )
    expect(slices.reduce((s, x) => s + x.value, 0)).toBeCloseTo(0.013)
    expect(slices.reduce((s, x) => s + x.pct, 0)).toBeCloseTo(38.235, 3)
  })
})
