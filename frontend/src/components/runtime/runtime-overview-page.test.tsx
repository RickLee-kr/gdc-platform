import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RuntimeOverviewPage } from './runtime-overview-page'
import type { OperationalSnapshotResponse } from '../../api/operationalSnapshot'

const operationalSnapshot: OperationalSnapshotResponse = {
  global: {
    health_status: 'DEGRADED',
    total_streams: 2,
    enabled_streams: 2,
    running_streams: 1,
    error_streams: 1,
    total_routes: 2,
    enabled_routes: 2,
    total_destinations: 1,
    enabled_destinations: 1,
    total_eps_1m: 12.5,
    total_eps_5m: 10,
    avg_latency_ms: 42,
    last_activity_at: '2026-05-22T12:00:00Z',
  },
  streams: [
    {
      stream_id: 1,
      stream_name: 'Alerts Ingest',
      connector_id: 1,
      source_id: 1,
      enabled: true,
      status: 'RUNNING',
      health_status: 'HEALTHY',
      eps_1m: 10,
      eps_5m: 8,
      success_rate_5m: 99,
      failure_rate_5m: 1,
      avg_latency_ms: 30,
      route_count: 2,
      healthy_route_count: 2,
      failed_route_count: 0,
      last_success_at: '2026-05-22T12:00:00Z',
      last_error_at: null,
      last_error_message: null,
      checkpoint_updated_at: '2026-05-22T11:55:00Z',
      checkpoint_lag_seconds: 12,
    },
    {
      stream_id: 2,
      stream_name: 'Backup Stream',
      connector_id: 2,
      source_id: 2,
      enabled: true,
      status: 'ERROR',
      health_status: 'ERROR',
      eps_1m: 0,
      eps_5m: 0,
      success_rate_5m: 40,
      failure_rate_5m: 60,
      avg_latency_ms: null,
      route_count: 1,
      healthy_route_count: 0,
      failed_route_count: 1,
      last_success_at: null,
      last_error_at: '2026-05-22T11:30:00Z',
      last_error_message: 'connection reset',
      checkpoint_updated_at: null,
      checkpoint_lag_seconds: 900,
    },
  ],
  routes: [
    {
      route_id: 5,
      stream_id: 2,
      stream_name: 'Backup Stream',
      destination_id: 9,
      destination_name: 'SIEM',
      destination_type: 'WEBHOOK_POST',
      enabled: true,
      failure_policy: 'LOG_AND_CONTINUE',
      health_status: 'ERROR',
      delivered_eps_1m: 0,
      failed_eps_1m: 2,
      success_rate_5m: 40,
      retry_rate_5m: 15,
      avg_latency_ms: 100,
      last_success_at: null,
      last_error_at: '2026-05-22T11:30:00Z',
      last_error_message: 'timeout',
    },
  ],
  destinations: [
    {
      destination_id: 9,
      destination_name: 'SIEM',
      destination_type: 'WEBHOOK_POST',
      enabled: true,
      health_status: 'ERROR',
      inbound_eps_1m: 0,
      failed_eps_1m: 2,
      avg_latency_ms: 100,
      route_count: 1,
      last_success_at: null,
      last_error_at: '2026-05-22T11:30:00Z',
      last_error_message: 'timeout',
    },
  ],
  problems: [
    {
      severity: 'critical',
      scope: 'stream',
      stream_id: 2,
      route_id: null,
      destination_id: null,
      title: 'Stream error',
      message: 'delivery failing',
      last_seen_at: '2026-05-22T11:30:00Z',
    },
  ],
  updated_at: '2026-05-22T12:05:00Z',
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

describe('RuntimeOverviewPage command center', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    const snap = await import('../../api/operationalSnapshot')
    vi.mocked(snap.getOperationalSnapshot).mockResolvedValue(operationalSnapshot)
  })

  it('initial load uses operational snapshot only (no per-stream metrics)', async () => {
    const snap = await import('../../api/operationalSnapshot')
    const runtime = await import('../../api/gdcRuntime')
    const obs = await import('../../api/observabilitySummary')
    const streams = await import('../../api/gdcStreams')

    render(
      <MemoryRouter>
        <RuntimeOverviewPage />
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(snap.getOperationalSnapshot).toHaveBeenCalled()
    })

    expect(screen.getByTestId('runtime-global-health-strip')).toBeInTheDocument()
    expect(screen.getByTestId('runtime-stream-flow-grid')).toBeInTheDocument()
    expect(screen.getByTestId('runtime-problem-panel')).toBeInTheDocument()
    expect(screen.getByTestId('runtime-route-destination-summary')).toBeInTheDocument()
    expect(screen.getByTestId('runtime-stream-card-1')).toHaveTextContent('Alerts Ingest')
    expect(screen.getByText('Stream error')).toBeInTheDocument()
    expect(screen.getByText('Degraded')).toBeInTheDocument()

    expect(runtime.fetchStreamRuntimeMetrics).not.toHaveBeenCalled()
    expect(runtime.fetchStreamRuntimeStatsHealth).not.toHaveBeenCalled()
    expect(runtime.fetchRuntimeDashboardSummary).not.toHaveBeenCalled()
    expect(runtime.fetchRuntimeLogsPage).not.toHaveBeenCalled()
    expect(obs.fetchObservabilitySummary).not.toHaveBeenCalled()
    expect(streams.fetchStreamsListResult).not.toHaveBeenCalled()
  })

  it('loads per-stream metrics only when analytics is requested', async () => {
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

    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <RuntimeOverviewPage />
      </MemoryRouter>,
    )

    await waitFor(() => expect(screen.getByTestId('runtime-stream-card-1')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: /load chart/i }))
    await waitFor(() => expect(runtime.fetchStreamRuntimeMetrics).toHaveBeenCalledTimes(1))
    expect(runtime.fetchStreamRuntimeMetrics).toHaveBeenCalledWith(1, '1h')
  })

  it('shows error and stops loading when snapshot fails', async () => {
    const snap = await import('../../api/operationalSnapshot')
    vi.mocked(snap.getOperationalSnapshot).mockResolvedValue(null)

    render(
      <MemoryRouter>
        <RuntimeOverviewPage />
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(screen.getByTestId('runtime-load-error')).toBeInTheDocument()
    })
    expect(screen.queryByText(/^Loading streams…$/)).not.toBeInTheDocument()
  })
})
