import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { DashboardOverview } from './dashboard-overview'
import type {
  DashboardOutcomeTimeseriesResponse,
  DashboardSummaryResponse,
  HealthOverviewResponse,
  RetrySummaryResponse,
  RuntimeAlertSummaryResponse,
  RuntimeLogsPageResponse,
} from '../../api/types/gdcApi'

const sampleDashboard = (): DashboardSummaryResponse => ({
  summary: {
    total_streams: 10,
    running_streams: 7,
    paused_streams: 1,
    error_streams: 0,
    stopped_streams: 2,
    rate_limited_source_streams: 0,
    rate_limited_destination_streams: 0,
    total_routes: 12,
    enabled_routes: 11,
    disabled_routes: 1,
    total_destinations: 4,
    enabled_destinations: 4,
    disabled_destinations: 0,
    recent_logs: 120,
    processed_events: 1378,
    delivery_outcome_events: 1172,
    recent_successes: 100,
    recent_failures: 15,
    recent_rate_limited: 5,
  },
  recent_problem_routes: [],
  recent_rate_limited_routes: [],
  recent_unhealthy_streams: [],
  runtime_engine_status: 'RUNNING',
  active_worker_count: 2,
  metrics_window_seconds: 3600,
  metric_meta: {
    'runtime_telemetry_rows.window': {
      metric_id: 'runtime_telemetry_rows.window',
      label: 'Runtime Telemetry Rows',
      semantic_type: 'telemetry_rows',
      source_table: 'delivery_logs',
      source_tables: ['delivery_logs'],
      source_stage_or_status: 'all committed delivery_logs stages',
      aggregation_method: 'COUNT(delivery_logs.id)',
      aggregation_type: 'row_count',
      window_policy: 'window',
      includes_lifecycle_rows: true,
      includes_retry_success: true,
      includes_retry_failed: true,
      retry_policy: 'rows',
      lifecycle_policy: 'Includes lifecycle rows',
      disabled_route_policy: 'rows only',
      idle_route_policy: 'none',
      display_unit: 'rows',
      frontend_label: 'Runtime Telemetry Rows',
      frontend_description: 'Committed delivery_logs telemetry rows including lifecycle stages.',
      description: 'Committed delivery_logs telemetry rows including lifecycle stages.',
      window_start: '2026-01-01T00:00:00Z',
      window_end: '2026-01-01T01:00:00Z',
      generated_at: '2026-01-01T01:00:00Z',
    },
  },
})

const snapshotParam = (params?: { snapshot_id?: string }) => params?.snapshot_id ?? '2026-01-01T01:00:00Z'

const sampleHealth = (snapshot_id = '2026-01-01T01:00:00Z'): HealthOverviewResponse => ({
  time: { window: '1h', since: '2026-01-01T00:00:00Z', until: '2026-01-01T01:00:00Z', snapshot_id },
  filters: { stream_id: null, route_id: null, destination_id: null },
  scoring_mode: 'current_runtime',
  streams: { healthy: 6, degraded: 1, unhealthy: 0, critical: 0 },
  routes: { healthy: 9, degraded: 1, unhealthy: 1, critical: 0 },
  destinations: { healthy: 4, degraded: 0, unhealthy: 0, critical: 0 },
  average_stream_score: 82,
  average_route_score: 88,
  average_destination_score: 95,
  worst_routes: [],
  worst_streams: [],
  worst_destinations: [],
})

vi.mock('../../api/gdcRuntime', async () => {
  const actual = await vi.importActual<typeof import('../../api/gdcRuntime')>('../../api/gdcRuntime')
  return {
    ...actual,
    fetchRuntimeDashboardSummary: vi.fn(async (_limit: number, _window: string, params?: { snapshot_id?: string }) => ({
      ...sampleDashboard(),
      snapshot_id: snapshotParam(params),
    })),
    fetchRuntimeAlertSummary: vi.fn(async (): Promise<RuntimeAlertSummaryResponse | null> => ({
      metrics_window_seconds: 3600,
      items: [],
    })),
    fetchRuntimeLogsPage: vi.fn(async (params?: { snapshot_id?: string }): Promise<RuntimeLogsPageResponse | null> => ({
      snapshot_id: snapshotParam(params),
      total_returned: 0,
      has_next: false,
      next_cursor_created_at: null,
      next_cursor_id: null,
      items: [],
    })),
    fetchRuntimeDashboardOutcomeTimeseries: vi.fn(
      async (_window: string, params?: { snapshot_id?: string }): Promise<DashboardOutcomeTimeseriesResponse | null> => ({
        snapshot_id: snapshotParam(params),
        metrics_window_seconds: 3600,
        buckets: [
          {
            bucket_start: '2026-01-01T00:00:00Z',
            success: 10,
            failed: 1,
            rate_limited: 0,
          },
        ],
      }),
    ),
    fetchRuntimeSystemResources: vi.fn(async () => ({
      cpu_percent: 2.5,
      memory_percent: 40,
      memory_used_bytes: 4e9,
      memory_total_bytes: 8e9,
      disk_percent: 55,
      disk_used_bytes: 100e9,
      disk_total_bytes: 200e9,
      network_in_bytes_per_sec: 0,
      network_out_bytes_per_sec: 0,
    })),
  }
})

vi.mock('../../api/gdcRuntimeHealth', () => ({
  fetchHealthOverview: vi.fn(async (params?: { snapshot_id?: string }) => sampleHealth(snapshotParam(params))),
}))

vi.mock('../../api/gdcRuntimeAnalytics', () => ({
  fetchRetriesSummary: vi.fn(async (params?: { snapshot_id?: string }): Promise<RetrySummaryResponse | null> => ({
    time: { window: '1h', since: '2026-01-01T00:00:00Z', until: '2026-01-01T01:00:00Z', snapshot_id: snapshotParam(params) },
    filters: { stream_id: null, route_id: null, destination_id: null },
    retry_success_events: 3,
    retry_failed_events: 1,
    total_retry_outcome_events: 4,
    retry_column_sum: 6,
  })),
}))

vi.mock('../../api/gdcStreams', () => ({
  fetchStreamsList: vi.fn(async () => []),
}))

vi.mock('../../api/gdcDestinations', () => ({
  fetchDestinationsList: vi.fn(async () => []),
}))

vi.mock('../../api/gdcRetention', () => ({
  fetchRetentionStatus: vi.fn(async () => ({
    policies: { delivery_logs: 30, runtime_metrics: 90 },
    supplement_next_after_utc: null,
    last_operational_retention_at: '2026-01-01T00:00:00Z',
    last_audit: null,
  })),
}))

describe('DashboardOverview', () => {
  it('shows loading state before data resolves', async () => {
    const rt = await import('../../api/gdcRuntime')
    vi.mocked(rt.fetchRuntimeDashboardSummary).mockImplementationOnce(
      () =>
        new Promise<DashboardSummaryResponse | null>((resolve) => {
          globalThis.setTimeout(() => resolve(sampleDashboard()), 40)
        }),
    )
    render(
      <MemoryRouter>
        <DashboardOverview />
      </MemoryRouter>,
    )
    expect(screen.getByText(/Loading operational data/i)).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByText(/Loading operational data/i)).not.toBeInTheDocument())
  })

  it('clears loading when a dashboard fetch rejects', async () => {
    const rt = await import('../../api/gdcRuntime')
    vi.mocked(rt.fetchRuntimeDashboardSummary).mockRejectedValueOnce(new Error('network'))
    render(
      <MemoryRouter>
        <DashboardOverview />
      </MemoryRouter>,
    )
    await waitFor(() => expect(screen.queryByText(/Loading operational data/i)).not.toBeInTheDocument())
    expect(await screen.findByRole('heading', { level: 2, name: 'Operations Center' })).toBeInTheDocument()
  })

  it('renders empty operational sections when backend returns null payloads', async () => {
    const rt = await import('../../api/gdcRuntime')
    const h = await import('../../api/gdcRuntimeHealth')
    vi.mocked(rt.fetchRuntimeDashboardSummary).mockResolvedValueOnce(null)
    vi.mocked(rt.fetchRuntimeDashboardOutcomeTimeseries).mockResolvedValueOnce(null)
    vi.mocked(h.fetchHealthOverview).mockResolvedValueOnce(null)
    render(
      <MemoryRouter>
        <DashboardOverview />
      </MemoryRouter>,
    )
    expect(await screen.findByRole('heading', { level: 2, name: 'Operations Center' })).toBeInTheDocument()
    expect(await screen.findByText(/No volume data for this window/i)).toBeInTheDocument()
    expect(screen.getByText(/Health scoring is not available/i)).toBeInTheDocument()
  })

  it('renders KPI values from mocked API responses', async () => {
    render(
      <MemoryRouter>
        <DashboardOverview />
      </MemoryRouter>,
    )
    const kpi = await screen.findByRole('region', { name: 'Operational KPI summary' })
    expect(await within(kpi).findByText('7')).toBeInTheDocument()
    expect(within(kpi).getByText('Active Streams')).toBeInTheDocument()
    expect(within(kpi).getByText(/Healthy Streams/i)).toBeInTheDocument()
    expect(within(kpi).getByText('Failed Routes (Live)')).toBeInTheDocument()
    expect(within(kpi).getByText('Runtime Telemetry Rows (1h)')).toBeInTheDocument()
    expect(within(kpi).getByTitle(/Committed delivery_logs telemetry rows including lifecycle stages/i)).toBeInTheDocument()
    expect(screen.getByText('Current route posture')).toBeInTheDocument()
  })

  it('keeps the last coherent dashboard bundle when a refresh snapshot mismatches', async () => {
    const user = userEvent.setup()
    const rt = await import('../../api/gdcRuntime')
    vi.mocked(rt.fetchRuntimeDashboardSummary).mockImplementationOnce(
      async (_limit: number, _window: string, params?: { snapshot_id?: string }) => ({
        ...sampleDashboard(),
        snapshot_id: snapshotParam(params),
      }),
    )
    vi.mocked(rt.fetchRuntimeDashboardSummary).mockImplementationOnce(async () => ({
      ...sampleDashboard(),
      snapshot_id: 'older-snapshot',
      summary: { ...sampleDashboard().summary, running_streams: 1 },
    }))
    render(
      <MemoryRouter>
        <DashboardOverview />
      </MemoryRouter>,
    )
    const kpi = await screen.findByRole('region', { name: 'Operational KPI summary' })
    expect(await within(kpi).findByText('7')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Refresh operational data now/i }))
    await waitFor(() => expect(screen.queryByText(/Loading operational data/i)).not.toBeInTheDocument())
    expect(within(kpi).getByText('7')).toBeInTheDocument()
    expect(screen.queryByText(/older-snapshot/i)).not.toBeInTheDocument()
  })

  it('navigation links point to stream runtime, logs, routes, and analytics', async () => {
    render(
      <MemoryRouter>
        <DashboardOverview />
      </MemoryRouter>,
    )
    await screen.findByRole('heading', { level: 2, name: 'Operations Center' })
    const quick = screen.getByRole('navigation', { name: 'Operations Center quick links' })
    expect(within(quick).getByRole('link', { name: 'Stream runtime' })).toHaveAttribute('href', '/runtime')
    expect(within(quick).getByRole('link', { name: 'Logs' })).toHaveAttribute('href', '/logs')
    expect(within(quick).getByRole('link', { name: 'Routes' })).toHaveAttribute('href', '/routes')
    expect(within(quick).getByRole('link', { name: 'Analytics' })).toHaveAttribute('href', '/runtime/analytics')
    expect(within(quick).getByRole('link', { name: 'Advanced health checks' })).toHaveAttribute('href', '/validation')
  })

  it('does not show demo labels when API returns real-shaped payloads', async () => {
    render(
      <MemoryRouter>
        <DashboardOverview />
      </MemoryRouter>,
    )
    await screen.findByRole('heading', { level: 2, name: 'Operations Center' })
    expect(screen.queryByText(/demo/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/Malop/i)).not.toBeInTheDocument()
  })

  it('changes metrics window when a window chip is clicked', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <DashboardOverview />
      </MemoryRouter>,
    )
    await screen.findByRole('heading', { level: 2, name: 'Operations Center' })
    await user.click(screen.getByRole('button', { name: '15m' }))
    await waitFor(() => {
      expect(screen.getByText(/Runtime Telemetry Rows \(15m\)/)).toBeInTheDocument()
    })
  })
})
