import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearSharedRequestCache, cachedRequest } from '../api/requestCache'
import { writeDestinationsListSnapshot, readDestinationsListSnapshot } from '../components/destinations/destinations-list-cache'
import { writeConnectorsOverviewSnapshot, readConnectorsOverviewSnapshot } from '../components/connectors/connectors-overview-cache'
import { writeStreamsConsoleSnapshot, readStreamsConsoleSnapshot } from '../components/streams/streams-console-cache'
import { clearSession, persistSession } from './session'

describe('auth cache isolation', () => {
  beforeEach(() => {
    clearSharedRequestCache()
    localStorage.clear()
  })

  it('clearSession drops shared request and session UI caches', async () => {
    await cachedRequest('catalog-destinations', 'list', async () => [{ id: 1 }])
    await cachedRequest('catalog-destination-by-id', '7', async () => ({ id: 7, name: 'cached-dest' }))
    await cachedRequest('catalog-route-by-id', '42', async () => ({ id: 42, name: 'cached-route' }))
    writeDestinationsListSnapshot([
      {
        id: 1,
        name: 'D',
        destination_type: 'WEBHOOK_POST',
        config_json: {},
        rate_limit_json: {},
        enabled: true,
        streams_using_count: 0,
        routes: [],
      },
    ])
    writeConnectorsOverviewSnapshot({
      baseRows: [{ id: 1 } as never],
      opsRows: [],
      operationsBacked: false,
    })
    writeStreamsConsoleSnapshot({
      displayRows: [{ id: 1 } as never],
      workflowExtrasByStreamId: {},
      sectionKpi: {} as never,
    })

    persistSession({
      access_token: 'a',
      refresh_token: 'r',
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      user: { username: 'admin', role: 'ADMINISTRATOR', status: 'active' },
    })

    clearSession()

    expect(readDestinationsListSnapshot()).toBeNull()
    expect(readConnectorsOverviewSnapshot()).toBeNull()
    expect(readStreamsConsoleSnapshot()).toBeNull()

    const loader = vi.fn(async () => [{ id: 2 }])
    await cachedRequest('catalog-destinations', 'list', loader)
    expect(loader).toHaveBeenCalledTimes(1)

    const destByIdLoader = vi.fn(async () => ({ id: 7, name: 'fresh-dest' }))
    const routeByIdLoader = vi.fn(async () => ({ id: 42, name: 'fresh-route' }))
    await cachedRequest('catalog-destination-by-id', '7', destByIdLoader)
    await cachedRequest('catalog-route-by-id', '42', routeByIdLoader)
    expect(destByIdLoader).toHaveBeenCalledTimes(1)
    expect(routeByIdLoader).toHaveBeenCalledTimes(1)
  })
})
