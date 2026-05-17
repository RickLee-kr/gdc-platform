import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { StreamsConsole } from './streams-console'
import { GDC_AUTH_REQUIRED_MESSAGE } from '../../api/gdcStreams'

vi.mock('../../api/gdcStreams', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/gdcStreams')>()
  return {
    ...actual,
    fetchStreamsListResult: vi.fn(),
    fetchStreamById: vi.fn(async () => null),
  }
})

vi.mock('../../api/gdcRuntime', () => ({
  fetchRuntimeDashboardSummary: vi.fn(async () => null),
  fetchStreamMappingUiConfig: vi.fn(async () => null),
  fetchStreamRuntimeStatsHealth: vi.fn(async () => null),
  fetchStreamRuntimeTimeline: vi.fn(async () => null),
  fetchStreamRuntimeStats: vi.fn(async () => null),
  fetchStreamRuntimeMetrics: vi.fn(async () => null),
  fetchRuntimeLogsPage: vi.fn(async () => null),
  searchRuntimeDeliveryLogs: vi.fn(async () => null),
  startRuntimeStream: vi.fn(),
  stopRuntimeStream: vi.fn(),
  runStreamOnce: vi.fn(),
}))

vi.mock('../../api/gdcConnectors', () => ({ fetchConnectorById: vi.fn(async () => null) }))
vi.mock('../../api/gdcDestinations', () => ({ fetchDestinationsList: vi.fn(async () => []) }))
vi.mock('../../api/gdcRoutes', () => ({ fetchRoutesList: vi.fn(async () => []) }))

import { fetchStreamsListResult } from '../../api/gdcStreams'

describe('StreamsConsole loading states', () => {
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
        <StreamsConsole />
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(screen.queryByText(/Loading streams/i)).not.toBeInTheDocument()
    })
    expect(screen.getByTestId('streams-auth-required')).toHaveTextContent(GDC_AUTH_REQUIRED_MESSAGE)
  })

  it('renders empty state for successful empty list', async () => {
    vi.mocked(fetchStreamsListResult).mockResolvedValue({
      ok: true,
      status: 200,
      data: [],
    })

    render(
      <MemoryRouter>
        <StreamsConsole />
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(screen.queryByText(/Loading streams/i)).not.toBeInTheDocument()
    })
    expect(screen.getByTestId('streams-empty-state')).toBeInTheDocument()
  })
})
