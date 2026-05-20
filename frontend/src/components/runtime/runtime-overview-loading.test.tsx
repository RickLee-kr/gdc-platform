import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { RuntimeOverviewPage } from './runtime-overview-page'
import { GDC_AUTH_REQUIRED_MESSAGE } from '../../api/gdcStreams'
import { observabilitySummaryFixture } from '../../test/runtimeApiFixtures'

vi.mock('../../api/gdcStreams', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/gdcStreams')>()
  return {
    ...actual,
    fetchStreamsListResult: vi.fn(),
  }
})

vi.mock('../../api/gdcRuntime', () => ({
  fetchRuntimeDashboardSummary: vi.fn(async () => null),
  fetchRuntimeStatus: vi.fn(async () => null),
  fetchRuntimeLogsPage: vi.fn(async () => null),
  fetchRuntimeAlertSummary: vi.fn(async () => null),
  fetchRuntimeSystemResources: vi.fn(async () => null),
  fetchStreamRuntimeStatsHealth: vi.fn(async () => null),
  fetchStreamRuntimeStats: vi.fn(async () => null),
  fetchStreamRuntimeMetrics: vi.fn(async () => null),
  startRuntimeStream: vi.fn(),
  stopRuntimeStream: vi.fn(),
  runStreamOnce: vi.fn(),
}))

vi.mock('../../api/gdcConnectors', () => ({ fetchConnectorById: vi.fn(async () => null) }))
vi.mock('../../api/gdcBackfill', () => ({ fetchBackfillJobs: vi.fn(async () => []) }))
vi.mock('../../api/gdcRoutes', () => ({ fetchRouteById: vi.fn(async () => null), fetchRoutesList: vi.fn(async () => []) }))

vi.mock('../../api/observabilitySummary', () => ({
  fetchObservabilitySummary: vi.fn(async (_window: string, params?: { snapshot_id?: string }) => {
    const snapshot_id = params?.snapshot_id?.trim() || '2026-01-02T00:00:00Z'
    return observabilitySummaryFixture(snapshot_id, _window === '15m' || _window === '1h' || _window === '6h' ? _window : '24h')
  }),
}))

import { fetchStreamsListResult } from '../../api/gdcStreams'

describe('RuntimeOverviewPage loading states', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('stops loading and shows auth message on 401', async () => {
    vi.mocked(fetchStreamsListResult).mockResolvedValue({
      ok: false,
      status: 401,
      message: GDC_AUTH_REQUIRED_MESSAGE,
      authRequired: true,
    })

    render(
      <MemoryRouter>
        <RuntimeOverviewPage />
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(screen.queryByText(/^Loading…$/)).not.toBeInTheDocument()
    })
    expect(screen.getByTestId('runtime-auth-required')).toHaveTextContent(GDC_AUTH_REQUIRED_MESSAGE)
  })

  it('stops loading and shows error on 500', async () => {
    vi.mocked(fetchStreamsListResult).mockResolvedValue({
      ok: false,
      status: 500,
      message: '500: Internal Server Error',
      authRequired: false,
    })

    render(
      <MemoryRouter>
        <RuntimeOverviewPage />
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(screen.queryByText(/^Loading…$/)).not.toBeInTheDocument()
    })
    expect(screen.getByTestId('runtime-load-error')).toHaveTextContent('500: Internal Server Error')
  })
})
