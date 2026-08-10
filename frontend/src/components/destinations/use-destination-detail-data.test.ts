import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useDestinationDetailData } from './use-destination-detail-data'

const fetchDestinationById = vi.fn()
const getOperationalSnapshot = vi.fn()
const fetchDestinationHealthList = vi.fn()
const fetchRouteHealthList = vi.fn()
const fetchRouteFailuresAnalytics = vi.fn()
const fetchDeliveryOutcomesByDestination = vi.fn()
const searchRuntimeDeliveryLogs = vi.fn()
const testDestination = vi.fn()

vi.mock('../../api/gdcDestinations', () => ({
  fetchDestinationById: (...args: unknown[]) => fetchDestinationById(...args),
  testDestination: (...args: unknown[]) => testDestination(...args),
}))

vi.mock('../../api/operationalSnapshot', () => ({
  getOperationalSnapshot: (...args: unknown[]) => getOperationalSnapshot(...args),
}))

vi.mock('../../api/gdcRuntimeHealth', () => ({
  fetchDestinationHealthList: (...args: unknown[]) => fetchDestinationHealthList(...args),
  fetchRouteHealthList: (...args: unknown[]) => fetchRouteHealthList(...args),
}))

vi.mock('../../api/gdcRuntimeAnalytics', () => ({
  fetchRouteFailuresAnalytics: (...args: unknown[]) => fetchRouteFailuresAnalytics(...args),
  fetchDeliveryOutcomesByDestination: (...args: unknown[]) => fetchDeliveryOutcomesByDestination(...args),
}))

vi.mock('../../api/gdcRuntime', () => ({
  searchRuntimeDeliveryLogs: (...args: unknown[]) => searchRuntimeDeliveryLogs(...args),
}))

function detail(id: number, name: string) {
  return {
    id,
    name,
    destination_type: 'WEBHOOK_POST',
    config_json: { url: `https://example.com/${id}` },
    rate_limit_json: {},
    enabled: true,
  }
}

function emptyRuntime() {
  getOperationalSnapshot.mockResolvedValue({
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
      avg_latency_ms: 0,
      last_activity_at: null,
    },
    streams: [],
    routes: [],
    destinations: [],
    problems: [],
    updated_at: '2026-08-10T00:00:00Z',
  })
  fetchDestinationHealthList.mockResolvedValue({ rows: [] })
  fetchRouteHealthList.mockResolvedValue({ rows: [] })
  fetchRouteFailuresAnalytics.mockResolvedValue(null)
  fetchDeliveryOutcomesByDestination.mockResolvedValue({ rows: [] })
  searchRuntimeDeliveryLogs.mockResolvedValue({ logs: [] })
}

describe('useDestinationDetailData ownership + stale protection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    emptyRuntime()
  })

  it('loads destination once per id (no duplicate ownership fan-out on mount)', async () => {
    fetchDestinationById.mockResolvedValue(detail(7, 'Dest-7'))
    const { result } = renderHook(() => useDestinationDetailData(7))
    await waitFor(() => expect(result.current.loading).toBe(false))
    await waitFor(() => expect(result.current.runtimeLoading).toBe(false))
    expect(fetchDestinationById).toHaveBeenCalledTimes(1)
    expect(fetchDestinationById).toHaveBeenCalledWith(7)
    expect(result.current.destination?.name).toBe('Dest-7')
  })

  it('ignores stale destination A response after switching to B', async () => {
    let resolveA: (value: ReturnType<typeof detail>) => void = () => undefined
    const slowA = new Promise<ReturnType<typeof detail>>((resolve) => {
      resolveA = resolve
    })
    fetchDestinationById.mockImplementation(async (id: number) => {
      if (id === 1) return slowA
      return detail(2, 'Dest-B')
    })

    const { result, rerender } = renderHook(
      ({ id }: { id: number }) => useDestinationDetailData(id),
      { initialProps: { id: 1 } },
    )

    rerender({ id: 2 })
    await waitFor(() => expect(result.current.destination?.id).toBe(2))
    expect(result.current.destination?.name).toBe('Dest-B')

    await act(async () => {
      resolveA(detail(1, 'Dest-A-STALE'))
      await Promise.resolve()
    })

    expect(result.current.destination?.id).toBe(2)
    expect(result.current.destination?.name).toBe('Dest-B')
  })

  it('refreshes destination after connectivity test (mutation invalidation)', async () => {
    fetchDestinationById
      .mockResolvedValueOnce(detail(3, 'Before'))
      .mockResolvedValueOnce(detail(3, 'After-Test'))
    testDestination.mockResolvedValue({
      success: true,
      latency_ms: 12,
      message: 'ok',
      tested_at: '2026-08-10T00:00:00Z',
    })

    const { result } = renderHook(() => useDestinationDetailData(3))
    await waitFor(() => expect(result.current.destination?.name).toBe('Before'))

    await act(async () => {
      const out = await result.current.runConnectivityTest()
      expect(out.success).toBe(true)
    })

    await waitFor(() => expect(result.current.destination?.name).toBe('After-Test'))
    expect(fetchDestinationById).toHaveBeenCalledTimes(2)
  })
})
