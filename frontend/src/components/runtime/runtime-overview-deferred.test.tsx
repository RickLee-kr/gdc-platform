import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OperationalSnapshotResponse } from '../../api/operationalSnapshot'
import { RuntimeOverviewPage } from './runtime-overview-page'

const deferredSnapshot: OperationalSnapshotResponse = {
  global: {
    health_status: 'HEALTHY',
    total_streams: 1,
    enabled_streams: 1,
    running_streams: 1,
    error_streams: 0,
    total_routes: 0,
    enabled_routes: 0,
    total_destinations: 0,
    enabled_destinations: 0,
    total_eps_1m: 1,
    total_eps_5m: 1,
    avg_latency_ms: 5,
    last_activity_at: '2026-05-22T12:00:00Z',
  },
  streams: [
    {
      stream_id: 1,
      stream_name: 'Deferred Test Stream',
      connector_id: 1,
      source_id: 1,
      enabled: true,
      status: 'RUNNING',
      health_status: 'HEALTHY',
      eps_1m: 1,
      eps_5m: 1,
      success_rate_5m: 100,
      failure_rate_5m: 0,
      avg_latency_ms: 5,
      route_count: 0,
      healthy_route_count: 0,
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
  updated_at: '2026-05-22T12:00:00Z',
}

vi.mock('../../api/operationalSnapshot', () => ({
  clearOperationalSnapshotCache: vi.fn(),
  getOperationalSnapshot: vi.fn(),
}))

vi.mock('../../api/gdcRuntime', () => ({
  fetchStreamRuntimeMetrics: vi.fn(),
  fetchRuntimeDashboardSummary: vi.fn(),
  fetchRuntimeStatus: vi.fn(),
  fetchRuntimeLogsPage: vi.fn(),
  fetchRuntimeAlertSummary: vi.fn(),
  fetchRuntimeSystemResources: vi.fn(),
  fetchStreamRuntimeStatsHealth: vi.fn(),
  fetchStreamRuntimeStats: vi.fn(),
  startRuntimeStream: vi.fn(),
  stopRuntimeStream: vi.fn(),
  runStreamOnce: vi.fn(),
}))

vi.mock('../../api/observabilitySummary', () => ({
  fetchObservabilitySummary: vi.fn(),
}))

vi.mock('../../api/gdcStreams', () => ({
  fetchStreamsListResult: vi.fn(),
}))

describe('RuntimeOverviewPage deferred sections', () => {
  beforeEach(async () => {
    vi.stubEnv('MODE', 'development')
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.clearAllMocks()
    const snap = await import('../../api/operationalSnapshot')
    vi.mocked(snap.getOperationalSnapshot).mockResolvedValue(deferredSnapshot)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.useRealTimers()
  })

  it('defers side panels and analytics until idle/timeout', async () => {
    render(
      <MemoryRouter>
        <RuntimeOverviewPage />
      </MemoryRouter>,
    )

    await waitFor(() => expect(screen.getByTestId('runtime-stream-flow-grid')).toBeInTheDocument())
    expect(screen.queryByTestId('runtime-problem-panel')).not.toBeInTheDocument()
    expect(screen.queryByTestId('runtime-lazy-analytics')).not.toBeInTheDocument()

    await act(async () => {
      vi.advanceTimersByTime(48)
    })
    await waitFor(() => expect(screen.getByTestId('runtime-problem-panel')).toBeInTheDocument())

    await act(async () => {
      vi.advanceTimersByTime(120)
    })
    await waitFor(() => expect(screen.getByTestId('runtime-lazy-analytics')).toBeInTheDocument())
  })

  it('does not fetch metrics until Load chart is clicked', async () => {
    const runtime = await import('../../api/gdcRuntime')
    vi.mocked(runtime.fetchStreamRuntimeMetrics).mockResolvedValue({
      stream_id: 1,
      metrics_window_seconds: 3600,
      kpis: { events_last_hour: 0, avg_latency_ms: 0 },
      events_over_time: [{ timestamp: '2026-05-22T12:00:00Z', events: 5, delivered: 5, failed: 0 }],
      route_health: [],
      checkpoint_history: [],
      recent_runs: [],
    } as never)

    render(
      <MemoryRouter>
        <RuntimeOverviewPage />
      </MemoryRouter>,
    )

    await waitFor(() => expect(screen.getByTestId('runtime-stream-card-1')).toBeInTheDocument())
    await act(async () => {
      vi.advanceTimersByTime(200)
    })
    await waitFor(() => expect(screen.getByTestId('runtime-lazy-analytics')).toBeInTheDocument())

    expect(runtime.fetchStreamRuntimeMetrics).not.toHaveBeenCalled()

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) })
    await user.click(screen.getByRole('button', { name: /load chart/i }))

    await waitFor(() => expect(runtime.fetchStreamRuntimeMetrics).toHaveBeenCalledTimes(1))
  })
})
