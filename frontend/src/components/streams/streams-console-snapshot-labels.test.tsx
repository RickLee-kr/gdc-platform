import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { StreamsConsole } from './streams-console'

const fetchRoutesList = vi.fn(async () => [])
const fetchDestinationsList = vi.fn(async () => [])
const getOperationalSnapshot = vi.fn()
const clearOperationalSnapshotCache = vi.fn()
const fetchStreamsListResult = vi.fn()
const runStreamOnce = vi.fn()

vi.mock('../../api/gdcStreams', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/gdcStreams')>()
  return {
    ...actual,
    fetchStreamsListResult: (...args: unknown[]) => fetchStreamsListResult(...args),
  }
})

vi.mock('../../api/gdcRuntime', () => ({
  fetchStreamMappingUiConfig: vi.fn(async () => null),
  fetchStreamRuntimeStatsHealth: vi.fn(async () => null),
  runStreamOnce: (...args: unknown[]) => runStreamOnce(...args),
}))

vi.mock('../../api/gdcConnectors', () => ({
  fetchConnectorsList: vi.fn(async () => [{ id: 10, name: 'office365-connector', product_group: 'Office365' }]),
  fetchConnectorById: vi.fn(async () => ({ id: 10, name: 'office365-connector', product_group: 'Office365' })),
}))

vi.mock('../../api/gdcRoutes', () => ({
  fetchRoutesList: (...args: unknown[]) => fetchRoutesList(...args),
}))

vi.mock('../../api/gdcDestinations', () => ({
  fetchDestinationsList: (...args: unknown[]) => fetchDestinationsList(...args),
}))

vi.mock('../../api/operationalSnapshot', () => ({
  clearOperationalSnapshotCache: (...args: unknown[]) => clearOperationalSnapshotCache(...args),
  getOperationalSnapshot: (...args: unknown[]) => getOperationalSnapshot(...args),
}))

function snapshotWithRoutes(destinationName: string | null = 'Splunk Prod') {
  return {
    global: {
      health_status: 'HEALTHY',
      total_streams: 1,
      enabled_streams: 1,
      running_streams: 1,
      error_streams: 0,
      total_routes: 1,
      enabled_routes: 1,
      total_destinations: 1,
      enabled_destinations: 1,
      total_eps_1m: 1,
      total_eps_5m: 1,
      avg_latency_ms: 1,
      last_activity_at: null,
    },
    streams: [
      {
        stream_id: 2,
        stream_name: 'warning-stream',
        connector_id: 10,
        source_id: 2,
        enabled: true,
        status: 'RUNNING',
        health_status: 'HEALTHY',
        eps_1m: 1,
        eps_5m: 1,
        success_rate_5m: 99,
        failure_rate_5m: 1,
        avg_latency_ms: 10,
        route_count: 1,
        healthy_route_count: 1,
        failed_route_count: 0,
        last_success_at: null,
        last_error_at: null,
        last_error_message: null,
        checkpoint_updated_at: null,
        checkpoint_lag_seconds: null,
      },
    ],
    routes: [
      {
        route_id: 1,
        stream_id: 2,
        stream_name: 'warning-stream',
        destination_id: 99,
        destination_name: destinationName,
        destination_type: 'WEBHOOK_POST',
        enabled: true,
        failure_policy: 'LOG_AND_CONTINUE',
        health_status: 'HEALTHY',
        delivered_eps_1m: 1,
        failed_eps_1m: 0,
        success_rate_5m: 100,
        retry_rate_5m: 0,
        avg_latency_ms: 5,
        last_success_at: null,
        last_error_at: null,
        last_error_message: null,
      },
    ],
    destinations: [],
    problems: [],
    updated_at: '2026-01-01T00:00:00Z',
  }
}

describe('StreamsConsole snapshot-first destination labels', () => {
  beforeEach(() => {
    fetchRoutesList.mockClear()
    fetchDestinationsList.mockClear()
    getOperationalSnapshot.mockReset()
    clearOperationalSnapshotCache.mockClear()
    runStreamOnce.mockReset()
    getOperationalSnapshot.mockResolvedValue(snapshotWithRoutes())
    fetchStreamsListResult.mockResolvedValue({
      ok: true,
      status: 200,
      data: [
        {
          id: 2,
          name: 'warning-stream',
          connector_id: 10,
          stream_type: 'HTTP_API_POLLING',
          status: 'RUNNING',
        },
      ],
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('does not call routes/destinations catalogs on initial load or runtime refresh', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <StreamsConsole />
      </MemoryRouter>,
    )
    await screen.findByTestId('streams-operations-summary')
    await waitFor(() => {
      expect(getOperationalSnapshot.mock.calls.length).toBeGreaterThan(0)
    })

    expect(fetchRoutesList).not.toHaveBeenCalled()
    expect(fetchDestinationsList).not.toHaveBeenCalled()

    const routesBefore = fetchRoutesList.mock.calls.length
    const destBefore = fetchDestinationsList.mock.calls.length
    const snapBefore = getOperationalSnapshot.mock.calls.length

    await user.selectOptions(screen.getByTestId('streams-time-range'), '24h')
    await waitFor(() => {
      expect(getOperationalSnapshot.mock.calls.length).toBeGreaterThan(snapBefore)
    })
    expect(fetchRoutesList.mock.calls.length).toBe(routesBefore)
    expect(fetchDestinationsList.mock.calls.length).toBe(destBefore)

    for (let i = 0; i < 5; i += 1) {
      clearOperationalSnapshotCache()
      window.dispatchEvent(new CustomEvent('gdc-runtime-control-updated'))
    }
    await waitFor(() => {
      expect(getOperationalSnapshot.mock.calls.length).toBeGreaterThan(snapBefore + 1)
    })
    expect(fetchRoutesList).not.toHaveBeenCalled()
    expect(fetchDestinationsList).not.toHaveBeenCalled()
  })

  it('searches by destination label from snapshot without catalog GETs', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <StreamsConsole />
      </MemoryRouter>,
    )
    await screen.findByTestId('streams-search-input')
    await waitFor(() => expect(getOperationalSnapshot).toHaveBeenCalled())
    await user.type(screen.getByTestId('streams-search-input'), 'Splunk Prod')
    await waitFor(() => {
      expect(screen.getByTestId('stream-group-row-Office365')).toBeInTheDocument()
    })
    expect(fetchRoutesList).not.toHaveBeenCalled()
    expect(fetchDestinationsList).not.toHaveBeenCalled()
  })

  it('run-once refresh bumps snapshot path without catalog GETs', async () => {
    runStreamOnce.mockResolvedValue({ outcome: 'completed', delivered_events: 1 })
    render(
      <MemoryRouter>
        <StreamsConsole />
      </MemoryRouter>,
    )
    await screen.findByTestId('streams-operations-summary')
    await waitFor(() => expect(getOperationalSnapshot).toHaveBeenCalled())

    const snapBefore = getOperationalSnapshot.mock.calls.length
    window.dispatchEvent(
      new CustomEvent('gdc-runtime-run-once', { detail: { streamId: 2, response: { outcome: 'completed' } } }),
    )
    await waitFor(() => {
      expect(clearOperationalSnapshotCache).toHaveBeenCalled()
      expect(getOperationalSnapshot.mock.calls.length).toBeGreaterThan(snapBefore)
    })
    expect(fetchRoutesList).not.toHaveBeenCalled()
    expect(fetchDestinationsList).not.toHaveBeenCalled()
  })
})
