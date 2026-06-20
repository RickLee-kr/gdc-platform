import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { StreamsConsole } from './streams-console'

vi.mock('../../api/gdcStreams', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/gdcStreams')>()
  return {
    ...actual,
    fetchStreamsListResult: vi.fn(),
  }
})

vi.mock('../../api/gdcRuntime', () => ({
  fetchRuntimeDashboardSummary: vi.fn(async () => null),
  fetchStreamMappingUiConfig: vi.fn(async () => null),
  fetchStreamRuntimeStatsHealth: vi.fn(async () => null),
  runStreamOnce: vi.fn(),
}))

vi.mock('../../api/gdcConnectors', () => ({
  fetchConnectorById: vi.fn(async (id: number) => ({
    id,
    name: id === 10 ? 'office365-connector' : 'aws-connector',
    product_group: id === 10 ? 'Office365' : 'Amazon Web Services',
  })),
}))

vi.mock('../../api/gdcRoutes', () => ({
  fetchRoutesList: vi.fn(async () => [
    { id: 1, stream_id: 2, destination_id: 99, name: 'Route to Splunk' },
  ]),
}))

vi.mock('../../api/gdcDestinations', () => ({
  fetchDestinationsList: vi.fn(async () => [{ id: 99, name: 'Splunk Prod', destination_type: 'WEBHOOK_POST' }]),
}))

import { fetchStreamsListResult } from '../../api/gdcStreams'

describe('StreamsConsole operations UX', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  beforeEach(() => {
    vi.mocked(fetchStreamsListResult).mockResolvedValue({
      ok: true,
      status: 200,
      data: [
        {
          id: 1,
          name: 'healthy-stream',
          connector_id: 10,
          stream_type: 'HTTP_API_POLLING',
          status: 'RUNNING',
        },
        {
          id: 2,
          name: 'warning-stream',
          connector_id: 10,
          stream_type: 'HTTP_API_POLLING',
          status: 'RATE_LIMITED_SOURCE',
        },
        {
          id: 3,
          name: 'critical-stream',
          connector_id: 11,
          stream_type: 'HTTP_API_POLLING',
          status: 'ERROR',
        },
      ],
    })
  })

  it('renders operations summary and problem streams panel', async () => {
    render(
      <MemoryRouter>
        <StreamsConsole />
      </MemoryRouter>,
    )
    expect(await screen.findByTestId('streams-operations-summary')).toBeInTheDocument()
    expect(screen.getByTestId('streams-problem-panel')).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByTestId('streams-ops-summary-healthy')).toHaveTextContent('1')
      expect(screen.getByTestId('streams-ops-summary-warning')).toHaveTextContent('1')
      expect(screen.getByTestId('streams-ops-summary-critical')).toHaveTextContent('1')
    })
  })

  it('filters streams via search input', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <StreamsConsole />
      </MemoryRouter>,
    )
    await screen.findByTestId('streams-search-input')
    await user.type(screen.getByTestId('streams-search-input'), 'critical-stream')
    await waitFor(() => {
      expect(screen.getByTestId('stream-group-row-Amazon Web Services')).toBeInTheDocument()
      expect(screen.queryByTestId('stream-group-row-Office365')).not.toBeInTheDocument()
    })
  })

  it('filters streams via issues-only quick filter', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <StreamsConsole />
      </MemoryRouter>,
    )
    await screen.findByTestId('streams-quick-filter-issues')
    await user.click(screen.getByTestId('streams-quick-filter-issues'))
    await waitFor(() => {
      expect(screen.getByTestId('stream-group-row-Office365')).toBeInTheDocument()
      expect(screen.getByTestId('stream-group-row-Amazon Web Services')).toBeInTheDocument()
    })
    const problemPanel = screen.getByTestId('streams-problem-panel')
    expect(within(problemPanel).getByTestId('streams-problem-row-3')).toBeInTheDocument()
  })

  it('filters streams by source product group dropdown', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <StreamsConsole />
      </MemoryRouter>,
    )
    await screen.findByTestId('streams-group-filter')
    await user.selectOptions(screen.getByTestId('streams-group-filter'), 'Office365')
    await waitFor(() => {
      expect(screen.getByTestId('stream-group-row-Office365')).toBeInTheDocument()
      expect(screen.queryByTestId('stream-group-row-Amazon Web Services')).not.toBeInTheDocument()
    })
  })

  it('shows filter empty state message', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <StreamsConsole />
      </MemoryRouter>,
    )
    await screen.findByTestId('streams-search-input')
    await user.type(screen.getByTestId('streams-search-input'), 'no-such-stream-xyz')
    await waitFor(() => {
      expect(screen.getByTestId('streams-empty-state')).toHaveTextContent('No streams match your filters.')
    })
  })

  it('highlights and expands group from dashboard expand_group deep link', async () => {
    render(
      <MemoryRouter initialEntries={['/streams?expand_group=Office365']}>
        <StreamsConsole />
      </MemoryRouter>,
    )
    const groupRow = await screen.findByTestId('stream-group-row-Office365')
    expect(groupRow.className).toMatch(/ring-violet-500/)
    expect(await screen.findByTestId('stream-group-child-row-1')).toBeInTheDocument()
  })

  it('links problem stream row to runtime page', async () => {
    render(
      <MemoryRouter>
        <StreamsConsole />
      </MemoryRouter>,
    )
    const link = await screen.findByTestId('streams-problem-row-3')
    expect(link).toHaveAttribute('href', '/streams/3/runtime')
  })
})
