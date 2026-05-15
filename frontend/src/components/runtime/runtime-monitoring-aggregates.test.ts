import { describe, expect, it } from 'vitest'
import { mergeEventsOverTime } from './runtime-monitoring-aggregates'
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
