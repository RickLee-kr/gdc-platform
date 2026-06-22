import { describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useDashboardOverviewData } from './use-dashboard-overview-data'

vi.mock('../../api/runtimeSnapshotSync', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/runtimeSnapshotSync')>()
  return {
    ...actual,
    createRuntimeSnapshotId: () => 'snap-1',
    createRefreshCycleSnapshotId: () => 'snap-1',
  }
})

vi.mock('../../api/observabilitySummary', () => ({
  fetchObservabilitySummary: vi.fn(async () => ({
    snapshot_id: 'snap-1',
    generated_at: '2026-01-01T00:00:00Z',
    window: '1h',
    window_start: '2025-12-31T23:00:00Z',
    window_end: '2026-01-01T00:00:00Z',
    metric_contract_version: '1',
    totals: {
      streams_total: 1,
      streams_running: 1,
      routes_total: 1,
      routes_enabled: 1,
      healthy_routes: 1,
      idle_routes: 0,
      unhealthy_routes: 0,
      critical_routes: 0,
      delivery_success_events: 0,
      delivery_failed_events: 0,
      retry_success_events: 0,
      retry_failed_events: 0,
      runtime_telemetry_rows: 0,
      lifecycle_rows: 0,
      processed_events: 0,
      throughput_eps: 0,
      p95_latency_ms: null,
    },
    metric_contract: {},
    metric_meta: {},
  })),
}))

vi.mock('../../api/gdcRuntime', () => ({
  fetchRuntimeDashboardSummary: vi.fn(async () => ({
    snapshot_id: 'snap-1',
    summary: { total_streams: 1, running_streams: 1 },
  })),
  fetchRuntimeDashboardOutcomeTimeseries: vi.fn(async () => ({
    snapshot_id: 'snap-1',
    generated_at: '2026-01-01T00:00:00Z',
    metrics_window_seconds: 3600,
    buckets: [{ bucket_start: '2026-01-01T00:00:00Z', success: 1, failed: 0, rate_limited: 0 }],
  })),
  fetchRuntimeAlertSummary: vi.fn(async () => ({ metrics_window_seconds: 3600, items: [] })),
  fetchRuntimeLogsPage: vi.fn(async () => ({
    snapshot_id: 'snap-1',
    items: [],
    next_cursor: null,
    has_more: false,
  })),
  fetchRuntimeSystemResources: vi.fn(async () => null),
}))

vi.mock('../../api/gdcRuntimeAnalytics', () => ({
  fetchRetriesSummary: vi.fn(async () => ({
    time: { snapshot_id: 'snap-1', window: '1h' },
    retry_success_events: 0,
    retry_failed_events: 0,
    total_retry_outcome_events: 0,
    retry_column_sum: 0,
  })),
}))

vi.mock('../../api/gdcRuntimeHealth', () => ({
  fetchHealthOverview: vi.fn(async () => ({
    time: { snapshot_id: 'snap-1' },
    streams: { healthy: 1, degraded: 0, unhealthy: 0, critical: 0 },
    routes: { healthy: 1, degraded: 0, unhealthy: 0, critical: 0 },
    destinations: { healthy: 1, degraded: 0, unhealthy: 0, critical: 0 },
  })),
}))

vi.mock('../../api/gdcRetention', () => ({
  fetchRetentionStatus: vi.fn(async () => null),
}))

vi.mock('../../api/gdcStreams', () => ({
  fetchStreamsList: vi.fn(async () => []),
}))

vi.mock('../../api/gdcDestinations', () => ({
  fetchDestinationsList: vi.fn(async () => []),
}))

vi.mock('../../api/gdcConnectors', () => ({
  fetchConnectorsList: vi.fn(async () => []),
}))

describe('useDashboardOverviewData', () => {
  it('defers outcome-timeseries until after the core bundle resolves', async () => {
    const { resetRefreshCycleSnapshotIdForTests } = await import('../../api/runtimeSnapshotSync')
    resetRefreshCycleSnapshotIdForTests()
    const gdcRuntime = await import('../../api/gdcRuntime')
    const { result } = renderHook(() => useDashboardOverviewData('1h', null))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.loadError).toBeNull()
    expect(result.current.bundle?.dashboard).not.toBeNull()
    expect(gdcRuntime.fetchRuntimeDashboardOutcomeTimeseries).toHaveBeenCalled()
    await waitFor(() => expect(result.current.bundle?.outcomeTs).not.toBeNull())
  })
})
