import { describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useDashboardOverviewData } from './use-dashboard-overview-data'

vi.mock('../../api/gdcRuntime', () => ({
  fetchRuntimeDashboardSummary: vi.fn(async () => ({
    summary: { total_streams: 1, running_streams: 1 },
    runtime_engine_status: 'RUNNING',
  })),
  fetchRuntimeDashboardOutcomeTimeseries: vi.fn(async () => ({
    generated_at: '2026-01-01T00:00:00Z',
    metrics_window_seconds: 3600,
    buckets: [{ bucket_start: '2026-01-01T00:00:00Z', success: 1, failed: 0, rate_limited: 0 }],
  })),
  fetchRuntimeAlertSummary: vi.fn(async () => ({ metrics_window_seconds: 3600, items: [] })),
  fetchRuntimeLogsPage: vi.fn(async () => ({
    items: [],
    next_cursor: null,
    has_more: false,
  })),
  fetchRuntimeSystemResources: vi.fn(async () => null),
}))

vi.mock('../../api/gdcRuntimeAnalytics', () => ({
  fetchRetriesSummary: vi.fn(async () => ({
    retry_success_events: 0,
    retry_failed_events: 0,
    total_retry_outcome_events: 0,
    retry_column_sum: 0,
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

vi.mock('../../api/operationalSnapshot', () => ({
  getOperationalSnapshot: vi.fn(async () => ({
    global: {
      health_status: 'HEALTHY',
      total_streams: 2,
      enabled_streams: 2,
      running_streams: 2,
      error_streams: 0,
      total_routes: 1,
      enabled_routes: 1,
      total_destinations: 1,
      enabled_destinations: 1,
      total_eps_1m: 5,
      total_eps_5m: 5,
      avg_latency_ms: 10,
      last_activity_at: null,
    },
    streams: [
      {
        stream_id: 1,
        stream_name: 'S1',
        connector_id: 1,
        source_id: 1,
        enabled: true,
        status: 'RUNNING',
        health_status: 'HEALTHY',
        eps_1m: 5,
        eps_5m: 5,
        success_rate_5m: 99,
        failure_rate_5m: 1,
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
    ],
    routes: [],
    destinations: [],
    problems: [],
    updated_at: '2026-01-01T00:00:00Z',
  })),
}))

describe('useDashboardOverviewData', () => {
  it('loads operational snapshot first and defers outcome timeseries', async () => {
    const gdcRuntime = await import('../../api/gdcRuntime')
    const { result } = renderHook(() => useDashboardOverviewData('1h', null))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.loadError).toBeNull()
    expect(result.current.bundle?.operationalSnapshot).not.toBeNull()
    expect(result.current.bundle?.operationalSnapshot?.global.running_streams).toBe(2)
    expect(gdcRuntime.fetchRuntimeDashboardOutcomeTimeseries).toHaveBeenCalled()
    await waitFor(() => expect(result.current.bundle?.outcomeTs).not.toBeNull())
  })

  it('surfaces error when operational snapshot is unavailable', async () => {
    const operationalSnapshot = await import('../../api/operationalSnapshot')
    vi.mocked(operationalSnapshot.getOperationalSnapshot).mockResolvedValueOnce(null)
    const { result } = renderHook(() => useDashboardOverviewData('1h', null))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.loadError).toMatch(/operational snapshot/i)
    expect(result.current.bundle?.operationalSnapshot).toBeNull()
  })
})
