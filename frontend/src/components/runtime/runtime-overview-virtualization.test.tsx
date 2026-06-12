import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RuntimeOverviewPage } from './runtime-overview-page'
import { buildOperationalSnapshotWithStreams } from '../../test/runtime-scale-fixtures'

const streamCount = 320

vi.mock('../../api/operationalSnapshot', () => ({
  clearOperationalSnapshotCache: vi.fn(),
  getOperationalSnapshot: vi.fn(),
}))

vi.mock('../../api/gdcRuntime', () => ({
  fetchStreamRuntimeMetrics: vi.fn(),
  fetchRuntimeDashboardSummary: vi.fn(),
  fetchRuntimeStatus: vi.fn(),
  fetchRuntimeLogsPage: vi.fn(),
  fetchRuntimeAlertSummary: vi.fn(),
  fetchRuntimeSystemResources: vi.fn(),
  fetchStreamRuntimeStatsHealth: vi.fn(),
  fetchStreamRuntimeStats: vi.fn(),
  startRuntimeStream: vi.fn(),
  stopRuntimeStream: vi.fn(),
  runStreamOnce: vi.fn(),
}))

vi.mock('../../api/observabilitySummary', () => ({
  fetchObservabilitySummary: vi.fn(),
}))

vi.mock('../../api/gdcStreams', () => ({
  fetchStreamsListResult: vi.fn(),
}))

describe('RuntimeOverviewPage stream grid virtualization', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    const snap = await import('../../api/operationalSnapshot')
    vi.mocked(snap.getOperationalSnapshot).mockResolvedValue(buildOperationalSnapshotWithStreams(streamCount))
  })

  it('mounts only a viewport window of stream cards for 300+ streams', async () => {
    const user = userEvent.setup()
    const snap = await import('../../api/operationalSnapshot')
    const runtime = await import('../../api/gdcRuntime')

    render(
      <MemoryRouter>
        <RuntimeOverviewPage />
      </MemoryRouter>,
    )

    await waitFor(() => expect(screen.getByTestId('runtime-stream-virtual-scroll')).toBeInTheDocument())
    await user.selectOptions(screen.getByLabelText('Group streams by'), 'none')

    const cards = screen.queryAllByTestId(/^runtime-stream-card-/)
    expect(cards.length).toBeGreaterThan(0)
    expect(cards.length).toBeLessThan(streamCount)
    expect(cards.length).toBeLessThan(40)

    expect(screen.getByTestId('runtime-stream-card-1')).toBeInTheDocument()
    expect(snap.getOperationalSnapshot).toHaveBeenCalledTimes(1)
    expect(runtime.fetchStreamRuntimeMetrics).not.toHaveBeenCalled()
  })

  it('changes the visible card window when the virtual grid is scrolled', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <RuntimeOverviewPage />
      </MemoryRouter>,
    )

    await waitFor(() => expect(screen.getByTestId('runtime-stream-virtual-scroll')).toBeInTheDocument())
    await user.selectOptions(screen.getByLabelText('Group streams by'), 'none')
    await waitFor(() => expect(screen.getByTestId('runtime-stream-card-1')).toBeInTheDocument())

    const scroll = screen.getByTestId('runtime-stream-virtual-scroll')
    Object.defineProperty(scroll, 'clientHeight', { value: 420, configurable: true })
    Object.defineProperty(scroll, 'scrollTop', { value: 7000, writable: true, configurable: true })

    await act(async () => {
      fireEvent.scroll(scroll)
    })

    await waitFor(() => {
      expect(screen.queryByTestId('runtime-stream-card-1')).not.toBeInTheDocument()
      expect(screen.getByTestId('runtime-stream-card-50')).toBeInTheDocument()
    })
  })
})
