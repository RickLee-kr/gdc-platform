import type { DestinationListItem } from '../../api/gdcDestinations'
import type {
  OperationalDestinationSnapshot,
  OperationalSnapshotResponse,
} from '../../api/operationalSnapshot'
import type {
  DestinationDeliveryOutcomeRow,
  DestinationHealthRow,
  RouteFailuresAnalyticsResponse,
  RouteHealthRow,
  RuntimeLogSearchItem,
} from '../../api/types/gdcApi'
import {
  selectDestinationKpi,
  selectRouteKpi,
  type OperationalUiHealthLabel,
} from '../../lib/operational-snapshot-selectors'
import { resolveDestinationListUiHealth } from '../../utils/destination-connectivity-health'

export type DestinationUiHealth = OperationalUiHealthLabel

export type DestinationRuntimeLookup = {
  snapshot: OperationalDestinationSnapshot | null
  kpi: ReturnType<typeof selectDestinationKpi> | null
}

export type DestinationListRuntimeMetrics = {
  connectedStreams: number
  connectedRoutes: number
  successRatePct: number | null
  currentEps: number | null
  health: DestinationUiHealth
  recentIssues: string[]
}

export function destinationRuntimeWindowLabel(): string {
  return 'snapshot'
}

export function resolveDestinationUiHealth(
  enabled: boolean,
  snapshot: OperationalDestinationSnapshot | null,
  _health: DestinationHealthRow | null = null,
): DestinationUiHealth {
  if (!enabled) return 'Disabled'
  if (snapshot == null) return 'Idle'
  return selectDestinationKpi(snapshot).health.label
}

export function computeDestinationSuccessRate(
  _health: DestinationHealthRow | null,
  _outcome: DestinationDeliveryOutcomeRow | null,
  snapshot: OperationalDestinationSnapshot | null,
): number | null {
  if (snapshot == null) return null
  return selectDestinationKpi(snapshot).successRatePct
}

export function computeDestinationCurrentEps(snapshot: OperationalDestinationSnapshot | null): number | null {
  if (snapshot == null) return null
  return selectDestinationKpi(snapshot).inboundEps1m
}

export function buildDestinationRuntimeLookup(
  snapshot: OperationalSnapshotResponse | null,
): Map<number, DestinationRuntimeLookup> {
  const snapById = new Map<number, OperationalDestinationSnapshot>()
  for (const row of snapshot?.destinations ?? []) snapById.set(row.destination_id, row)

  const problems = snapshot?.problems ?? []
  const out = new Map<number, DestinationRuntimeLookup>()
  for (const [id, snap] of snapById) {
    out.set(id, {
      snapshot: snap,
      kpi: selectDestinationKpi(snap, problems),
    })
  }
  return out
}

export function listRuntimeMetricsForDestination(
  row: DestinationListItem,
  lookup: Map<number, DestinationRuntimeLookup>,
): DestinationListRuntimeMetrics {
  const runtime = lookup.get(row.id) ?? { snapshot: null, kpi: null }
  const kpi = runtime.kpi
  const connectedRoutes = runtime.snapshot?.route_count ?? row.routes?.length ?? 0
  const connectedStreams = row.streams_using_count ?? 0
  const snapshotLabel = kpi?.health.label
  return {
    connectedStreams,
    connectedRoutes,
    successRatePct: kpi?.successRatePct ?? null,
    currentEps: kpi?.inboundEps1m ?? null,
    health: resolveDestinationListUiHealth(row, runtime.snapshot, snapshotLabel),
    recentIssues: kpi?.issues.slice(0, 3) ?? [],
  }
}

export function connectedStreamIdsFromRoutes(routes: DestinationListItem['routes']): number[] {
  const ids = new Set<number>()
  for (const r of routes ?? []) {
    if (typeof r.stream_id === 'number') ids.add(r.stream_id)
  }
  return [...ids]
}

export function mapLogToDeliveryActivity(log: RuntimeLogSearchItem, routeNameById: Map<number, string>) {
  const statusRaw = String(log.status ?? '').toUpperCase()
  let status: 'SUCCESS' | 'RETRY' | 'FAILED' = 'SUCCESS'
  if (statusRaw.includes('FAIL') || log.level === 'ERROR') status = 'FAILED'
  else if (statusRaw.includes('RETRY') || (log.retry_count ?? 0) > 0) status = 'RETRY'

  const routeLabel =
    log.route_id != null
      ? routeNameById.get(log.route_id) ?? `Route #${log.route_id}`
      : '—'

  return {
    id: String(log.id),
    time: log.created_at?.slice(0, 19).replace('T', ' ') ?? '—',
    routeName: routeLabel,
    status,
    events: 1,
    latencyMs: log.latency_ms != null ? Math.round(log.latency_ms) : 0,
    message: (log.message ?? log.error_code ?? '—').trim() || '—',
  }
}

export function mapLogToRecentFailure(log: RuntimeLogSearchItem, routeNameById: Map<number, string>) {
  const code = (log.error_code ?? 'DELIVERY_ERROR').toUpperCase()
  const allowed = ['TIMEOUT', 'CONN_REFUSED', 'RATE_LIMIT', 'TLS_HANDSHAKE'] as const
  const normalized = allowed.includes(code as (typeof allowed)[number])
    ? (code as (typeof allowed)[number])
    : ('TIMEOUT' as const)

  return {
    id: String(log.id),
    at: log.created_at?.slice(0, 19).replace('T', ' ') ?? '—',
    code: normalized,
    routeName:
      log.route_id != null
        ? routeNameById.get(log.route_id) ?? `Route #${log.route_id}`
        : '—',
    failedEvents: 1,
    message: (log.message ?? '').trim(),
  }
}

export function routeMetricsFromSnapshot(
  routeId: number,
  snapshotRoutes: OperationalSnapshotResponse['routes'] | null | undefined,
  problems: OperationalSnapshotResponse['problems'] | null | undefined,
): {
  epsAvg: number
  successRate24h: number
  status: 'ACTIVE' | 'PAUSED' | 'ERROR'
  deliveryMode: string
} {
  const snap = (snapshotRoutes ?? []).find((r) => r.route_id === routeId)
  if (snap == null) {
    return { epsAvg: 0, successRate24h: 0, status: 'ACTIVE', deliveryMode: '—' }
  }
  const kpi = selectRouteKpi(snap, problems ?? [])

  let status: 'ACTIVE' | 'PAUSED' | 'ERROR' = 'ACTIVE'
  if (!snap.enabled) status = 'PAUSED'
  else if (snap.health_status === 'ERROR') status = 'ERROR'

  return {
    epsAvg: snap.delivered_eps_1m ?? 0,
    successRate24h: kpi.successRatePct ?? 0,
    status,
    deliveryMode: snap.failure_policy?.trim() || '—',
  }
}

export function routeMetricsFromHealthAndSnapshot(
  routeId: number,
  _streamName: string,
  _streamId: number,
  _routeHealth: RouteHealthRow | null,
  snapshotRoutes: OperationalSnapshotResponse['routes'] | null | undefined,
  problems?: OperationalSnapshotResponse['problems'] | null | undefined,
) {
  return routeMetricsFromSnapshot(routeId, snapshotRoutes, problems)
}

export function failureCountFromAnalytics(failures: RouteFailuresAnalyticsResponse | null): number {
  if (failures?.totals == null) return 0
  return failures.totals.failure_events ?? 0
}
