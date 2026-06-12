import type { GovernanceOperationsSummaryResponse } from '../api/gdcGovernanceOperations'
import type {
  DashboardSummaryResponse,
  HealthOverviewResponse,
  RecentProblemRouteItem,
  StreamHealthRow,
} from '../api/types/gdcApi'
import { sanitizeOperatorDisplayText } from './operator-vocabulary'
import { resolveSourceProductLabel } from './source-product-group'

export type OpsIncidentSeverity = 'critical' | 'high' | 'medium'

export type OpsIncident = {
  id: string
  kind: 'stream' | 'route' | 'governance'
  severity: OpsIncidentSeverity
  label: string
  streamId?: number
  streamName?: string
  productLabel?: string
  whySummary: string
}

function healthLevelToSeverity(level: string | undefined): OpsIncidentSeverity {
  const u = String(level ?? '').toUpperCase()
  if (u === 'CRITICAL' || u === 'UNHEALTHY') return 'critical'
  if (u === 'DEGRADED') return 'high'
  return 'medium'
}

function streamWhySummary(row: StreamHealthRow): string {
  const factor = row.factors?.[0]
  if (factor?.detail) return sanitizeOperatorDisplayText(factor.detail)
  if (factor?.label) return sanitizeOperatorDisplayText(factor.label)
  return `Health score ${row.score} — review delivery activity for this stream.`
}

function routeWhySummary(row: RecentProblemRouteItem, streamNameById: Map<number, string>): string {
  const stream = row.stream_id != null ? streamNameById.get(row.stream_id) : undefined
  const base =
    row.message?.trim() ||
    (row.error_code ? `Error ${row.error_code}` : '') ||
    'Recent delivery failure on this delivery path.'
  const sanitized = sanitizeOperatorDisplayText(base)
  return stream ? `${sanitized} (stream: ${stream})` : sanitized
}

function governanceIncidents(summary: GovernanceOperationsSummaryResponse): OpsIncident[] {
  const out: OpsIncident[] = []
  const pending = summary.pending_approvals ?? 0
  const violations = summary.open_violations ?? 0
  const quarantine = summary.quarantined_events ?? 0
  const replays = summary.failed_replays ?? 0
  if (pending > 0) {
    out.push({
      id: 'gov-approvals',
      kind: 'governance',
      severity: 'high',
      label: `${pending} pending approval${pending === 1 ? '' : 's'}`,
      whySummary: 'Policy changes are waiting for operator review before they can take effect.',
    })
  }
  if (violations > 0) {
    out.push({
      id: 'gov-violations',
      kind: 'governance',
      severity: 'critical',
      label: `${violations} open violation${violations === 1 ? '' : 's'}`,
      whySummary: 'Policy or protection rules flagged events that need triage.',
    })
  }
  if (quarantine > 0) {
    out.push({
      id: 'gov-quarantine',
      kind: 'governance',
      severity: 'high',
      label: `${quarantine} quarantined event${quarantine === 1 ? '' : 's'}`,
      whySummary: 'Sensitive or policy-blocked events are held until you release or discard them.',
    })
  }
  if (replays > 0) {
    out.push({
      id: 'gov-replays',
      kind: 'governance',
      severity: 'medium',
      label: `${replays} failed replay${replays === 1 ? '' : 's'}`,
      whySummary: 'Replay jobs did not complete — inspect and retry from Governance.',
    })
  }
  return out
}

export function deriveOperationsIncidents(input: {
  health: HealthOverviewResponse | null
  dashboard: DashboardSummaryResponse | null
  governanceSummary?: GovernanceOperationsSummaryResponse | null
  streamNameById?: Map<number, string>
  connectorNameByStreamId?: Map<number, string>
}): OpsIncident[] {
  const { health, dashboard, governanceSummary, streamNameById = new Map(), connectorNameByStreamId = new Map() } =
    input
  const out: OpsIncident[] = []

  for (const row of health?.worst_streams ?? []) {
    const name = row.stream_name ?? streamNameById.get(row.stream_id) ?? `Stream #${row.stream_id}`
    const connector = connectorNameByStreamId.get(row.stream_id)
    out.push({
      id: `stream-${row.stream_id}`,
      kind: 'stream',
      severity: healthLevelToSeverity(row.level),
      label: name,
      streamId: row.stream_id,
      streamName: name,
      productLabel: resolveSourceProductLabel(connector),
      whySummary: streamWhySummary(row),
    })
  }

  for (const row of dashboard?.recent_problem_routes ?? []) {
    if (row.stream_id == null && !row.message) continue
    const streamName = row.stream_id != null ? streamNameById.get(row.stream_id) : undefined
    out.push({
      id: `route-${row.route_id ?? row.stream_id ?? out.length}`,
      kind: 'route',
      severity: 'high',
      label: streamName ?? `Delivery path #${row.route_id ?? '—'}`,
      streamId: row.stream_id ?? undefined,
      streamName,
      whySummary: routeWhySummary(row, streamNameById),
    })
  }

  if (governanceSummary) out.push(...governanceIncidents(governanceSummary))

  const severityRank: Record<OpsIncidentSeverity, number> = { critical: 3, high: 2, medium: 1 }
  out.sort((a, b) => severityRank[b.severity] - severityRank[a.severity])
  return out.slice(0, 8)
}

export type PlatformPosture = 'healthy' | 'degraded' | 'critical'

export function derivePlatformPosture(incidents: readonly OpsIncident[]): PlatformPosture {
  if (incidents.some((i) => i.severity === 'critical')) return 'critical'
  if (incidents.length > 0) return 'degraded'
  return 'healthy'
}

export function incidentHeadline(incidents: readonly OpsIncident[], windowLabel: string): string {
  if (incidents.length === 0) return `All streams healthy in the last ${windowLabel}.`
  const streamIssues = incidents.filter((i) => i.kind === 'stream').length
  const routeIssues = incidents.filter((i) => i.kind === 'route').length
  const govIssues = incidents.filter((i) => i.kind === 'governance').length
  const parts: string[] = []
  if (streamIssues > 0) parts.push(`${streamIssues} stream${streamIssues === 1 ? '' : 's'} need attention`)
  if (routeIssues > 0) parts.push(`${routeIssues} delivery failure${routeIssues === 1 ? '' : 's'} in ${windowLabel}`)
  if (govIssues > 0) parts.push(`${govIssues} governance action${govIssues === 1 ? '' : 's'} pending`)
  return parts.join(' · ')
}
