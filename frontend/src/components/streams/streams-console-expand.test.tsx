import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
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
    name: id === 10 ? 'e2e-connector' : 'other-connector',
    product_group: id === 10 ? 'e2e-connector' : 'Other',
  })),
}))

import { fetchStreamsListResult } from '../../api/gdcStreams'

describe('StreamsConsole group expand', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('expands and collapses a stream group row on click', async () => {
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
    expect(screen.queryByTestId('stream-group-child-row-1')).not.toBeInTheDocument()

    await user.click(groupRow)
    expect(await screen.findByTestId('stream-group-child-row-1')).toBeInTheDocument()
    expect(screen.getByTestId('stream-group-child-row-2')).toBeInTheDocument()

    await user.click(groupRow)
    await waitFor(() => {
      expect(screen.queryByTestId('stream-group-child-row-1')).not.toBeInTheDocument()
    })
  })
})
