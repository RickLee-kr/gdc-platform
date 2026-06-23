import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { StreamsConsole } from './streams-console'
import { clearStreamsConsoleSnapshot } from './streams-console-cache'

vi.mock('../../api/gdcStreams', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/gdcStreams')>()
  return {
    ...actual,
    fetchStreamsListResult: vi.fn(),
  }
})

vi.mock('../../api/gdcRuntime', () => ({
  fetchRuntimeDashboardSummary: vi.fn(async () => null),
  fetchStreamMappingUiConfig: vi.fn(async (streamId: number) => ({
    source_id: streamId,
    source_type: 'HTTP_API_POLLING',
    mapping: { exists: true, field_mappings: { a: 'b' } },
    enrichment: { exists: false, enabled: false, enrichment: {} },
    routes: [],
  })),
  fetchBulkStreamStatsHealth: vi.fn(async () => ({
    window: '1h',
    streams: {},
  })),
  fetchStreamRuntimeStatsHealth: vi.fn(async () => ({
    stats: { events_processed_1h: 10 },
    health: { status: 'healthy' },
  })),
  runStreamOnce: vi.fn(),
}))

vi.mock('../../api/gdcConnectors', () => ({
  fetchConnectorById: vi.fn(async (id: number) => ({
    id,
    name: 'e2e-connector',
    product_group: 'e2e-connector',
  })),
}))

vi.mock('../../api/gdcDestinations', () => ({ fetchDestinationsList: vi.fn(async () => []) }))
vi.mock('../../api/gdcRoutes', () => ({ fetchRoutesList: vi.fn(async () => []) }))
vi.mock('../../api/operationalSnapshot', () => ({
  getOperationalSnapshot: vi.fn(async () => ({
    global: { health_status: 'HEALTHY', total_streams: 0, running_streams: 0, total_eps_1m: 0 },
    streams: [],
    routes: [],
    destinations: [],
    problems: [],
    updated_at: '2026-01-01T00:00:00Z',
  })),
}))

import { fetchStreamsListResult } from '../../api/gdcStreams'
import { fetchStreamMappingUiConfig } from '../../api/gdcRuntime'

describe('StreamsConsole P1 lazy mapping-ui enrichment', () => {
  afterEach(() => {
    vi.clearAllMocks()
    clearStreamsConsoleSnapshot()
  })

  it('does not fetch mapping-ui config on initial load when groups are collapsed', async () => {
    vi.mocked(fetchStreamsListResult).mockResolvedValue({
      ok: true,
      status: 200,
      data: Array.from({ length: 10 }, (_, i) => ({
        id: i + 1,
        name: `stream-${i + 1}`,
        connector_id: 10,
        stream_type: 'HTTP_API_POLLING',
        status: 'RUNNING',
      })),
    })

    render(
      <MemoryRouter>
        <StreamsConsole />
      </MemoryRouter>,
    )

    await screen.findByTestId('stream-group-row-e2e-connector')
    await waitFor(() => {
      expect(vi.mocked(fetchStreamMappingUiConfig)).not.toHaveBeenCalled()
    })
  })

  it('fetches mapping-ui config only for streams in an expanded group', async () => {
    vi.mocked(fetchStreamsListResult).mockResolvedValue({
      ok: true,
      status: 200,
      data: [
        {
          id: 1,
          name: 'stream-alpha',
          connector_id: 10,
          stream_type: 'HTTP_API_POLLING',
          status: 'RUNNING',
        },
        {
          id: 2,
          name: 'stream-beta',
          connector_id: 10,
          stream_type: 'HTTP_API_POLLING',
          status: 'RUNNING',
        },
      ],
    })

    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <StreamsConsole />
      </MemoryRouter>,
    )

    const groupRow = await screen.findByTestId('stream-group-row-e2e-connector')
    await user.click(groupRow)

    await waitFor(() => {
      expect(vi.mocked(fetchStreamMappingUiConfig)).toHaveBeenCalledTimes(2)
    })
    expect(vi.mocked(fetchStreamMappingUiConfig)).toHaveBeenCalledWith(1, expect.objectContaining({ signal: expect.any(AbortSignal) }))
    expect(vi.mocked(fetchStreamMappingUiConfig)).toHaveBeenCalledWith(2, expect.objectContaining({ signal: expect.any(AbortSignal) }))
  })
})
