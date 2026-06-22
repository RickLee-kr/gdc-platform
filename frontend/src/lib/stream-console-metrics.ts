import type { StreamConsoleRow, StreamRuntimeStatus } from '../api/streamRows'
import type { StreamsMetricsWindow } from '../constants/streamConsoleFilters'
import {
  aggregateGroupIssueCauses,
  sortIssueCausesByPriority,
  streamOperationalHealthLabel,
} from './stream-console-issue-causes'
import {
  effectiveStreamSeverity,
  normalizeSeverityInput,
  severityToRuntimeStatus,
  worstOperationalSeverity,
  type StreamOperationalSeverity,
} from './stream-operational-status'
import { formatThroughputEps } from './observability-format'

export type GroupHealthLabel = 'Healthy' | 'Warning' | 'Critical' | 'Stopped'

export function groupHealthLabel(status: StreamRuntimeStatus): GroupHealthLabel {
  switch (status) {
    case 'ERROR':
      return 'Critical'
    case 'DEGRADED':
      return 'Warning'
    case 'STOPPED':
      return 'Stopped'
    case 'RUNNING':
    case 'UNKNOWN':
    default:
      return 'Healthy'
  }
}

export function groupHealthLabelFromSeverity(severity: StreamOperationalSeverity): GroupHealthLabel {
  return streamOperationalHealthLabel(severity)
}

export function groupHealthToneFromSeverity(severity: StreamOperationalSeverity): 'success' | 'warning' | 'error' | 'neutral' {
  switch (severity) {
    case 'critical':
      return 'error'
    case 'warning':
      return 'warning'
    case 'stopped':
      return 'neutral'
    default:
      return 'success'
  }
}

export function groupHealthTone(status: StreamRuntimeStatus): 'success' | 'warning' | 'error' | 'neutral' {
  switch (status) {
    case 'ERROR':
      return 'error'
    case 'DEGRADED':
      return 'warning'
    case 'STOPPED':
      return 'neutral'
    case 'RUNNING':
    case 'UNKNOWN':
    default:
      return 'success'
  }
}

/** Approximate events/sec from a 1h event count. */
export function eventsPerSecFromHourly(events1h: number): number {
  if (!Number.isFinite(events1h) || events1h <= 0) return 0
  return events1h / 3600
}

export function formatEventsPerSecRate(events1h: number): string {
  const eps = eventsPerSecFromHourly(events1h)
  if (eps >= 1000) return `${(eps / 1000).toFixed(1)}K /s`
  if (eps >= 1) return `${formatThroughputEps(eps)} /s`
  if (eps > 0) return `${formatThroughputEps(eps)} /s`
  return '0 /s'
}

/** Group header summary — mockup uses "12.4K events/sec" instead of "/s". */
export function formatGroupEventsPerSecRate(events1h: number): string {
  const eps = eventsPerSecFromHourly(events1h)
  if (eps >= 1000) return `${(eps / 1000).toFixed(1)}K events/sec`
  if (eps >= 1) return `${formatThroughputEps(eps)} events/sec`
  if (eps > 0) return `${formatThroughputEps(eps)} events/sec`
  return '0 events/sec'
}

export function groupHealthAccentClass(status: StreamRuntimeStatus): string {
  switch (status) {
    case 'ERROR':
      return 'border-l-red-500'
    case 'DEGRADED':
      return 'border-l-amber-500'
    case 'STOPPED':
      return 'border-l-slate-500 dark:border-l-slate-600'
    case 'RUNNING':
    case 'UNKNOWN':
    default:
      return 'border-l-emerald-500'
  }
}

export function formatSuccessRate(pct: number, known: boolean): string {
  if (!known) return '—'
  return `${pct.toFixed(pct >= 100 ? 0 : 2)}%`
}

export type StreamRateRow = {
  events1h: number
  deliveryPct: number
  deliveryPctKnown: boolean
  hasRuntimeApiSnapshot: boolean
}

export function ingestRateLabel(row: StreamRateRow): string {
  if (!row.hasRuntimeApiSnapshot) return '—'
  return formatEventsPerSecRate(row.events1h)
}

export function deliveryRateLabel(row: StreamRateRow): string {
  if (!row.hasRuntimeApiSnapshot || !row.deliveryPctKnown) return '—'
  const delivered = (row.events1h * row.deliveryPct) / 100
  return formatEventsPerSecRate(delivered)
}

export type AggregateGroupRates = {
  ingestLabel: string
  deliveryLabel: string
  successLabel: string
  successPct: number | null
  totalEvents: number
  totalDelivered: number
  hasAny: boolean
  hasDelivery: boolean
}

export function aggregateGroupRates(rows: readonly StreamRateRow[]): AggregateGroupRates {
  let totalEvents = 0
  let totalDelivered = 0
  let hasAny = false
  let hasDelivery = false

  for (const row of rows) {
    if (!row.hasRuntimeApiSnapshot) continue
    hasAny = true
    totalEvents += row.events1h
    if (row.deliveryPctKnown) {
      hasDelivery = true
      totalDelivered += (row.events1h * row.deliveryPct) / 100
    }
  }

  const successPct = totalEvents > 0 && hasDelivery ? (100 * totalDelivered) / totalEvents : null

  return {
    ingestLabel: hasAny ? formatGroupEventsPerSecRate(totalEvents) : '—',
    deliveryLabel: hasDelivery ? formatGroupEventsPerSecRate(totalDelivered) : '—',
    successLabel: successPct != null ? `${successPct.toFixed(2)}%` : '—',
    successPct,
    totalEvents,
    totalDelivered,
    hasAny,
    hasDelivery,
  }
}

export function formatRelativeShort(iso: string | null | undefined): string {
  if (!iso) return '—'
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) {
    const trimmed = String(iso).trim()
    return trimmed && trimmed !== '—' ? trimmed : '—'
  }
  const diffMs = Date.now() - t
  if (diffMs < 0) return '—'
  const sec = Math.floor(diffMs / 1000)
  if (sec < 60) return `${sec}s ago`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m ago`
  const h = Math.floor(min / 60)
  if (h < 48) return `${h}h ago`
  const d = Math.floor(h / 24)
  return `${d}d ago`
}

export function aggregateGroupSparklines(rows: readonly StreamRateRow[]): {
  ingest: number[]
  delivery: number[]
  success: number[]
} {
  const ingest: number[] = []
  const delivery: number[] = []
  const success: number[] = []
  for (const row of rows) {
    if (!row.hasRuntimeApiSnapshot) continue
    const eps = eventsPerSecFromHourly(row.events1h)
    ingest.push(eps)
    if (row.deliveryPctKnown) {
      delivery.push((eps * row.deliveryPct) / 100)
      success.push(row.deliveryPct)
    }
  }
  const pad = (vals: number[]) => (vals.length ? vals : [0, 0, 0, 0, 0, 0, 0])
  return { ingest: pad(ingest), delivery: pad(delivery), success: pad(success) }
}

export type GroupOperationalStats = {
  operationalSeverity: StreamOperationalSeverity
  worstStatus: StreamRuntimeStatus
  criticalCount: number
  warningCount: number
  stoppedCount: number
  healthyCount: number
  issueCount: number
  totalEvents: number
}

/**
 * Group status = worst stream operational severity (inheritance, not count/average).
 * Critical > Warning > Stopped > Healthy.
 */
export function computeGroupOperationalStats(rows: readonly StreamConsoleRow[]): GroupOperationalStats {
  let criticalCount = 0
  let warningCount = 0
  let stoppedCount = 0
  let healthyCount = 0
  let totalEvents = 0
  const severities: StreamOperationalSeverity[] = []

  for (const row of rows) {
    const severity = effectiveStreamSeverity(normalizeSeverityInput(row))
    severities.push(severity)
    if (severity === 'critical') criticalCount += 1
    else if (severity === 'warning') warningCount += 1
    else if (severity === 'stopped') stoppedCount += 1
    else healthyCount += 1
    if (row.hasRuntimeApiSnapshot) totalEvents += row.events1h
  }

  const operationalSeverity = rows.length ? worstOperationalSeverity(severities) : 'healthy'

  return {
    operationalSeverity,
    worstStatus: severityToRuntimeStatus(operationalSeverity),
    criticalCount,
    warningCount,
    stoppedCount,
    healthyCount,
    issueCount: criticalCount + warningCount,
    totalEvents,
  }
}

export function formatCompactEventCount(totalEvents: number): string {
  if (totalEvents <= 0) return ''
  if (totalEvents >= 1_000_000) return `${(totalEvents / 1_000_000).toFixed(1)}M Events`
  if (totalEvents >= 1_000) return `${(totalEvents / 1_000).toFixed(1)}K Events`
  return `${totalEvents.toLocaleString()} Events`
}

export function formatGroupHeaderSummary(stats: GroupOperationalStats): string {
  const streamCount = stats.criticalCount + stats.warningCount + stats.stoppedCount + stats.healthyCount
  const parts: string[] = [`${streamCount} Stream${streamCount === 1 ? '' : 's'}`]
  if (stats.criticalCount > 0) parts.push(`${stats.criticalCount} Critical`)
  if (stats.warningCount > 0) parts.push(`${stats.warningCount} Warning`)
  if (stats.stoppedCount > 0) parts.push(`${stats.stoppedCount} Stopped`)
  const eventsLabel = formatCompactEventCount(stats.totalEvents)
  if (eventsLabel) parts.push(eventsLabel)
  return parts.join(' · ')
}

export type GroupIssueBreakdown = {
  total: number
  critical: number
  warning: number
  label: string
  causes: readonly string[]
  hiddenCount: number
}

export function aggregateGroupIssueBreakdown(
  rows: readonly Pick<StreamConsoleRow, 'status' | 'routesError' | 'routesDegraded' | 'deliveryPctKnown' | 'deliveryPct' | 'hasRuntimeApiSnapshot' | 'runtimeStatsAttempted' | 'events1h' | 'recentErrors' | 'checkpointLagLabel'>[],
  metricsWindow: StreamsMetricsWindow = '1h',
): GroupIssueBreakdown {
  const fullRows = rows as StreamConsoleRow[]
  const aggregated = aggregateGroupIssueCauses(fullRows, metricsWindow)
  const stats = computeGroupOperationalStats(fullRows)
  return {
    total: aggregated.streamCount,
    critical: stats.criticalCount,
    warning: stats.warningCount,
    label: aggregated.label,
    causes: sortIssueCausesByPriority(aggregated.causes),
    hiddenCount: aggregated.hiddenCount,
  }
}

export function groupLastEventLabel(
  rows: readonly Pick<StreamConsoleRow, 'lastActivityRelative' | 'hasRuntimeApiSnapshot'>[],
): string {
  let bestTs = -1
  let bestLabel = '—'
  for (const row of rows) {
    if (!row.hasRuntimeApiSnapshot) continue
    const raw = row.lastActivityRelative
    if (!raw || raw === '—') continue
    const t = Date.parse(raw.includes('T') ? raw : raw.replace(' ', 'T'))
    if (Number.isFinite(t) && t > bestTs) {
      bestTs = t
      bestLabel = formatRelativeShort(raw)
    }
  }
  return bestLabel
}

export type StreamsPageKpi = {
  totalGroups: number
  totalStreams: number
  healthyGroups: number
  warningGroups: number
  criticalGroups: number
  totalIssues: number
  healthyPct: string
  warningPct: string
  criticalPct: string
}

export function computeStreamsPageKpi(
  groups: readonly { operationalSeverity: StreamOperationalSeverity; issueCount: number }[],
  totalStreams: number,
): StreamsPageKpi {
  const totalGroups = groups.length
  let healthyGroups = 0
  let warningGroups = 0
  let criticalGroups = 0
  let totalIssues = 0
  for (const g of groups) {
    totalIssues += g.issueCount
    const label = groupHealthLabelFromSeverity(g.operationalSeverity)
    if (label === 'Healthy') healthyGroups += 1
    else if (label === 'Warning') warningGroups += 1
    else if (label === 'Critical') criticalGroups += 1
  }
  const pct = (n: number) => (totalGroups > 0 ? `${((100 * n) / totalGroups).toFixed(1)}%` : '—')
  return {
    totalGroups,
    totalStreams,
    healthyGroups,
    warningGroups,
    criticalGroups,
    totalIssues,
    healthyPct: pct(healthyGroups),
    warningPct: pct(warningGroups),
    criticalPct: pct(criticalGroups),
  }
}

export function successRateTone(pct: number | null): StreamOperationalSeverity {
  if (pct == null) return 'healthy'
  if (pct < 85) return 'critical'
  if (pct < 95) return 'warning'
  return 'healthy'
}
