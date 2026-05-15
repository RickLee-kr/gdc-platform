import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { RuntimeAnalyticsPage } from './runtime-analytics-page'
import type {
  RetrySummaryResponse,
  RouteFailuresAnalyticsResponse,
  StreamRetriesAnalyticsResponse,
} from '../../api/types/gdcApi'

const emptyFailures = (): RouteFailuresAnalyticsResponse => ({
  time: { window: '24h', since: '2026-01-01T00:00:00Z', until: '2026-01-02T00:00:00Z' },
  filters: { stream_id: null, route_id: null, destination_id: null },
  totals: { failure_events: 0, success_events: 0, overall_failure_rate: 0 },
  latency_ms_avg: null,
  latency_ms_p95: null,
  last_failure_at: null,
  last_success_at: null,
  outcomes_by_route: [],
  failures_by_destination: [],
  failures_by_stream: [],
  failure_trend: [],
  top_error_codes: [],
  top_failed_stages: [],
  unstable_routes: [],
})

const emptyRetries = (): RetrySummaryResponse => ({
  time: { window: '24h', since: '2026-01-01T00:00:00Z', until: '2026-01-02T00:00:00Z' },
  filters: { stream_id: null, route_id: null, destination_id: null },
  retry_success_events: 0,
  retry_failed_events: 0,
  total_retry_outcome_events: 0,
  retry_column_sum: 0,
})

const emptyRank = (): StreamRetriesAnalyticsResponse => ({
  time: { window: '24h', since: '2026-01-01T00:00:00Z', until: '2026-01-02T00:00:00Z' },
  filters: { stream_id: null, route_id: null, destination_id: null },
  retry_heavy_streams: [],
  retry_heavy_routes: [],
})

vi.mock('../../api/gdcRuntimeAnalytics', () => ({
  fetchRouteFailuresAnalytics: vi.fn(async () => emptyFailures()),
  fetchRetriesSummary: vi.fn(async () => emptyRetries()),
  fetchStreamRetriesAnalytics: vi.fn(async () => emptyRank()),
}))

describe('RuntimeAnalyticsPage', () => {
  it('renders empty operational copy when no samples exist', async () => {
    render(
      <MemoryRouter>
        <RuntimeAnalyticsPage />
      </MemoryRouter>,
    )
    expect(await screen.findByRole('heading', { name: /Delivery analytics/i })).toBeInTheDocument()
    expect(await screen.findByText(/No delivery outcomes in this window/i)).toBeInTheDocument()
  })

  it('renders unstable route row when API returns candidates', async () => {
    const mod = await import('../../api/gdcRuntimeAnalytics')
    vi.mocked(mod.fetchRouteFailuresAnalytics).mockResolvedValueOnce({
      ...emptyFailures(),
      unstable_routes: [
        {
          route_id: 77,
          stream_id: 3,
          destination_id: 9,
          failure_count: 8,
          success_count: 2,
          failure_rate: 0.8,
          sample_total: 10,
        },
      ],
    })
    render(
      <MemoryRouter>
        <RuntimeAnalyticsPage />
      </MemoryRouter>,
    )
    expect(await screen.findByText(/#77/)).toBeInTheDocument()
    expect(screen.getByText(/80\.0%/)).toBeInTheDocument()
    const logsLink = screen.getByRole('link', { name: /Open logs/i })
    expect(logsLink.getAttribute('href')).toContain('status=failed')
    expect(logsLink.getAttribute('href')).toContain('stage=route_send_failed')
  })

  it('retry-heavy stream logs link includes status=retry and retry stage', async () => {
    const mod = await import('../../api/gdcRuntimeAnalytics')
    vi.mocked(mod.fetchStreamRetriesAnalytics).mockResolvedValueOnce({
      ...emptyRank(),
      retry_heavy_streams: [{ stream_id: 44, retry_event_count: 2, retry_column_sum: 4 }],
    })
    render(
      <MemoryRouter>
        <RuntimeAnalyticsPage />
      </MemoryRouter>,
    )
    const link = await screen.findByRole('link', { name: /Open logs/i })
    expect(link.getAttribute('href')).toContain('status=retry')
    expect(link.getAttribute('href')).toContain('stage=route_retry_failed')
    expect(link.getAttribute('href')).toContain('stream_id=44')
  })
})
