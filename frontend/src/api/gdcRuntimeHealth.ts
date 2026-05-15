import { GDC_DEFAULT_READ_JSON_TIMEOUT_MS, safeRequestJson } from '../api'
import { GDC_API_PREFIX } from './gdcApiPrefix'
import type {
  DestinationHealthListResponse,
  HealthOverviewResponse,
  RouteHealthDetailResponse,
  RouteHealthListResponse,
  StreamHealthDetailResponse,
  StreamHealthListResponse,
} from './types/gdcApi'

const BASE = `${GDC_API_PREFIX}/runtime/health`

const readJsonOpts = { timeoutMs: GDC_DEFAULT_READ_JSON_TIMEOUT_MS }

export type HealthWindowToken = '15m' | '1h' | '6h' | '24h'

export type HealthQueryParams = {
  window?: HealthWindowToken
  since?: string
  stream_id?: number
  route_id?: number
  destination_id?: number
}

function buildSearchParams(p: HealthQueryParams): URLSearchParams {
  const q = new URLSearchParams()
  if (p.window != null) q.set('window', p.window)
  if (p.since != null && p.since.trim() !== '') q.set('since', p.since.trim())
  if (p.stream_id != null && Number.isFinite(p.stream_id)) q.set('stream_id', String(p.stream_id))
  if (p.route_id != null && Number.isFinite(p.route_id)) q.set('route_id', String(p.route_id))
  if (p.destination_id != null && Number.isFinite(p.destination_id)) {
    q.set('destination_id', String(p.destination_id))
  }
  return q
}

export async function fetchHealthOverview(
  params: HealthQueryParams & { worst_limit?: number },
): Promise<HealthOverviewResponse | null> {
  const q = buildSearchParams(params)
  if (params.worst_limit != null && Number.isFinite(params.worst_limit)) {
    q.set('worst_limit', String(params.worst_limit))
  }
  return safeRequestJson<HealthOverviewResponse>(`${BASE}/overview?${q.toString()}`, readJsonOpts)
}

export async function fetchStreamHealthList(
  params: HealthQueryParams,
): Promise<StreamHealthListResponse | null> {
  const q = buildSearchParams(params)
  return safeRequestJson<StreamHealthListResponse>(`${BASE}/streams?${q.toString()}`, readJsonOpts)
}

export async function fetchRouteHealthList(
  params: HealthQueryParams,
): Promise<RouteHealthListResponse | null> {
  const q = buildSearchParams(params)
  return safeRequestJson<RouteHealthListResponse>(`${BASE}/routes?${q.toString()}`, readJsonOpts)
}

export async function fetchDestinationHealthList(
  params: HealthQueryParams,
): Promise<DestinationHealthListResponse | null> {
  const q = buildSearchParams(params)
  return safeRequestJson<DestinationHealthListResponse>(`${BASE}/destinations?${q.toString()}`, readJsonOpts)
}

export async function fetchStreamHealthDetail(
  streamId: number,
  params: Omit<HealthQueryParams, 'stream_id'>,
): Promise<StreamHealthDetailResponse | null> {
  const q = buildSearchParams(params)
  return safeRequestJson<StreamHealthDetailResponse>(`${BASE}/streams/${streamId}?${q.toString()}`, readJsonOpts)
}

export async function fetchRouteHealthDetail(
  routeId: number,
  params: Omit<HealthQueryParams, 'route_id'>,
): Promise<RouteHealthDetailResponse | null> {
  const q = buildSearchParams(params)
  return safeRequestJson<RouteHealthDetailResponse>(`${BASE}/routes/${routeId}?${q.toString()}`, readJsonOpts)
}
