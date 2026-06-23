import { renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { useDestinationsOverviewData } from './use-destinations-overview-data'

vi.mock('../../api/gdcDestinations', () => ({
  fetchDestinationsList: vi.fn(async () => [
    {
      id: 1,
      name: 'Webhook',
      destination_type: 'WEBHOOK_POST',
      config_json: { url: 'https://example.com/hook' },
      rate_limit_json: {},
      enabled: true,
      streams_using_count: 1,
      routes: [{ route_id: 3, stream_id: 9, stream_name: 'S9', route_enabled: true, route_status: 'ENABLED' }],
      created_at: null,
      updated_at: null,
    },
  ]),
}))

vi.mock('../../api/operationalSnapshot', () => ({
  getOperationalSnapshot: vi.fn(async () => ({
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
      total_eps_1m: 2.5,
      total_eps_5m: 2.5,
      avg_latency_ms: 8,
      last_activity_at: null,
    },
    streams: [],
    routes: [],
    destinations: [
      {
        destination_id: 1,
        destination_name: 'Webhook',
        destination_type: 'WEBHOOK_POST',
        enabled: true,
        health_status: 'HEALTHY',
        inbound_eps_1m: 2.5,
        failed_eps_1m: 0,
        avg_latency_ms: 8,
        route_count: 1,
        last_success_at: null,
        last_error_at: null,
        last_error_message: null,
      },
    ],
    problems: [],
    updated_at: '2026-06-22T00:00:00Z',
  })),
}))

describe('useDestinationsOverviewData', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('merges catalog rows with snapshot runtime KPI fields without health APIs', async () => {
    const { result } = renderHook(() => useDestinationsOverviewData())
    await waitFor(() => expect(result.current.loading).toBe(false))
    await waitFor(() => expect(result.current.runtimeLoading).toBe(false))
    expect(result.current.rows).toHaveLength(1)
    expect(result.current.rows[0]?.runtime.connectedRoutes).toBe(1)
    expect(result.current.rows[0]?.runtime.currentEps).toBe(2.5)
    expect(result.current.rows[0]?.runtime.successRatePct).toBe(100)
    expect(result.current.rows[0]?.runtime.health).toBe('Healthy')
    expect(result.current.runtimeError).toBeNull()
  })

  it('surfaces runtime error when operational snapshot is unavailable', async () => {
    const operationalSnapshot = await import('../../api/operationalSnapshot')
    vi.mocked(operationalSnapshot.getOperationalSnapshot).mockResolvedValueOnce(null)
    const { result } = renderHook(() => useDestinationsOverviewData())
    await waitFor(() => expect(result.current.runtimeLoading).toBe(false))
    expect(result.current.runtimeError).toMatch(/operational snapshot/i)
    expect(result.current.rows[0]?.runtime.health).toBe('Idle')
  })
})
