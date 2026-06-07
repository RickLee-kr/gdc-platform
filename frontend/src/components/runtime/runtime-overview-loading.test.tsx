import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { RuntimeOverviewPage } from './runtime-overview-page'
import type { OperationalSnapshotResponse } from '../../api/operationalSnapshot'

const operationalSnapshot: OperationalSnapshotResponse = {
  global: {
    health_status: 'HEALTHY',
    total_streams: 0,
    enabled_streams: 0,
    running_streams: 0,
    error_streams: 0,
    total_routes: 0,
    enabled_routes: 0,
    total_destinations: 0,
    enabled_destinations: 0,
    total_eps_1m: 0,
    total_eps_5m: 0,
    avg_latency_ms: null,
    last_activity_at: null,
  },
  streams: [],
  routes: [],
  destinations: [],
  problems: [],
  updated_at: '2026-05-22T12:00:00Z',
}

vi.mock('../../api/operationalSnapshot', () => ({
  clearOperationalSnapshotCache: vi.fn(),
  getOperationalSnapshot: vi.fn(),
}))

vi.mock('../../api/gdcRuntime', () => ({
  fetchStreamRuntimeMetrics: vi.fn(),
}))

describe('RuntimeOverviewPage loading states', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('stops loading and shows error when snapshot is unavailable', async () => {
    const snap = await import('../../api/operationalSnapshot')
    vi.mocked(snap.getOperationalSnapshot).mockResolvedValue(null)

    render(
      <MemoryRouter>
        <RuntimeOverviewPage />
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(screen.queryByText(/Loading operational snapshot/i)).not.toBeInTheDocument()
    })
    expect(screen.getByTestId('runtime-load-error')).toHaveTextContent(/operational snapshot/i)
  })

  it('renders empty stream grid without stuck loading', async () => {
    const snap = await import('../../api/operationalSnapshot')
    vi.mocked(snap.getOperationalSnapshot).mockResolvedValue(operationalSnapshot)

    render(
      <MemoryRouter>
        <RuntimeOverviewPage />
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(screen.getByTestId('runtime-stream-flow-grid')).toBeInTheDocument()
    })
    await waitFor(() => {
      expect(screen.queryByText(/^Loading streams…$/)).not.toBeInTheDocument()
    })
    expect(screen.getByText(/No streams match filters/i)).toBeInTheDocument()
  })
})
