import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HealthBadge } from './health-badge'
import { FailureRateIndicator } from './failure-rate-indicator'
import { HealthTrendMiniChart } from './health-trend-mini-chart'
import { RetryPressureIndicator } from './retry-pressure-indicator'
import { HealthScoreCard, HealthScoreCardSkeleton } from './health-score-card'
import { StreamRuntimeHealthExtension } from '../../streams/stream-runtime-health-extension'
import { RouteDetailHealthPanel } from '../../routes/route-detail-health-panel'
import { DestinationOperationalHealthPanel } from '../../destinations/destination-operational-health-panel'
import * as gdcRuntimeHealth from '../../../api/gdcRuntimeHealth'
import * as gdcRuntimeAnalytics from '../../../api/gdcRuntimeAnalytics'
afterEach(() => {
  vi.restoreAllMocks()
})

describe('HealthBadge', () => {
  it.each([
    ['HEALTHY', 'border-emerald'],
    ['DEGRADED', 'border-amber'],
    ['UNHEALTHY', 'border-orange'],
    ['CRITICAL', 'border-rose'],
  ] as const)(`maps %s to expected tone class`, (level, needle) => {
    const { container } = render(<HealthBadge level={level} score={50} factors={[]} />)
    const el = container.querySelector(`[data-health-level="${level}"]`)
    expect(el).toBeTruthy()
    expect(el!.className).toContain(needle)
  })
})

describe('FailureRateIndicator', () => {
  it('shows empty state when rate is null', () => {
    render(<FailureRateIndicator rate={null} />)
    expect(screen.getByTestId('failure-rate-empty')).toBeInTheDocument()
  })

  it('renders percentage for numeric rate', () => {
    render(<FailureRateIndicator rate={0.125} />)
    expect(screen.getByTestId('failure-rate-indicator')).toHaveTextContent('12.5%')
  })
})

describe('RetryPressureIndicator', () => {
  it('renders counts', () => {
    render(<RetryPressureIndicator retryEventCount={40} retryRate={0.2} />)
    expect(screen.getByTestId('retry-pressure-indicator')).toHaveTextContent('40')
    expect(screen.getByTestId('retry-pressure-indicator')).toHaveTextContent('20.0%')
  })
})

describe('HealthTrendMiniChart', () => {
  it('shows empty copy when no values', () => {
    render(<HealthTrendMiniChart values={[]} />)
    expect(screen.getByTestId('health-trend-empty')).toBeInTheDocument()
  })

  it('renders svg when values present', () => {
    const { container } = render(<HealthTrendMiniChart values={[1, 3, 2]} />)
    expect(container.querySelector('svg')).toBeTruthy()
  })
})

describe('HealthScoreCardSkeleton', () => {
  it('renders loading placeholder', () => {
    render(<HealthScoreCardSkeleton />)
    expect(screen.getByTestId('health-score-card-skeleton')).toBeInTheDocument()
  })
})

describe('HealthScoreCard', () => {
  it('renders score and metrics', () => {
    const score = {
      score: 72,
      level: 'DEGRADED' as const,
      factors: [],
      metrics: {
        failure_count: 2,
        success_count: 8,
        retry_event_count: 1,
        retry_count_sum: 3,
        failure_rate: 0.2,
        retry_rate: 0.05,
        latency_ms_avg: 12,
        latency_ms_p95: 40,
        last_failure_at: '2026-01-01T12:00:00Z',
        last_success_at: '2026-01-01T13:00:00Z',
      },
    }
    render(<HealthScoreCard score={score} />)
    expect(screen.getByTestId('health-score-card')).toHaveTextContent('72')
    expect(screen.getByTestId('health-score-card')).toHaveTextContent('DEGRADED')
  })
})

describe('StreamRuntimeHealthExtension', () => {
  it('renders deep links with stream_id when APIs return null', async () => {
    vi.spyOn(gdcRuntimeHealth, 'fetchStreamHealthDetail').mockResolvedValue(null)
    vi.spyOn(gdcRuntimeHealth, 'fetchRouteHealthList').mockResolvedValue(null)
    vi.spyOn(gdcRuntimeAnalytics, 'fetchRouteFailuresAnalytics').mockResolvedValue(null)
    vi.spyOn(gdcRuntimeAnalytics, 'fetchRetriesSummary').mockResolvedValue(null)
    vi.spyOn(gdcRuntimeAnalytics, 'fetchStreamRetriesAnalytics').mockResolvedValue(null)

    render(
      <MemoryRouter>
        <StreamRuntimeHealthExtension backendStreamId={99} />
      </MemoryRouter>,
    )

    expect(await screen.findByTestId('stream-runtime-health-extension')).toBeInTheDocument()
    const analytics = screen.getByRole('link', { name: /Analytics/i })
    expect(analytics).toHaveAttribute('href', '/runtime/analytics?window=24h&stream_id=99')
    const logs = screen.getByRole('link', { name: /Runtime logs/i })
    expect(logs).toHaveAttribute('href', '/logs?stream_id=99')
  })
})

describe('RouteDetailHealthPanel', () => {
  it('logs and analytics links include route_id and stream_id', async () => {
    vi.spyOn(gdcRuntimeHealth, 'fetchRouteHealthDetail').mockResolvedValue(null)
    vi.spyOn(gdcRuntimeAnalytics, 'fetchRouteFailuresForRoute').mockResolvedValue(null)
    vi.spyOn(gdcRuntimeAnalytics, 'fetchRetriesSummary').mockResolvedValue(null)

    render(
      <MemoryRouter>
        <RouteDetailHealthPanel routeId={7} streamId={3} />
      </MemoryRouter>,
    )

    expect(await screen.findByTestId('route-detail-health-panel')).toBeInTheDocument()
    const logs = screen.getByRole('link', { name: /Logs/i })
    expect(logs.getAttribute('href')).toContain('route_id=7')
    expect(logs.getAttribute('href')).toContain('stream_id=3')
    const analytics = screen.getByRole('link', { name: /Analytics/i })
    expect(analytics.getAttribute('href')).toContain('route_id=7')
    expect(analytics.getAttribute('href')).toContain('stream_id=3')
    expect(analytics.getAttribute('href')).toContain('window=24h')
  })
})

describe('DestinationOperationalHealthPanel', () => {
  it('renders logs and analytics deep links with destination_id', async () => {
    vi.spyOn(gdcRuntimeHealth, 'fetchDestinationHealthList').mockResolvedValue(null)
    vi.spyOn(gdcRuntimeHealth, 'fetchRouteHealthList').mockResolvedValue(null)
    vi.spyOn(gdcRuntimeAnalytics, 'fetchRouteFailuresAnalytics').mockResolvedValue(null)
    vi.spyOn(gdcRuntimeAnalytics, 'fetchRetriesSummary').mockResolvedValue(null)

    render(
      <MemoryRouter>
        <DestinationOperationalHealthPanel destinationId={12} />
      </MemoryRouter>,
    )

    expect(await screen.findByTestId('destination-operational-health-panel')).toBeInTheDocument()
    const logs = screen.getByRole('link', { name: /^Logs$/i })
    expect(logs.getAttribute('href')).toContain('destination_id=12')
    const analytics = screen.getByRole('link', { name: /Analytics/i })
    expect(analytics.getAttribute('href')).toContain('destination_id=12')
    expect(analytics.getAttribute('href')).toContain('window=24h')
  })
})
