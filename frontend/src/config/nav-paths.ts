import type { AppNavKey } from './app-navigation'

/** Browser paths for primary sidebar destinations (SPA). */
export const NAV_PATH: Record<AppNavKey, string> = {
  dashboard: '/',
  connectors: '/connectors',
  streams: '/streams',
  mappings: '/mappings',
  destinations: '/destinations',
  routes: '/routes',
  runtime: '/runtime',
  analytics: '/runtime/analytics',
  logs: '/logs',
  validation: '/validation',
  templates: '/templates',
  backup: '/operations/backup',
  settings: '/settings',
}

/** New stream wizard (frontend-only flow). */
export function newStreamPath(): string {
  return '/streams/new'
}

export function streamRuntimePath(streamId: string): string {
  return `/streams/${encodeURIComponent(streamId)}/runtime`
}

/** API test & JSON preview step (stream wizard / edit flow). */
export function streamApiTestPath(streamId: string): string {
  return `/streams/${encodeURIComponent(streamId)}/api-test`
}

export function streamEnrichmentPath(streamId: string): string {
  return `/streams/${encodeURIComponent(streamId)}/enrichment`
}

export function streamMappingPath(streamId: string): string {
  return `/streams/${encodeURIComponent(streamId)}/mapping`
}

export function streamEditPath(streamId: string): string {
  return `/streams/${encodeURIComponent(streamId)}/edit`
}

export function mappingEditPath(mappingId: string): string {
  return `/mappings/${encodeURIComponent(mappingId)}/edit`
}

export function routeEditPath(routeId: string): string {
  return `/routes/${encodeURIComponent(routeId)}/edit`
}

/** Logs explorer scoped to a stream (slug → label resolved in UI). */
export function logsPath(streamSlug?: string): string {
  if (!streamSlug || streamSlug.trim() === '') return '/logs'
  return `/logs/${encodeURIComponent(streamSlug)}`
}

/** Logs explorer with delivery_logs drill-down filters (numeric IDs match backend). */
export function logsExplorerPath(filters?: {
  route_id?: number
  stream_id?: number
  destination_id?: number
  run_id?: string
  partial_success?: boolean
  stage?: string
  status?: string
}): string {
  const q = new URLSearchParams()
  if (filters?.route_id != null && Number.isFinite(filters.route_id)) q.set('route_id', String(filters.route_id))
  if (filters?.stream_id != null && Number.isFinite(filters.stream_id)) q.set('stream_id', String(filters.stream_id))
  if (filters?.destination_id != null && Number.isFinite(filters.destination_id)) {
    q.set('destination_id', String(filters.destination_id))
  }
  if (filters?.run_id != null && String(filters.run_id).trim() !== '') q.set('run_id', String(filters.run_id).trim())
  if (filters?.partial_success === true) q.set('partial_success', 'true')
  if (filters?.partial_success === false) q.set('partial_success', 'false')
  if (filters?.stage != null && filters.stage.trim() !== '') q.set('stage', filters.stage.trim())
  if (filters?.status != null && filters.status.trim() !== '') q.set('status', filters.status.trim())
  const qs = q.toString()
  return qs ? `/logs?${qs}` : '/logs'
}

/** Runtime analytics with optional scope filters (numeric IDs match backend). */
export function runtimeAnalyticsPath(filters?: {
  window?: string
  stream_id?: number
  route_id?: number
  destination_id?: number
}): string {
  const q = new URLSearchParams()
  if (filters?.window != null && filters.window.trim() !== '') q.set('window', filters.window.trim())
  if (filters?.stream_id != null && Number.isFinite(filters.stream_id)) q.set('stream_id', String(filters.stream_id))
  if (filters?.route_id != null && Number.isFinite(filters.route_id)) q.set('route_id', String(filters.route_id))
  if (filters?.destination_id != null && Number.isFinite(filters.destination_id)) {
    q.set('destination_id', String(filters.destination_id))
  }
  const qs = q.toString()
  return qs ? `/runtime/analytics?${qs}` : '/runtime/analytics'
}

/** Runtime overview with stream/route/destination drill-down (numeric IDs match backend). */
export function runtimeOverviewPath(filters?: {
  stream_id?: number
  route_id?: number
  destination_id?: number
  run_id?: string
}): string {
  const q = new URLSearchParams()
  if (filters?.stream_id != null && Number.isFinite(filters.stream_id)) q.set('stream_id', String(filters.stream_id))
  if (filters?.route_id != null && Number.isFinite(filters.route_id)) q.set('route_id', String(filters.route_id))
  if (filters?.destination_id != null && Number.isFinite(filters.destination_id)) {
    q.set('destination_id', String(filters.destination_id))
  }
  if (filters?.run_id != null && String(filters.run_id).trim() !== '') q.set('run_id', String(filters.run_id).trim())
  const qs = q.toString()
  return qs ? `/runtime?${qs}` : '/runtime'
}

export function connectorDetailPath(connectorId: string): string {
  return `/connectors/${encodeURIComponent(connectorId)}`
}

export function destinationDetailPath(destinationId: string): string {
  return `/destinations/${encodeURIComponent(destinationId)}`
}

/** Derive which sidebar item is active from the current location. */
export function appNavKeyFromPathname(pathname: string): AppNavKey {
  if (pathname === '/' || pathname === '') return 'dashboard'
  if (pathname.startsWith('/operations')) return 'backup'
  if (pathname.startsWith('/validation')) return 'validation'
  if (pathname.startsWith('/streams')) return 'streams'
  if (pathname.startsWith('/runtime/analytics')) return 'analytics'
  const segment = pathname.split('/').filter(Boolean)[0]
  const map: Record<string, AppNavKey> = {
    connectors: 'connectors',
    mappings: 'streams',
    destinations: 'destinations',
    routes: 'routes',
    runtime: 'runtime',
    logs: 'logs',
    validation: 'validation',
    templates: 'templates',
    settings: 'settings',
  }
  return map[segment ?? ''] ?? 'dashboard'
}
