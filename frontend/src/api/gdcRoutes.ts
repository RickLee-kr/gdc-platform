import { requestJson, safeRequestJson } from '../api'
import {
  canUseOperationalFixture,
  loadOperationalSnapshotFixture,
  routeReadsFromOperationalSnapshot,
} from '../lib/runtime-operational-fixture-mode'
import { CATALOG_LIST_CACHE_TTL_MS, CATALOG_ROUTES_LIST_KEY } from './catalogListCache'
import { GDC_API_PREFIX } from './gdcApiPrefix'
import { invalidateStreamMappingUiConfigCache } from './gdcRuntime'
import { readJsonWithSignal, type GdcSignalOptions } from './gdcSignalOptions'
import { cachedRequest, clearSharedRequestCache } from './requestCache'

const ROUTES_LIST_CACHE_NS = 'catalog-routes'

function invalidateRoutesCatalogCache(): void {
  clearSharedRequestCache(ROUTES_LIST_CACHE_NS, CATALOG_ROUTES_LIST_KEY)
}

export type RouteRead = {
  id: number
  name?: string | null
  stream_id?: number | null
  destination_id?: number | null
  status?: string | null
  enabled?: boolean | null
  disable_reason?: string | null
  description?: string | null
  failure_policy?: string | null
  formatter_config_json?: Record<string, unknown> | null
  rate_limit_json?: Record<string, unknown> | null
}

export type RouteWritePayload = {
  name?: string | null
  stream_id?: number | null
  destination_id?: number | null
  status?: string | null
  enabled?: boolean | null
  description?: string | null
  failure_policy?: string | null
  formatter_config_json?: Record<string, unknown> | null
  rate_limit_json?: Record<string, unknown> | null
}

export async function fetchRouteById(routeId: number): Promise<RouteRead | null> {
  const raw = await safeRequestJson<unknown>(`${GDC_API_PREFIX}/routes/${routeId}`)
  if (raw === null || Array.isArray(raw) || typeof raw !== 'object') return null
  if (!('id' in raw) || typeof (raw as RouteRead).id !== 'number') return null
  return raw as RouteRead
}

export async function createRoute(payload: RouteWritePayload): Promise<RouteRead> {
  const created = await requestJson<RouteRead>(`${GDC_API_PREFIX}/routes/`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
  invalidateRoutesCatalogCache()
  if (typeof payload.stream_id === 'number' && Number.isFinite(payload.stream_id)) {
    invalidateStreamMappingUiConfigCache(payload.stream_id)
  }
  return created
}

async function fetchRoutesListUncached(signal?: AbortSignal): Promise<RouteRead[] | null> {
  if (await canUseOperationalFixture()) {
    const snapshot = await loadOperationalSnapshotFixture()
    if (snapshot != null) return routeReadsFromOperationalSnapshot(snapshot)
  }
  const raw = await safeRequestJson<unknown>(`${GDC_API_PREFIX}/routes/`, readJsonWithSignal({}, signal))
  if (!Array.isArray(raw)) return null
  const out: RouteRead[] = []
  for (const row of raw) {
    if (row && typeof row === 'object' && 'id' in row && typeof (row as RouteRead).id === 'number') {
      out.push(row as RouteRead)
    }
  }
  return out.length ? out : null
}

export async function fetchRoutesList(options?: GdcSignalOptions): Promise<RouteRead[] | null> {
  return cachedRequest(
    ROUTES_LIST_CACHE_NS,
    CATALOG_ROUTES_LIST_KEY,
    (signal) => fetchRoutesListUncached(signal),
    { ttlMs: CATALOG_LIST_CACHE_TTL_MS, signal: options?.signal },
  )
}

export async function updateRoute(routeId: number, payload: RouteWritePayload): Promise<RouteRead> {
  const updated = await requestJson<RouteRead>(`${GDC_API_PREFIX}/routes/${routeId}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  })
  invalidateRoutesCatalogCache()
  if (typeof payload.stream_id === 'number' && Number.isFinite(payload.stream_id)) {
    invalidateStreamMappingUiConfigCache(payload.stream_id)
  }
  return updated
}

export type DeleteRouteOptions = {
  streamId?: number
}

export async function deleteRoute(routeId: number, options?: DeleteRouteOptions): Promise<void> {
  await requestJson<unknown>(`${GDC_API_PREFIX}/routes/${routeId}`, {
    method: 'DELETE',
  })
  invalidateRoutesCatalogCache()
  if (options?.streamId != null && Number.isFinite(options.streamId)) {
    invalidateStreamMappingUiConfigCache(options.streamId)
  }
}
