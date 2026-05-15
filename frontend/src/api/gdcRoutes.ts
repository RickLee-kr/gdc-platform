import { requestJson, safeRequestJson } from '../api'
import { GDC_API_PREFIX } from './gdcApiPrefix'

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
  return requestJson<RouteRead>(`${GDC_API_PREFIX}/routes/`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function fetchRoutesList(): Promise<RouteRead[] | null> {
  const raw = await safeRequestJson<unknown>(`${GDC_API_PREFIX}/routes/`)
  if (!Array.isArray(raw)) return null
  const out: RouteRead[] = []
  for (const row of raw) {
    if (row && typeof row === 'object' && 'id' in row && typeof (row as RouteRead).id === 'number') {
      out.push(row as RouteRead)
    }
  }
  return out.length ? out : null
}

export async function updateRoute(routeId: number, payload: RouteWritePayload): Promise<RouteRead> {
  return requestJson<RouteRead>(`${GDC_API_PREFIX}/routes/${routeId}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  })
}

export async function deleteRoute(routeId: number): Promise<void> {
  await requestJson<unknown>(`${GDC_API_PREFIX}/routes/${routeId}`, {
    method: 'DELETE',
  })
}
