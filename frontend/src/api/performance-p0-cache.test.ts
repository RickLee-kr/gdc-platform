import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as rawApi from '../api'
import { CATALOG_LIST_CACHE_TTL_MS } from './catalogListCache'
import { fetchDestinationById } from './gdcDestinations'
import { fetchRouteById, fetchRoutesList } from './gdcRoutes'
import { fetchStreamById } from './gdcStreams'
import {
  createRefreshCycleSnapshotId,
  resetRefreshCycleSnapshotIdForTests,
} from './runtimeSnapshotSync'
import { clearSharedRequestCache } from './requestCache'

describe('performance P0 — catalog read caches', () => {
  beforeEach(() => {
    clearSharedRequestCache()
    vi.restoreAllMocks()
  })

  afterEach(() => {
    clearSharedRequestCache()
  })

  it('fetchRoutesList returns cached value within TTL', async () => {
    const apiSpy = vi.spyOn(rawApi, 'safeRequestJson').mockResolvedValue([
      { id: 1, name: 'Route A', stream_id: 10, destination_id: 20 },
    ])

    const first = await fetchRoutesList()
    const second = await fetchRoutesList()

    expect(first).toHaveLength(1)
    expect(second).toEqual(first)
    expect(apiSpy).toHaveBeenCalledTimes(1)
  })

  it('fetchStreamById returns cached value within TTL', async () => {
    const apiSpy = vi.spyOn(rawApi, 'safeRequestJson').mockResolvedValue({
      id: 42,
      name: 'Stream 42',
      connector_id: 1,
    })

    const first = await fetchStreamById(42)
    const second = await fetchStreamById(42)

    expect(first?.id).toBe(42)
    expect(second).toEqual(first)
    expect(apiSpy).toHaveBeenCalledTimes(1)
  })

  it('fetchDestinationById returns cached value within TTL', async () => {
    const apiSpy = vi.spyOn(rawApi, 'safeRequestJson').mockResolvedValue({
      id: 7,
      name: 'Dest 7',
      destination_type: 'SYSLOG_UDP',
      enabled: true,
      config_json: {},
      rate_limit_json: {},
    })

    const first = await fetchDestinationById(7)
    const second = await fetchDestinationById(7)

    expect(first?.id).toBe(7)
    expect(second).toEqual(first)
    expect(apiSpy).toHaveBeenCalledTimes(1)
  })

  it('fetchRouteById returns cached value within TTL', async () => {
    const apiSpy = vi.spyOn(rawApi, 'safeRequestJson').mockResolvedValue({
      id: 42,
      name: 'Route 42',
      enabled: true,
    })

    const first = await fetchRouteById(42)
    const second = await fetchRouteById(42)

    expect(first?.id).toBe(42)
    expect(second).toEqual(first)
    expect(apiSpy).toHaveBeenCalledTimes(1)
  })
})

describe('performance P0 — refresh cycle snapshot_id', () => {
  beforeEach(() => {
    resetRefreshCycleSnapshotIdForTests()
    vi.useFakeTimers()
  })

  afterEach(() => {
    resetRefreshCycleSnapshotIdForTests()
    vi.useRealTimers()
  })

  it('reuses snapshot_id within the 15s refresh cycle TTL', () => {
    const first = createRefreshCycleSnapshotId()
    vi.advanceTimersByTime(CATALOG_LIST_CACHE_TTL_MS - 1)
    const second = createRefreshCycleSnapshotId()
    expect(second).toBe(first)
  })

  it('issues a new snapshot_id after the refresh cycle TTL elapses', () => {
    const first = createRefreshCycleSnapshotId()
    vi.advanceTimersByTime(CATALOG_LIST_CACHE_TTL_MS)
    const second = createRefreshCycleSnapshotId()
    expect(second).not.toBe(first)
  })
})
