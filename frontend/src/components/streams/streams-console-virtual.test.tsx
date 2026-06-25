import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { StreamsConsole } from './streams-console'

vi.mock('../../api/gdcStreams', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/gdcStreams')>()
  return {
    ...actual,
    fetchStreamsListResult: vi.fn(async () => ({
      ok: true as const,
      status: 200,
      data: Array.from({ length: 60 }, (_, i) => ({
        id: i + 1,
        name: `Stream ${i + 1}`,
        connector_id: 1,
        source_id: 1,
        enabled: true,
        stream_type: 'HTTP_API_POLLING',
        polling_interval: 60,
      })),
    })),
    fetchStreamById: vi.fn(async () => null),
  }
})
vi.mock('../../api/gdcConnectors', () => ({
  fetchConnectorById: vi.fn(async () => ({ id: 1, name: 'Connector 1' })),
}))
vi.mock('../../api/gdcRuntime', () => ({
  fetchRuntimeDashboardSummary: vi.fn(async () => null),
  fetchStreamMappingUiConfig: vi.fn(async () => null),
  fetchBulkStreamStatsHealth: vi.fn(async () => null),
  fetchStreamRuntimeStatsHealth: vi.fn(async () => null),
  fetchStreamRuntimeTimeline: vi.fn(async () => null),
  fetchStreamRuntimeStats: vi.fn(async () => null),
  fetchStreamRuntimeMetrics: vi.fn(async () => null),
  fetchStreamById: vi.fn(async () => null),
  searchRuntimeDeliveryLogs: vi.fn(async () => null),
  fetchRuntimeLogsPage: vi.fn(async () => null),
  startRuntimeStream: vi.fn(async () => ({ message: 'ok' })),
  stopRuntimeStream: vi.fn(async () => ({ message: 'ok' })),
  runStreamOnce: vi.fn(async () => ({ message: 'ok' })),
}))
vi.mock('../../api/gdcRoutes', () => ({ fetchRoutesList: vi.fn(async () => []) }))
vi.mock('../../api/gdcDestinations', () => ({ fetchDestinationsList: vi.fn(async () => []) }))
vi.mock('../../api/operationalSnapshot', () => ({
  clearOperationalSnapshotCache: vi.fn(),
  getOperationalSnapshot: vi.fn(async () => ({
    global: { health_status: 'HEALTHY', total_streams: 0, running_streams: 0, total_eps_1m: 0 },
    streams: [],
    routes: [],
    destinations: [],
    problems: [],
    updated_at: '2026-01-01T00:00:00Z',
  })),
}))

describe('StreamsConsole virtualization', () => {
  it(
    'enables virtual scroll when stream count exceeds threshold',
    async () => {
      render(
        <MemoryRouter>
          <StreamsConsole />
        </MemoryRouter>,
      )

      expect(await screen.findByTestId('streams-console-virtual-scroll')).toBeInTheDocument()
      expect(screen.getByText(/Showing 60 streams/i)).toBeInTheDocument()
    },
    15000,
  )
})
