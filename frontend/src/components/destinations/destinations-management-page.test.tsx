import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { DestinationsManagementPage } from './destinations-management-page'

vi.mock('../../api/gdcStreams', () => ({
  fetchStreamsList: vi.fn(async () => []),
}))

vi.mock('../../api/gdcDestinations', () => ({
  fetchDestinationsList: vi.fn(async () => [
    {
      id: 9,
      name: 'MDS',
      destination_type: 'SYSLOG_UDP',
      config_json: { host: '10.0.0.1', port: 514 },
      rate_limit_json: {},
      enabled: true,
      streams_using_count: 1,
      routes: [{ route_id: 1, stream_id: 1, stream_name: 'Stream A', route_enabled: true, route_status: 'ENABLED' }],
    },
  ]),
  createDestination: vi.fn(),
  updateDestination: vi.fn(),
  deleteDestination: vi.fn(),
  previewTestDestination: vi.fn(),
  testDestination: vi.fn(async () => ({
    success: true,
    latency_ms: 3,
    message: 'ok',
    tested_at: '2026-05-09T12:00:00Z',
    detail: null,
  })),
}))

describe('DestinationsManagementPage', () => {
  it('renders Test button for each destination', async () => {
    render(
      <MemoryRouter>
        <DestinationsManagementPage />
      </MemoryRouter>,
    )
    expect(await screen.findByRole('button', { name: /test/i })).toBeInTheDocument()
  })
})
