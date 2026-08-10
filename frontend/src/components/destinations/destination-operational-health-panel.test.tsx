import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DestinationOperationalHealthPanel } from './destination-operational-health-panel'

const fetchDestinationHealthList = vi.fn()
const fetchRouteHealthList = vi.fn()
const fetchRouteFailuresAnalytics = vi.fn()
const fetchRetriesSummary = vi.fn()

vi.mock('../../api/gdcRuntimeHealth', () => ({
  fetchDestinationHealthList: (...args: unknown[]) => fetchDestinationHealthList(...args),
  fetchRouteHealthList: (...args: unknown[]) => fetchRouteHealthList(...args),
}))

vi.mock('../../api/gdcRuntimeAnalytics', () => ({
  fetchRouteFailuresAnalytics: (...args: unknown[]) => fetchRouteFailuresAnalytics(...args),
  fetchRetriesSummary: (...args: unknown[]) => fetchRetriesSummary(...args),
}))

describe('DestinationOperationalHealthPanel lazy route-health', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fetchDestinationHealthList.mockResolvedValue({ rows: [] })
    fetchRouteHealthList.mockResolvedValue({
      rows: [
        {
          route_id: 7,
          stream_id: 3,
          destination_id: 9,
          level: 'HEALTHY',
          score: 95,
          factors: [],
          metrics: {
            success_count: 10,
            failure_count: 0,
            failure_rate: 0,
            latency_ms_avg: 5,
            latency_ms_p95: 8,
            last_success_at: null,
            last_failure_at: null,
          },
        },
      ],
    })
    fetchRouteFailuresAnalytics.mockResolvedValue(null)
    fetchRetriesSummary.mockResolvedValue({
      retry_success_events: 0,
      retry_failed_events: 0,
      total_retry_outcome_events: 0,
    })
  })

  it('with preload skips dest-health/failures but still loads 24h route-health', async () => {
    render(
      <MemoryRouter>
        <DestinationOperationalHealthPanel
          destinationId={9}
          preload={{
            healthRow: null,
            failuresAnalytics: null,
          }}
        />
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(screen.getByTestId('destination-operational-health-panel')).toBeInTheDocument()
    })
    await waitFor(() => {
      expect(fetchRouteHealthList).toHaveBeenCalledTimes(1)
      expect(fetchRetriesSummary).toHaveBeenCalledTimes(1)
    })
    expect(fetchDestinationHealthList).not.toHaveBeenCalled()
    expect(fetchRouteFailuresAnalytics).not.toHaveBeenCalled()
    expect(await screen.findByText('#7')).toBeInTheDocument()
  })
})
