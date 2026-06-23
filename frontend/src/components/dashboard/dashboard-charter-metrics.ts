import type { ConnectorRead } from '../../api/gdcConnectors'
import type { DestinationListItem } from '../../api/gdcDestinations'
import type { OperationalSnapshotResponse } from '../../api/operationalSnapshot'
import { mapBackendStreamStatus } from '../../api/streamRows'
import type {
  DashboardOutcomeTimeseriesResponse,
  DashboardSummaryResponse,
  HealthOverviewResponse,
  ObservabilitySummaryResponse,
  RuntimeAlertSummaryItem,
  StreamRead,
} from '../../api/types/gdcApi'
import { formatThroughputEps } from '../../lib/observability-format'
import {
  aggregateDeliverySuccessRateFromSnapshot,
  countHealthFromRows,
  deriveOverallHealthPostureFromSnapshot,
  formatOperationalEps,
  formatOperationalSuccessRate,
  selectGlobalKpi,
} from '../../lib/operational-snapshot-selectors'
import { formatCompactInt } from '../runtime/runtime-monitoring-aggregates'
import {
  groupRowsBySourceProduct,
  type ProductStreamGroup,
  type StreamRuntimeStatus,
} from '../../lib/source-product-group'

export type OverallHealthCounts = {
  healthy: number
  warning: number
  critical: number
  posture: 'healthy' | 'warning' | 'critical'
}

export type StreamGroupHealthCounts = {
  healthy: number
  warning: number
  critical: number
  groups: ProductStreamGroup<StreamGroupRow>[]
}

export type StreamGroupRow = {
  connectorName: string
  connectorProductGroup?: string | null
  status: StreamRuntimeStatus
}

export type TrafficOverviewMetrics = {
  incomingEvents: number | null
  outgoingEvents: number | null
  deliverySuccessRatePct: number | null
  windowLabel: string
}

export type OperationalIssueCounts = {
  noDataStreams: number | null
  lowVolumeStreams: number | null
  schemaDriftCount: number | null
  destinationCapacityWarnings: number | null
}

export type RecentAlertsSummary = {
  total: number
  critical: number
  warning: number
  hasAlerts: boolean
}

const cardClass =
  'rounded-xl border border-slate-200/80 bg-white px-4 py-3 shadow-sm dark:border-[rgba(120,150,220,0.2)] dark:bg-[#111827]/95 dark:shadow-[0_4px_24px_-8px_rgba(0,0,0,0.5)] dark:ring-1 dark:ring-[rgba(120,150,220,0.1)]'

export { cardClass as dashboardCardClass }

function safeNonNeg(n: unknown): number {
  const x = typeof n === 'number' ? n : Number(n)
  if (!Number.isFinite(x) || x < 0) return 0
  return Math.floor(x)
}

export function deriveOverallHealth(health: HealthOverviewResponse | null): OverallHealthCounts {
  const streams = health?.streams
  const healthy = safeNonNeg(streams?.healthy)
  const warning = safeNonNeg(streams?.degraded)
  const critical = safeNonNeg(streams?.unhealthy) + safeNonNeg(streams?.critical)
  let posture: OverallHealthCounts['posture'] = 'healthy'
  if (critical > 0) posture = 'critical'
  else if (warning > 0) posture = 'warning'
  return { healthy, warning, critical, posture }
}

export function deriveOverallHealthFromSnapshot(snapshot: OperationalSnapshotResponse | null): OverallHealthCounts {
  if (snapshot == null) {
    return { healthy: 0, warning: 0, critical: 0, posture: 'healthy' }
  }
  return deriveOverallHealthPostureFromSnapshot(snapshot)
}

function streamRowsFromBundle(
  streams: readonly StreamRead[],
  connectors: readonly ConnectorRead[],
): StreamGroupRow[] {
  const connectorById = new Map<number, ConnectorRead>()
  for (const c of connectors) connectorById.set(c.id, c)

  return streams.map((s) => {
    const connector = s.connector_id != null ? connectorById.get(s.connector_id) : undefined
    return {
      connectorName: connector?.name?.trim() || (s.connector_id != null ? `Connector #${s.connector_id}` : 'Unknown source'),
      connectorProductGroup: connector?.product_group ?? null,
      status: mapBackendStreamStatus(s.status),
    }
  })
}

export function deriveStreamGroupHealth(
  streams: readonly StreamRead[],
  connectors: readonly ConnectorRead[],
): StreamGroupHealthCounts {
  const groups = groupRowsBySourceProduct(streamRowsFromBundle(streams, connectors))
  let healthy = 0
  let warning = 0
  let critical = 0
  for (const g of groups) {
    if (g.worstStatus === 'ERROR') critical += 1
    else if (g.worstStatus === 'DEGRADED') warning += 1
    else healthy += 1
  }
  return { healthy, warning, critical, groups }
}

export function deriveStreamGroupHealthFromSnapshot(
  snapshot: OperationalSnapshotResponse | null,
  connectors: readonly ConnectorRead[],
): StreamGroupHealthCounts {
  if (snapshot == null) return { healthy: 0, warning: 0, critical: 0, groups: [] }
  const connectorById = new Map<number, ConnectorRead>()
  for (const c of connectors) connectorById.set(c.id, c)
  const rows: StreamGroupRow[] = (snapshot.streams ?? []).map((s) => {
    const connector = s.connector_id != null ? connectorById.get(s.connector_id) : undefined
    const status =
      !s.enabled
        ? 'STOPPED'
        : s.health_status === 'HEALTHY'
          ? 'RUNNING'
          : s.health_status === 'DEGRADED'
            ? 'DEGRADED'
            : s.health_status === 'ERROR'
              ? 'ERROR'
              : 'STOPPED'
    return {
      connectorName: connector?.name?.trim() || (s.connector_id != null ? `Connector #${s.connector_id}` : s.stream_name),
      connectorProductGroup: connector?.product_group ?? null,
      status,
    }
  })
  const groups = groupRowsBySourceProduct(rows)
  let healthy = 0
  let warning = 0
  let critical = 0
  for (const g of groups) {
    if (g.worstStatus === 'ERROR') critical += 1
    else if (g.worstStatus === 'DEGRADED') warning += 1
    else healthy += 1
  }
  return { healthy, warning, critical, groups }
}

export function deriveTrafficOverview(
  observability: ObservabilitySummaryResponse | null,
  dashboard: DashboardSummaryResponse | null,
  windowLabel: string,
): TrafficOverviewMetrics {
  const totals = observability?.totals
  const summary = dashboard?.summary

  const incoming =
    totals?.processed_events != null
      ? safeNonNeg(totals.processed_events)
      : summary?.processed_events != null
        ? safeNonNeg(summary.processed_events)
        : null

  const outgoing =
    totals?.delivery_success_events != null
      ? safeNonNeg(totals.delivery_success_events)
      : summary?.recent_successes != null
        ? safeNonNeg(summary.recent_successes)
        : null

  const success =
    totals?.delivery_success_events != null
      ? safeNonNeg(totals.delivery_success_events)
      : summary?.recent_successes != null
        ? safeNonNeg(summary.recent_successes)
        : 0
  const failed =
    totals?.delivery_failed_events != null
      ? safeNonNeg(totals.delivery_failed_events)
      : summary?.recent_failures != null
        ? safeNonNeg(summary.recent_failures)
        : 0
  const denom = success + failed
  const deliverySuccessRatePct = denom > 0 ? (100 * success) / denom : null

  return { incomingEvents: incoming, outgoingEvents: outgoing, deliverySuccessRatePct, windowLabel }
}

const SNAPSHOT_WINDOW_SECONDS = 300

export function deriveTrafficOverviewFromSnapshot(
  snapshot: OperationalSnapshotResponse | null,
): TrafficOverviewMetrics {
  if (snapshot == null) {
    return { incomingEvents: null, outgoingEvents: null, deliverySuccessRatePct: null, windowLabel: '5m' }
  }
  const g = selectGlobalKpi(snapshot)
  const ingestEps = g.eps5m ?? g.eps1m ?? 0
  const incoming = ingestEps > 0 ? Math.round(ingestEps * SNAPSHOT_WINDOW_SECONDS) : null
  const successRate = aggregateDeliverySuccessRateFromSnapshot(snapshot)
  const outgoing =
    incoming != null && successRate != null ? Math.round((incoming * successRate) / 100) : null
  return {
    incomingEvents: incoming,
    outgoingEvents: outgoing,
    deliverySuccessRatePct: successRate,
    windowLabel: '5m',
  }
}

export function deriveOperationalIssues(
  health: HealthOverviewResponse | null,
  dashboard: DashboardSummaryResponse | null,
  streamsList: readonly StreamRead[] = [],
): OperationalIssueCounts {
  const streams = health?.streams
  const summary = dashboard?.summary

  const noDataStreams =
    streams?.excluded_no_outcome != null
      ? safeNonNeg(streams.excluded_no_outcome)
      : streams?.idle != null
        ? safeNonNeg(streams.idle)
        : null

  const lowVolumeStreams =
    streams?.degraded != null
      ? safeNonNeg(streams.degraded)
      : streamsList.length > 0
        ? streamsList.filter((s) => mapBackendStreamStatus(s.status) === 'DEGRADED').length
        : null

  const validation = dashboard?.validation_operational
  const schemaDriftCount = validation
    ? safeNonNeg(validation.open_checkpoint_drift_alerts) +
      safeNonNeg(validation.failing_validations_count) +
      safeNonNeg(validation.degraded_validations_count)
    : null

  const destinationCapacityWarnings =
    summary?.rate_limited_destination_streams != null
      ? safeNonNeg(summary.rate_limited_destination_streams)
      : health?.destinations?.degraded != null
        ? safeNonNeg(health.destinations.degraded)
        : null

  return {
    noDataStreams,
    lowVolumeStreams,
    schemaDriftCount,
    destinationCapacityWarnings,
  }
}

export function deriveOperationalIssuesFromSnapshot(
  snapshot: OperationalSnapshotResponse | null,
  dashboard: DashboardSummaryResponse | null,
): OperationalIssueCounts {
  const streams = snapshot?.streams ?? []
  const idleCount = streams.filter((s) => s.enabled && s.health_status === 'IDLE').length
  const degradedCount = streams.filter((s) => s.enabled && s.health_status === 'DEGRADED').length
  const validation = dashboard?.validation_operational
  const schemaDriftCount = validation
    ? safeNonNeg(validation.open_checkpoint_drift_alerts) +
      safeNonNeg(validation.failing_validations_count) +
      safeNonNeg(validation.degraded_validations_count)
    : null
  const destinationCapacityWarnings = (snapshot?.problems ?? []).filter(
    (p) => p.scope === 'destination' && p.severity === 'warning',
  ).length

  return {
    noDataStreams: idleCount > 0 ? idleCount : null,
    lowVolumeStreams: degradedCount > 0 ? degradedCount : null,
    schemaDriftCount,
    destinationCapacityWarnings: destinationCapacityWarnings > 0 ? destinationCapacityWarnings : null,
  }
}

export function deriveRecentAlertsSummary(alerts: readonly RuntimeAlertSummaryItem[]): RecentAlertsSummary {
  let critical = 0
  let warning = 0
  for (const item of alerts) {
    if (item.severity === 'ERROR') critical += 1
    else warning += 1
  }
  const total = critical + warning
  return { total, critical, warning, hasAlerts: total > 0 }
}

export function formatMetricCount(value: number | null | undefined): string {
  if (value == null) return '—'
  return formatCompactInt(value)
}

export function formatSuccessRate(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '—'
  return `${value.toFixed(2)}%`
}

/** Label shown on snapshot-derived rate KPIs (not affected by analytics window). */
export const SNAPSHOT_KPI_BASIS_LABEL = '5m snapshot'

export type DashboardKpiItem = {
  id: string
  label: string
  value: string
  sub: string
  /** Snapshot basis for rate KPIs; omitted when value is window-scoped (e.g. alerts). */
  basisLabel?: string
  tone: 'blue' | 'green' | 'violet' | 'teal' | 'amber' | 'red' | 'neutral'
  sparkline: number[]
}

export type TrafficChartPoint = {
  label: string
  ingested: number
  delivered: number
  failed: number
}

export type FlowLaneCounts = {
  sources: number
  streams: number
  destinations: number
  routes: number
}

export type FlowCategoryCount = {
  label: string
  count: number
}

export type FlowBreakdown = {
  sources: FlowCategoryCount[]
  streams: number
  destinations: FlowCategoryCount[]
}

export type StreamsOperationalStatus = {
  running: number
  warning: number
  stopped: number
}

export type TopSourceIngestItem = {
  name: string
  rateEps: number
}

export type SystemHealthItem = {
  id: string
  label: string
  status: 'healthy' | 'warning' | 'critical'
}

function windowSeconds(label: string): number {
  switch (label) {
    case '15m':
      return 900
    case '1h':
      return 3600
    case '6h':
      return 21600
    case '24h':
      return 86400
    default:
      return 3600
  }
}

export function deriveFlowLaneCounts(
  observability: ObservabilitySummaryResponse | null,
  dashboard: DashboardSummaryResponse | null,
  streams: readonly StreamRead[],
  connectorCount: number,
  destinationCount = 0,
): FlowLaneCounts {
  const totals = observability?.totals
  const summary = dashboard?.summary
  return {
    sources: connectorCount > 0 ? connectorCount : safeNonNeg(streams.length > 0 ? new Set(streams.map((s) => s.connector_id).filter(Boolean)).size : 0),
    streams: totals?.streams_total ?? summary?.total_streams ?? streams.length,
    destinations:
      summary?.total_destinations != null && summary.total_destinations > 0
        ? summary.total_destinations
        : destinationCount,
    routes: totals?.routes_total ?? summary?.total_routes ?? 0,
  }
}

export function deriveFlowLaneCountsFromSnapshot(
  snapshot: OperationalSnapshotResponse | null,
  connectorCount: number,
  destinationCount = 0,
): FlowLaneCounts {
  if (snapshot == null) {
    return { sources: connectorCount, streams: 0, destinations: destinationCount, routes: 0 }
  }
  const g = selectGlobalKpi(snapshot)
  return {
    sources: connectorCount > 0 ? connectorCount : new Set((snapshot.streams ?? []).map((s) => s.connector_id).filter(Boolean)).size,
    streams: g.totalStreams,
    destinations: g.totalDestinations > 0 ? g.totalDestinations : destinationCount,
    routes: g.totalRoutes,
  }
}

type SourceFlowCategory = 'Database' | 'API' | 'Files' | 'Streaming'

function connectorFlowCategory(c: ConnectorRead): SourceFlowCategory {
  const st = String(c.source_type ?? '').toUpperCase()
  const ct = String(c.connector_type ?? '').toLowerCase()
  if (st === 'DATABASE_QUERY' || ct === 'relational_database') return 'Database'
  if (
    st === 'S3' ||
    st === 'S3_OBJECT_POLLING' ||
    st === 'REMOTE_FILE' ||
    st === 'REMOTE_FILE_POLLING' ||
    ct === 's3_compatible' ||
    ct === 'remote_file'
  ) {
    return 'Files'
  }
  if (
    st === 'HTTP_API_POLLING' ||
    st === 'WEBHOOK' ||
    st === 'WEBHOOK_RECEIVER' ||
    ct === 'generic_http' ||
    ct === 'webhook_receiver'
  ) {
    return 'API'
  }
  return 'Streaming'
}

type DestinationFlowCategory = 'Database' | 'Data Lake' | 'API' | 'Warehouse' | 'Streaming'

function destinationFlowCategory(d: DestinationListItem): DestinationFlowCategory {
  switch (d.destination_type) {
    case 'WEBHOOK_POST':
      return 'API'
    case 'SYSLOG_UDP':
    case 'SYSLOG_TCP':
    case 'SYSLOG_TLS':
      return 'Streaming'
    default:
      return 'API'
  }
}

function countByCategory<T extends string>(items: readonly { category: T }[], order: readonly T[]): FlowCategoryCount[] {
  const tallies = new Map<T, number>()
  for (const item of items) tallies.set(item.category, (tallies.get(item.category) ?? 0) + 1)
  return order.map((label) => ({ label, count: tallies.get(label) ?? 0 })).filter((row) => row.count > 0)
}

export function deriveFlowBreakdown(
  observability: ObservabilitySummaryResponse | null,
  dashboard: DashboardSummaryResponse | null,
  streams: readonly StreamRead[],
  connectors: readonly ConnectorRead[],
  destinations: readonly DestinationListItem[],
): FlowBreakdown {
  const totals = observability?.totals
  const summary = dashboard?.summary
  const sourceItems = connectors.map((c) => ({ category: connectorFlowCategory(c) }))
  const destItems = destinations.map((d) => ({ category: destinationFlowCategory(d) }))
  return {
    sources: countByCategory(sourceItems, ['Database', 'API', 'Files', 'Streaming'] as const),
    streams: totals?.streams_total ?? summary?.total_streams ?? streams.length,
    destinations: countByCategory(destItems, ['Database', 'Data Lake', 'API', 'Warehouse', 'Streaming'] as const),
  }
}

/** Flow breakdown: connector/destination catalogs for type labels; stream count from operational snapshot. */
export function deriveFlowBreakdownFromSnapshot(
  snapshot: OperationalSnapshotResponse | null,
  connectors: readonly ConnectorRead[],
  destinations: readonly DestinationListItem[],
): FlowBreakdown {
  const sourceItems = connectors.map((c) => ({ category: connectorFlowCategory(c) }))
  const destItems = destinations.map((d) => ({ category: destinationFlowCategory(d) }))
  const streams = snapshot != null ? selectGlobalKpi(snapshot).totalStreams : 0
  return {
    sources: countByCategory(sourceItems, ['Database', 'API', 'Files', 'Streaming'] as const),
    streams,
    destinations: countByCategory(destItems, ['Database', 'Data Lake', 'API', 'Warehouse', 'Streaming'] as const),
  }
}

export function deriveStreamsOperationalStatus(
  dashboard: DashboardSummaryResponse | null,
  streams: readonly StreamRead[],
): StreamsOperationalStatus {
  const summary = dashboard?.summary
  if (summary) {
    return {
      running: safeNonNeg(summary.running_streams),
      warning:
        safeNonNeg(summary.error_streams) +
        safeNonNeg(summary.rate_limited_source_streams) +
        safeNonNeg(summary.rate_limited_destination_streams),
      stopped: safeNonNeg(summary.stopped_streams) + safeNonNeg(summary.paused_streams),
    }
  }
  let running = 0
  let warning = 0
  let stopped = 0
  for (const s of streams) {
    const st = mapBackendStreamStatus(s.status)
    if (st === 'RUNNING') running += 1
    else if (st === 'DEGRADED' || st === 'ERROR') warning += 1
    else if (st === 'STOPPED') stopped += 1
  }
  return { running, warning, stopped }
}

export function deriveStreamsOperationalStatusFromSnapshot(
  snapshot: OperationalSnapshotResponse | null,
): StreamsOperationalStatus {
  if (snapshot == null) return { running: 0, warning: 0, stopped: 0 }
  const g = selectGlobalKpi(snapshot)
  const streams = snapshot.streams ?? []
  const running = g.runningStreams > 0 ? g.runningStreams : streams.filter((s) => s.enabled && s.health_status === 'HEALTHY').length
  const warning =
    g.errorStreams > 0
      ? g.errorStreams + streams.filter((s) => s.enabled && s.health_status === 'DEGRADED').length
      : streams.filter((s) => s.enabled && (s.health_status === 'DEGRADED' || s.health_status === 'ERROR')).length
  const stopped = streams.filter((s) => !s.enabled || s.health_status === 'IDLE').length
  return { running, warning, stopped }
}

export function deriveTopSourcesByIngestRate(
  connectors: readonly ConnectorRead[],
  operationalSnapshot: OperationalSnapshotResponse | null,
  observability: ObservabilitySummaryResponse | null,
  limit = 5,
): TopSourceIngestItem[] {
  const connectorNameById = new Map<number, string>()
  for (const c of connectors) {
    connectorNameById.set(c.id, c.name?.trim() || `Connector #${c.id}`)
  }

  if (operationalSnapshot?.streams?.length) {
    const epsByConnector = new Map<number, number>()
    for (const stream of operationalSnapshot.streams) {
      const connectorId = stream.connector_id
      if (connectorId == null) continue
      epsByConnector.set(connectorId, (epsByConnector.get(connectorId) ?? 0) + safeNonNeg(stream.eps_1m))
    }
    const ranked = [...epsByConnector.entries()]
      .map(([connectorId, rateEps]) => ({
        name: connectorNameById.get(connectorId) ?? `Connector #${connectorId}`,
        rateEps,
      }))
      .filter((item) => item.rateEps > 0)
      .sort((a, b) => b.rateEps - a.rateEps)
      .slice(0, limit)
    if (ranked.length > 0) return ranked
  }

  const totalEps = observability?.totals?.throughput_eps ?? 0
  if (totalEps > 0 && connectors.length === 1) {
    return [{ name: connectorNameById.get(connectors[0].id) ?? `Connector #${connectors[0].id}`, rateEps: totalEps }]
  }

  return []
}

function connectorsStatusFromGroups(groupHealth: StreamGroupHealthCounts | null): SystemHealthItem['status'] {
  if (!groupHealth) return 'warning'
  if (groupHealth.critical > 0) return 'critical'
  if (groupHealth.warning > 0) return 'warning'
  return 'healthy'
}

function workersStatusFromDashboard(dashboard: DashboardSummaryResponse | null): SystemHealthItem['status'] {
  if (dashboard?.runtime_engine_status === 'STOPPED') return 'critical'
  if (dashboard?.runtime_engine_status === 'DEGRADED') return 'warning'
  const workers = dashboard?.active_worker_count
  if (workers != null && workers > 0) return 'healthy'
  if (dashboard?.runtime_engine_status === 'RUNNING') return 'healthy'
  return 'warning'
}

export function deriveSystemHealth(
  health: HealthOverviewResponse | null,
  dashboard: DashboardSummaryResponse | null,
  groupHealth: StreamGroupHealthCounts | null = null,
): SystemHealthItem[] {
  const posture = (counts: { healthy?: number; degraded?: number; unhealthy?: number; critical?: number } | undefined): SystemHealthItem['status'] => {
    if (!counts) return 'warning'
    if (safeNonNeg(counts.critical) + safeNonNeg(counts.unhealthy) > 0) return 'critical'
    if (safeNonNeg(counts.degraded) > 0) return 'warning'
    return 'healthy'
  }
  return [
    { id: 'connectors', label: 'Connectors', status: connectorsStatusFromGroups(groupHealth) },
    { id: 'streams', label: 'Streams', status: posture(health?.streams) },
    { id: 'destinations', label: 'Destinations', status: posture(health?.destinations) },
    { id: 'routes', label: 'Routes', status: posture(health?.routes) },
    { id: 'workers', label: 'Workers', status: workersStatusFromDashboard(dashboard) },
  ]
}

export function deriveSystemHealthFromSnapshot(
  snapshot: OperationalSnapshotResponse | null,
  dashboard: DashboardSummaryResponse | null,
  groupHealth: StreamGroupHealthCounts | null = null,
): SystemHealthItem[] {
  const postureFromCounts = (counts: ReturnType<typeof countHealthFromRows>): SystemHealthItem['status'] => {
    if (counts.critical > 0) return 'critical'
    if (counts.warning > 0) return 'warning'
    return 'healthy'
  }
  const streamCounts = countHealthFromRows(snapshot?.streams ?? [])
  const routeCounts = countHealthFromRows(snapshot?.routes ?? [])
  const destCounts = countHealthFromRows(snapshot?.destinations ?? [])
  return [
    { id: 'connectors', label: 'Connectors', status: connectorsStatusFromGroups(groupHealth) },
    { id: 'streams', label: 'Streams', status: postureFromCounts(streamCounts) },
    { id: 'destinations', label: 'Destinations', status: postureFromCounts(destCounts) },
    { id: 'routes', label: 'Routes', status: postureFromCounts(routeCounts) },
    { id: 'workers', label: 'Workers', status: workersStatusFromDashboard(dashboard) },
  ]
}

export function operationalStatusDonutSlices(
  status: StreamsOperationalStatus,
): Array<{ name: string; value: number; color: string; pct: number }> {
  const total = status.running + status.warning + status.stopped
  if (total <= 0) {
    return [{ name: 'No streams', value: 1, color: '#64748b', pct: 100 }]
  }
  const mk = (name: string, value: number, color: string) => ({
    name,
    value,
    color,
    pct: (100 * value) / total,
  })
  return [
    mk('Running', status.running, '#22c55e'),
    mk('Warning', status.warning, '#f59e0b'),
    mk('Stopped', status.stopped, '#64748b'),
  ].filter((s) => s.value > 0)
}

function formatDeltaPct(current: number, previous: number): string {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) {
    if (current > 0 && previous === 0) return '↗ 100%'
    return '—'
  }
  const pct = ((current - previous) / previous) * 100
  const arrow = pct > 0 ? '↗ ' : pct < 0 ? '↘ ' : ''
  const sign = pct >= 0 ? '+' : ''
  return `${arrow}${sign}${pct.toFixed(1)}%`
}

function sparklineDelta(values: number[]): { current: number; previous: number } {
  if (values.length < 2) {
    const v = values[0] ?? 0
    return { current: v, previous: v }
  }
  return { current: values[values.length - 1] ?? 0, previous: values[0] ?? 0 }
}

export function deriveTrafficChartSeries(
  outcomeTs: DashboardOutcomeTimeseriesResponse | null,
): TrafficChartPoint[] {
  if (!outcomeTs?.buckets?.length) return []
  return outcomeTs.buckets.map((b) => {
    const ts = String(b.bucket_start ?? '')
    const label = ts.length >= 16 ? ts.slice(11, 16) : ts
    const delivered = safeNonNeg(b.success)
    const failed = safeNonNeg(b.failed)
    const ingested = delivered + failed + safeNonNeg(b.rate_limited)
    return { label, ingested, delivered, failed }
  })
}

export function sparklineFromBuckets(outcomeTs: DashboardOutcomeTimeseriesResponse | null): number[] {
  const series = deriveTrafficChartSeries(outcomeTs)
  if (!series.length) return []
  return series.map((p) => p.ingested)
}

export function deriveDashboardKpis(input: {
  observability: ObservabilitySummaryResponse | null
  dashboard: DashboardSummaryResponse | null
  traffic: TrafficOverviewMetrics
  alertsSummary: RecentAlertsSummary
  outcomeTs: DashboardOutcomeTimeseriesResponse | null
  windowLabel: string
}): DashboardKpiItem[] {
  const { observability, dashboard, traffic, alertsSummary, outcomeTs, windowLabel } = input
  const totals = observability?.totals
  const summary = dashboard?.summary
  const winSec = windowSeconds(windowLabel)

  const running = totals?.streams_running ?? summary?.running_streams ?? 0
  const streamsTotal = totals?.streams_total ?? summary?.total_streams ?? running

  const ingestEps =
    totals?.throughput_eps != null && totals.throughput_eps >= 0
      ? totals.throughput_eps
      : traffic.incomingEvents != null && winSec > 0
        ? traffic.incomingEvents / winSec
        : 0

  const deliveryEps =
    totals?.delivery_success_events != null && winSec > 0
      ? totals.delivery_success_events / winSec
      : traffic.outgoingEvents != null && winSec > 0
        ? traffic.outgoingEvents / winSec
        : 0

  const alertSub =
    alertsSummary.critical > 0 || alertsSummary.warning > 0
      ? `${alertsSummary.critical} Critical, ${alertsSummary.warning} Warning`
      : 'No alerts in window'

  const ingestSpark = sparklineFromBuckets(outcomeTs)
  const deliverySpark = deriveTrafficChartSeries(outcomeTs).map((p) => p.delivered)
  const successSpark = deriveTrafficChartSeries(outcomeTs).map((p) =>
    p.delivered + p.failed > 0 ? (100 * p.delivered) / (p.delivered + p.failed) : 0,
  )
  const ingestDelta = sparklineDelta(ingestSpark.length ? ingestSpark : [ingestEps])
  const deliveryDelta = sparklineDelta(deliverySpark.length ? deliverySpark : [deliveryEps])
  const successDelta = sparklineDelta(successSpark.length ? successSpark : [traffic.deliverySuccessRatePct ?? 0])
  const windowCompare = `vs last ${windowLabel}`

  return [
    {
      id: 'active-streams',
      label: 'Active Streams',
      value: String(running),
      sub: `${running} running · ${streamsTotal} total`,
      tone: 'blue',
      sparkline: [],
    },
    {
      id: 'ingest-rate',
      label: 'Ingest Rate',
      value: `${formatThroughputEps(ingestEps)} events/sec`,
      sub: `${formatDeltaPct(ingestDelta.current, ingestDelta.previous)} ${windowCompare}`,
      tone: 'green',
      sparkline: ingestSpark,
    },
    {
      id: 'delivery-rate',
      label: 'Delivery Rate',
      value: `${formatThroughputEps(deliveryEps)} events/sec`,
      sub: `${formatDeltaPct(deliveryDelta.current, deliveryDelta.previous)} ${windowCompare}`,
      tone: 'violet',
      sparkline: deliverySpark,
    },
    {
      id: 'success-rate',
      label: 'Success Rate',
      value: formatSuccessRate(traffic.deliverySuccessRatePct),
      sub: `${formatDeltaPct(successDelta.current, successDelta.previous)} ${windowCompare}`,
      tone: 'teal',
      sparkline: successSpark,
    },
    {
      id: 'active-alerts',
      label: 'Active Alerts',
      value: String(alertsSummary.total),
      sub: alertSub,
      tone: alertsSummary.critical > 0 ? 'red' : alertsSummary.warning > 0 ? 'amber' : 'neutral',
      sparkline: [alertsSummary.total],
    },
  ]
}

function chartTrendSub(
  delta: { current: number; previous: number },
  windowLabel: string | undefined,
): string {
  const trend = formatDeltaPct(delta.current, delta.previous)
  if (trend === '—' || !windowLabel) return ''
  return `${trend} chart trend (${windowLabel})`
}

export function deriveDashboardKpisFromSnapshot(input: {
  snapshot: OperationalSnapshotResponse | null
  alertsSummary: RecentAlertsSummary
  outcomeTs: DashboardOutcomeTimeseriesResponse | null
  /** Analytics window — affects chart sparklines only, not snapshot KPI values. */
  chartWindowLabel?: string
}): DashboardKpiItem[] {
  const { snapshot, alertsSummary, outcomeTs, chartWindowLabel } = input
  if (snapshot == null) return []
  const g = selectGlobalKpi(snapshot)
  const traffic = deriveTrafficOverviewFromSnapshot(snapshot)
  const running = g.runningStreams
  const streamsTotal = g.totalStreams
  const ingestEps = g.eps5m ?? g.eps1m ?? 0
  const deliveryEps =
    ingestEps > 0 && traffic.deliverySuccessRatePct != null ? (ingestEps * traffic.deliverySuccessRatePct) / 100 : 0

  const alertSub =
    alertsSummary.critical > 0 || alertsSummary.warning > 0
      ? `${alertsSummary.critical} Critical, ${alertsSummary.warning} Warning`
      : 'No alerts in window'

  const ingestSpark = sparklineFromBuckets(outcomeTs)
  const deliverySpark = deriveTrafficChartSeries(outcomeTs).map((p) => p.delivered)
  const successSpark = deriveTrafficChartSeries(outcomeTs).map((p) =>
    p.delivered + p.failed > 0 ? (100 * p.delivered) / (p.delivered + p.failed) : 0,
  )
  const ingestTrend = chartTrendSub(sparklineDelta(ingestSpark), chartWindowLabel)
  const deliveryTrend = chartTrendSub(sparklineDelta(deliverySpark), chartWindowLabel)
  const successTrend = chartTrendSub(sparklineDelta(successSpark), chartWindowLabel)

  return [
    {
      id: 'active-streams',
      label: 'Active Streams',
      value: String(running),
      sub: `${running} running · ${streamsTotal} total`,
      basisLabel: 'Live snapshot',
      tone: 'blue',
      sparkline: [],
    },
    {
      id: 'ingest-rate',
      label: 'Ingest Rate',
      value: formatOperationalEps(ingestEps, 'events/sec'),
      sub: ingestTrend,
      basisLabel: SNAPSHOT_KPI_BASIS_LABEL,
      tone: 'green',
      sparkline: ingestSpark,
    },
    {
      id: 'delivery-rate',
      label: 'Delivery Rate',
      value: formatOperationalEps(deliveryEps, 'events/sec'),
      sub: deliveryTrend,
      basisLabel: SNAPSHOT_KPI_BASIS_LABEL,
      tone: 'violet',
      sparkline: deliverySpark,
    },
    {
      id: 'success-rate',
      label: 'Success Rate',
      value: formatOperationalSuccessRate(traffic.deliverySuccessRatePct),
      sub: successTrend,
      basisLabel: SNAPSHOT_KPI_BASIS_LABEL,
      tone: 'teal',
      sparkline: successSpark,
    },
    {
      id: 'active-alerts',
      label: 'Active Alerts',
      value: String(alertsSummary.total),
      sub: alertSub,
      tone: alertsSummary.critical > 0 ? 'red' : alertsSummary.warning > 0 ? 'amber' : 'neutral',
      sparkline: [alertsSummary.total],
    },
  ]
}

export function donutSlicesFromCounts(
  healthy: number,
  warning: number,
  critical: number,
): Array<{ name: string; value: number; color: string; pct: number }> {
  const total = healthy + warning + critical
  if (total <= 0) {
    return [{ name: 'No groups', value: 1, color: '#64748b', pct: 100 }]
  }
  const mk = (name: string, value: number, color: string) => ({
    name,
    value,
    color,
    pct: (100 * value) / total,
  })
  return [
    mk('Healthy', healthy, '#22c55e'),
    mk('Warning', warning, '#f59e0b'),
    mk('Critical', critical, '#ef4444'),
  ].filter((s) => s.value > 0)
}

export function streamStatusDonutSlicesFromSnapshot(
  snapshot: OperationalSnapshotResponse | null,
): Array<{ name: string; value: number; color: string; pct: number }> {
  if (snapshot == null) return donutSlicesFromCounts(0, 0, 0)
  const counts = countHealthFromRows(snapshot.streams ?? [])
  return donutSlicesFromCounts(counts.healthy, counts.warning, counts.critical)
}

export function streamStatusDonutSlices(health: HealthOverviewResponse | null): Array<{ name: string; value: number; color: string; pct: number }> {
  const s = health?.streams
  return donutSlicesFromCounts(safeNonNeg(s?.healthy), safeNonNeg(s?.degraded), safeNonNeg(s?.unhealthy) + safeNonNeg(s?.critical))
}
