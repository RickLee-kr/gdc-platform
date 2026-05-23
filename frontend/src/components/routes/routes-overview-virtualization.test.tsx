import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RoutesOverviewPage } from './routes-overview-page'
import { ROUTES_VIRTUAL_SCROLL_THRESHOLD } from './routes-table-row'
import {
  buildOperationalSnapshotWithRoutes,
  buildRouteReadList,
} from '../../test/runtime-scale-fixtures'

const routeCount = 120

vi.mock('../../api/operationalSnapshot', () => ({
  clearOperationalSnapshotCache: vi.fn(),
  getOperationalSnapshot: vi.fn(),
}))

vi.mock('../../api/gdcRoutes', () => ({
  fetchRoutesList: vi.fn(),
  updateRoute: vi.fn(),
}))

vi.mock('../../api/gdcRuntime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/gdcRuntime')>()
  return {
    ...actual,
    fetchStreamRuntimeMetrics: vi.fn(),
    saveRuntimeRouteEnabledState: vi.fn(),
    searchRuntimeDeliveryLogs: vi.fn(),
  }
})

vi.mock('../../api/gdcRuntimeAnalytics', () => ({
  fetchDeliveryOutcomesByDestination: vi.fn(),
}))

vi.mock('../../api/gdcDestinations', () => ({
  fetchDestinationById: vi.fn(),
  testDestination: vi.fn(),
}))

describe('RoutesOverviewPage virtualization', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    const snap = await import('../../api/operationalSnapshot')
    const routes = await import('../../api/gdcRoutes')
    const runtime = await import('../../api/gdcRuntime')
    vi.mocked(snap.getOperationalSnapshot).mockResolvedValue(buildOperationalSnapshotWithRoutes(routeCount))
    vi.mocked(routes.fetchRoutesList).mockResolvedValue(buildRouteReadList(routeCount))
    vi.mocked(runtime.fetchStreamRuntimeMetrics).mockResolvedValue(null)
  })

  it('mounts a virtual window of route rows, not the full filtered set', async () => {
    const snap = await import('../../api/operationalSnapshot')
    const runtime = await import('../../api/gdcRuntime')

    render(
      <MemoryRouter>
        <RoutesOverviewPage />
      </MemoryRouter>,
    )

    await waitFor(() => expect(screen.getByTestId('routes-virtual-scroll')).toBeInTheDocument())

    expect(routeCount).toBeGreaterThanOrEqual(ROUTES_VIRTUAL_SCROLL_THRESHOLD)

    const mountedRows = screen.queryAllByTestId(/^routes-table-row-/)
    expect(mountedRows.length).toBeGreaterThan(0)
    expect(mountedRows.length).toBeLessThan(routeCount)

    expect(screen.getByText(new RegExp(`Virtual scroll · \\d+ visible · ${routeCount} routes`))).toBeInTheDocument()

    expect(snap.getOperationalSnapshot).toHaveBeenCalledTimes(1)
    expect(runtime.fetchStreamRuntimeMetrics).not.toHaveBeenCalled()
  })

  it('updates visible rows when the virtual scroll container is scrolled', async () => {
    render(
      <MemoryRouter>
        <RoutesOverviewPage />
      </MemoryRouter>,
    )

    await waitFor(() => expect(screen.getByTestId('routes-table-row-1')).toBeInTheDocument())

    const scroll = screen.getByTestId('routes-virtual-scroll')
    Object.defineProperty(scroll, 'clientHeight', { value: 480, configurable: true })
    Object.defineProperty(scroll, 'scrollTop', { value: 2600, writable: true, configurable: true })

    await act(async () => {
      fireEvent.scroll(scroll)
    })

    await waitFor(() => {
      expect(screen.queryByTestId('routes-table-row-1')).not.toBeInTheDocument()
      expect(screen.getByTestId('routes-table-row-60')).toBeInTheDocument()
    })
  })
})
