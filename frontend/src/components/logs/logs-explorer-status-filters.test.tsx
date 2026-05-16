import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import * as gdcRuntime from '../../api/gdcRuntime'
import { LogsExplorerPage } from './logs-explorer-page'

vi.mock('../../api/gdcStreams', () => ({ fetchStreamsList: vi.fn(async () => []) }))
vi.mock('../../api/gdcRoutes', () => ({ fetchRoutesList: vi.fn(async () => []) }))
vi.mock('../../api/gdcDestinations', () => ({ fetchDestinationsList: vi.fn(async () => []) }))
vi.mock('../../api/gdcConnectors', () => ({ fetchConnectorsList: vi.fn(async () => []) }))

const emptyPage = {
  total_returned: 0,
  has_next: false,
  next_cursor_created_at: null as string | null,
  next_cursor_id: null as number | null,
  items: [] as unknown[],
}

const emptySearch = {
  total_returned: 0,
  filters: {} as Record<string, unknown>,
  logs: [] as unknown[],
}

describe('LogsExplorerPage status URL → API', () => {
  it('passes FAILED to fetchRuntimeLogsPage when status=failed', async () => {
    const fetchPage = vi.spyOn(gdcRuntime, 'fetchRuntimeLogsPage').mockResolvedValue(emptyPage as never)
    vi.spyOn(gdcRuntime, 'searchRuntimeDeliveryLogs').mockResolvedValue(emptySearch as never)
    vi.spyOn(gdcRuntime, 'fetchRuntimeDashboardSummary').mockResolvedValue(null)

    render(
      <MemoryRouter initialEntries={['/logs?status=failed']}>
        <LogsExplorerPage />
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(fetchPage).toHaveBeenCalled()
    })
    expect(fetchPage.mock.calls[0]?.[0]).toMatchObject({
      status: 'FAILED',
    })
    fetchPage.mockRestore()
  })

  it('passes OK when status=success', async () => {
    const fetchPage = vi.spyOn(gdcRuntime, 'fetchRuntimeLogsPage').mockResolvedValue(emptyPage as never)
    vi.spyOn(gdcRuntime, 'searchRuntimeDeliveryLogs').mockResolvedValue(emptySearch as never)
    vi.spyOn(gdcRuntime, 'fetchRuntimeDashboardSummary').mockResolvedValue(null)

    render(
      <MemoryRouter initialEntries={['/logs?status=success']}>
        <LogsExplorerPage />
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(fetchPage).toHaveBeenCalled()
    })
    expect(fetchPage.mock.calls[0]?.[0]).toMatchObject({
      status: 'OK',
    })
    fetchPage.mockRestore()
  })

  it('passes route_retry_failed stage when status=retry', async () => {
    const fetchPage = vi.spyOn(gdcRuntime, 'fetchRuntimeLogsPage').mockResolvedValue(emptyPage as never)
    vi.spyOn(gdcRuntime, 'searchRuntimeDeliveryLogs').mockResolvedValue(emptySearch as never)
    vi.spyOn(gdcRuntime, 'fetchRuntimeDashboardSummary').mockResolvedValue(null)

    render(
      <MemoryRouter initialEntries={['/logs?status=retry']}>
        <LogsExplorerPage />
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(fetchPage).toHaveBeenCalled()
    })
    expect(fetchPage.mock.calls[0]?.[0]).toMatchObject({
      stage: 'route_retry_failed',
    })
    expect(fetchPage.mock.calls[0]?.[0]?.status).toBeUndefined()
    fetchPage.mockRestore()
  })

  it('shows delivery status dropdown matching URL on load', async () => {
    vi.spyOn(gdcRuntime, 'fetchRuntimeLogsPage').mockResolvedValue(emptyPage as never)
    vi.spyOn(gdcRuntime, 'searchRuntimeDeliveryLogs').mockResolvedValue(emptySearch as never)
    vi.spyOn(gdcRuntime, 'fetchRuntimeDashboardSummary').mockResolvedValue(null)

    render(
      <MemoryRouter initialEntries={['/logs?status=failed']}>
        <LogsExplorerPage />
      </MemoryRouter>,
    )

    const sel = await screen.findByLabelText(/Delivery status/i)
    expect(sel).toHaveValue('Failed')
  })
})
