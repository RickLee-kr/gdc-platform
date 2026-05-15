import type { RouteRead } from '../../api/gdcRoutes'
import type { DestinationRead, DestinationListItem } from '../../api/gdcDestinations'
import type { StreamRead } from '../../api/types/gdcApi'
import type { RouteRuntimeMetricsRow, StreamRuntimeMetricsResponse } from '../../api/types/gdcApi'
import { resolveRouteRuntimeRows } from '../streams/route-operational-panel'

export type RouteUiStatus = 'Healthy' | 'Warning' | 'Error' | 'Disabled' | 'Idle'

export type RouteConsoleRow = {
  route: RouteRead
  stream: StreamRead | null
  destination: DestinationListItem | DestinationRead | null
  metrics: RouteRuntimeMetricsRow | null
  uiStatus: RouteUiStatus
  routeLabel: string
}

export function routePublicId(routeId: number): string {
  return `R-${String(routeId).padStart(4, '0')}`
}

export function formatFailurePolicy(policy: string | null | undefined): string {
  const p = (policy ?? '').trim()
  switch (p) {
    case 'LOG_AND_CONTINUE':
      return 'Log and Continue'
    case 'PAUSE_STREAM_ON_FAILURE':
      return 'Pause Stream on Failure'
    case 'DISABLE_ROUTE_ON_FAILURE':
      return 'Disable Route on Failure'
    case 'RETRY_AND_BACKOFF':
      return 'Retry (Exponential)'
    default:
      return p || '—'
  }
}

export function formatRateLimitCell(rateLimitJson: Record<string, unknown> | null | undefined): string {
  if (!rateLimitJson || typeof rateLimitJson !== 'object') return '—'
  const enabled = rateLimitJson.enabled
  if (enabled === false) return 'Off'
  const ps = rateLimitJson.per_second
  const burst = rateLimitJson.burst_size
  if (typeof ps === 'number' && typeof burst === 'number') return `${ps}/s · burst ${burst}`
  if (typeof ps === 'number') return `${ps}/s`
  return 'On'
}

export function formatDestinationEndpoint(
  dest: DestinationListItem | DestinationRead | null,
): { hostOrUrl: string; port: string | null; protocol: string | null } {
  if (!dest) return { hostOrUrl: '—', port: null, protocol: null }
  const cfg = dest.config_json ?? {}
  if (dest.destination_type === 'WEBHOOK_POST') {
    return {
      hostOrUrl: typeof cfg.url === 'string' && cfg.url.trim() ? cfg.url.trim() : '—',
      port: null,
      protocol: 'HTTPS',
    }
  }
  const host = typeof cfg.host === 'string' ? cfg.host : '—'
  const port = cfg.port != null ? String(cfg.port) : '514'
  const proto = dest.destination_type === 'SYSLOG_TCP' ? 'TCP' : 'UDP'
  return { hostOrUrl: host, port, protocol: proto }
}

export function backoffFieldsFromRoute(rateLimitJson: Record<string, unknown> | null | undefined): {
  maxRetries: string
  initialBackoffSec: string
  maxBackoffSec: string
} {
  if (!rateLimitJson || typeof rateLimitJson !== 'object') {
    return { maxRetries: '—', initialBackoffSec: '—', maxBackoffSec: '—' }
  }
  const maxR = rateLimitJson.max_retry
  const initB = rateLimitJson.initial_backoff_sec
  const maxB = rateLimitJson.max_backoff_sec
  return {
    maxRetries: typeof maxR === 'number' ? String(maxR) : '—',
    initialBackoffSec: typeof initB === 'number' ? String(initB) : '—',
    maxBackoffSec: typeof maxB === 'number' ? String(maxB) : '—',
  }
}

export function deriveRouteUiStatus(
  route: RouteRead,
  destEnabled: boolean,
  m: RouteRuntimeMetricsRow | null,
): RouteUiStatus {
  if (route.enabled === false || !destEnabled) return 'Disabled'
  if (!m) return 'Idle'

  const delivered = m.delivered_last_hour
  const failed = m.failed_last_hour
  const events = delivered + failed
  const sr = m.success_rate
  const lat = m.avg_latency_ms

  if (events <= 0) return 'Idle'

  if (m.connectivity_state === 'DISABLED') return 'Disabled'
  if (m.connectivity_state === 'ERROR') return 'Error'

  if (failed > 0 && delivered === 0) return 'Error'
  if (sr < 90) return 'Error'

  if (
    m.connectivity_state === 'DEGRADED' ||
    sr < 98 ||
    lat > 250 ||
    (failed > 0 && delivered > 0)
  ) {
    return 'Warning'
  }

  return 'Healthy'
}

export function buildRouteConsoleRows(
  routes: RouteRead[],
  streams: StreamRead[],
  destinations: DestinationListItem[],
  metricsByRouteId: Map<number, RouteRuntimeMetricsRow>,
): RouteConsoleRow[] {
  const streamById = new Map(streams.map((s) => [s.id, s]))
  const destById = new Map(destinations.map((d) => [d.id, d]))

  return routes.map((route) => {
    const sid = route.stream_id
    const did = route.destination_id
    const stream = typeof sid === 'number' ? streamById.get(sid) ?? null : null
    const destination = typeof did === 'number' ? destById.get(did) ?? null : null
    const m = typeof route.id === 'number' ? metricsByRouteId.get(route.id) ?? null : null
    const destEnabled = destination?.enabled !== false
    const uiStatus = deriveRouteUiStatus(route, destEnabled, m)
    const routeLabel = (route.name ?? '').trim() || routePublicId(route.id)
    return {
      route,
      stream,
      destination,
      metrics: m,
      uiStatus,
      routeLabel,
    }
  })
}

export function mergeMetricsFromStreams(metricsList: (StreamRuntimeMetricsResponse | null)[]): Map<number, RouteRuntimeMetricsRow> {
  const map = new Map<number, RouteRuntimeMetricsRow>()
  for (const m of metricsList) {
    if (!m) continue
    for (const row of resolveRouteRuntimeRows(m)) {
      map.set(row.route_id, row)
    }
  }
  return map
}

export function mergeThroughputSeries(metricsList: (StreamRuntimeMetricsResponse | null)[]): { timestamp: string; eps: number }[] {
  const acc = new Map<string, number>()
  for (const m of metricsList) {
    if (!m?.throughput_over_time?.length) continue
    for (const pt of m.throughput_over_time) {
      acc.set(pt.timestamp, (acc.get(pt.timestamp) ?? 0) + pt.events_per_sec)
    }
  }
  return [...acc.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([timestamp, eps]) => ({ timestamp, eps }))
}

export function mergeSuccessRateFromBuckets(metricsList: (StreamRuntimeMetricsResponse | null)[]): { timestamp: string; pct: number }[] {
  const delMap = new Map<string, number>()
  const failMap = new Map<string, number>()
  for (const m of metricsList) {
    if (!m?.events_over_time?.length) continue
    for (const b of m.events_over_time) {
      delMap.set(b.timestamp, (delMap.get(b.timestamp) ?? 0) + b.delivered)
      failMap.set(b.timestamp, (failMap.get(b.timestamp) ?? 0) + b.failed)
    }
  }
  const keys = new Set([...delMap.keys(), ...failMap.keys()])
  return [...keys]
    .sort((a, b) => a.localeCompare(b))
    .map((timestamp) => {
      const d = delMap.get(timestamp) ?? 0
      const f = failMap.get(timestamp) ?? 0
      const tot = d + f
      const pct = tot <= 0 ? 100 : Math.round((1000 * d) / tot) / 10
      return { timestamp, pct }
    })
}

export function aggregateDestinationDonut(metricsByRouteId: Map<number, RouteRuntimeMetricsRow>): { name: string; value: number }[] {
  const byDest = new Map<string, number>()
  for (const row of metricsByRouteId.values()) {
    const name = (row.destination_name ?? '').trim() || `Destination #${row.destination_id}`
    const v = row.delivered_last_hour + row.failed_last_hour
    if (v <= 0) continue
    byDest.set(name, (byDest.get(name) ?? 0) + v)
  }
  return [...byDest.entries()]
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)
}

export function countRouteStatuses(rows: RouteConsoleRow[]): {
  healthy: number
  warning: number
  error: number
  disabled: number
  idle: number
  total: number
} {
  let healthy = 0
  let warning = 0
  let error = 0
  let disabled = 0
  let idle = 0
  for (const r of rows) {
    switch (r.uiStatus) {
      case 'Healthy':
        healthy++
        break
      case 'Warning':
        warning++
        break
      case 'Error':
        error++
        break
      case 'Disabled':
        disabled++
        break
      case 'Idle':
        idle++
        break
      default:
        break
    }
  }
  return { healthy, warning, error, disabled, idle, total: rows.length }
}

/** Latest activity timestamp for delivery (success vs failure, whichever is newer). */
export function lastActivityIso(m: RouteRuntimeMetricsRow | null): string | null {
  if (!m) return null
  const a = m.last_success_at
  const b = m.last_failure_at
  if (!a && !b) return null
  if (!a) return b
  if (!b) return a
  return Date.parse(a) >= Date.parse(b) ? a : b
}

export function relativeShort(iso: string | null | undefined): string {
  if (!iso) return '—'
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return iso.slice(0, 19).replace('T', ' ')
  const diffSec = Math.round((Date.now() - t) / 1000)
  if (diffSec < 60) return `${diffSec}s ago`
  if (diffSec < 3600) return `${Math.round(diffSec / 60)}m ago`
  if (diffSec < 86400) return `${Math.round(diffSec / 3600)}h ago`
  return `${Math.round(diffSec / 86400)}d ago`
}
