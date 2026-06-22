import { fetchStreamSchemaFieldDriftsSummary, type StreamSchemaFieldDriftsSummaryResponse } from '../api/gdcSchemaDrift'
import { fetchStreamSensitiveFindingsSummary, type StreamSensitiveFindingsSummaryResponse } from '../api/gdcSensitiveFindings'
import { fetchStreamProtectionSummary, type StreamProtectionSummaryResponse } from '../api/gdcProtection'
import { fetchStreamPolicySummary, type StreamPolicySummaryResponse } from '../api/gdcPolicy'
import { fetchStreamDynamicRoutingSummary, type StreamDynamicRoutingSummaryResponse } from '../api/gdcDynamicRouting'
import { fetchStreamFailoverRoutingSummary, type StreamFailoverRoutingSummaryResponse } from '../api/gdcFailoverRouting'
import { fetchStreamReplaySummary, type StreamReplaySummaryResponse } from '../api/gdcReplay'
import { fetchStreamQuarantineSummary, type StreamQuarantineSummaryResponse } from '../api/gdcQuarantine'
import type { GdcSignalOptions } from '../api/gdcSignalOptions'
import type { StreamRuntimeStatus } from '../api/streamRows'
import type { StreamIssueContext } from './stream-issue-context'
import { effectiveStreamSeverity, normalizeSeverityInput, type PartialStreamSeverityInput } from './stream-operational-status'

export type StreamGovernanceSnapshot = {
  schemaDrift: StreamSchemaFieldDriftsSummaryResponse | null
  sensitive: StreamSensitiveFindingsSummaryResponse | null
  protection: StreamProtectionSummaryResponse | null
  policy: StreamPolicySummaryResponse | null
  dynamicRouting: StreamDynamicRoutingSummaryResponse | null
  failover: StreamFailoverRoutingSummaryResponse | null
  replay: StreamReplaySummaryResponse | null
  quarantine: StreamQuarantineSummaryResponse | null
}

export type OperationalIssueTone = 'info' | 'warning' | 'critical'

export type OperationalIssue = {
  key: string
  label: string
  tone: OperationalIssueTone
  detail?: string
}

export type IssueWhyStep = {
  label: string
  detail?: string
}

/** Parallel fetch of M5–M12 summary endpoints (existing APIs only). */
export async function fetchStreamGovernanceSnapshot(
  streamId: number,
  options?: GdcSignalOptions,
): Promise<StreamGovernanceSnapshot> {
  const [
    schemaDrift,
    sensitive,
    protection,
    policy,
    dynamicRouting,
    failover,
    replay,
    quarantine,
  ] = await Promise.all([
    fetchStreamSchemaFieldDriftsSummary(streamId, options),
    fetchStreamSensitiveFindingsSummary(streamId, options),
    fetchStreamProtectionSummary(streamId, options),
    fetchStreamPolicySummary(streamId, options),
    fetchStreamDynamicRoutingSummary(streamId, options),
    fetchStreamFailoverRoutingSummary(streamId, options),
    fetchStreamReplaySummary(streamId, options),
    fetchStreamQuarantineSummary(streamId, options),
  ])
  return { schemaDrift, sensitive, protection, policy, dynamicRouting, failover, replay, quarantine }
}

export function deriveDeliveryIssues(ctx: Pick<StreamIssueContext, 'status' | 'routesError' | 'deliveryPctKnown' | 'deliveryPct' | 'recentErrors'>): OperationalIssue[] {
  const out: OperationalIssue[] = []
  if (ctx.status === 'ERROR' || ctx.routesError > 0) {
    out.push({
      key: 'destination',
      label: 'Destination failure',
      tone: 'critical',
      detail: ctx.recentErrors[0]?.message ?? `${ctx.routesError} delivery path${ctx.routesError === 1 ? '' : 's'} reporting errors`,
    })
  } else if (ctx.status === 'DEGRADED') {
    out.push({
      key: 'destination-degraded',
      label: 'Destination warning',
      tone: 'warning',
      detail: 'Delivery success rate or latency is below the healthy threshold.',
    })
  } else if (ctx.deliveryPctKnown && ctx.deliveryPct < 90) {
    out.push({
      key: 'low-success',
      label: 'Low delivery success',
      tone: 'warning',
      detail: `Success rate ${ctx.deliveryPct.toFixed(1)}% is below 90%.`,
    })
  }
  return out
}

export function deriveGovernanceIssues(gov: StreamGovernanceSnapshot | null | undefined): OperationalIssue[] {
  if (!gov) return []
  const out: OperationalIssue[] = []

  const driftOpen = gov.schemaDrift?.open_count ?? 0
  if (driftOpen > 0) {
    const cats = gov.schemaDrift?.by_category
    const parts: string[] = []
    if (cats?.field_added) parts.push(`${cats.field_added} field added`)
    if (cats?.field_removed) parts.push(`${cats.field_removed} field removed`)
    if (cats?.field_type_changed) parts.push(`${cats.field_type_changed} type changed`)
    out.push({
      key: 'schema-drift',
      label: 'Schema drift detected',
      tone: 'warning',
      detail: parts.length ? parts.join(', ') : `${driftOpen} open drift finding${driftOpen === 1 ? '' : 's'}`,
    })
  }

  const sensitiveOpen = gov.sensitive?.open_count ?? 0
  if (sensitiveOpen > 0) {
    out.push({
      key: 'sensitive',
      label: 'Sensitive data detected',
      tone: 'warning',
      detail: `${sensitiveOpen} open sensitive finding${sensitiveOpen === 1 ? '' : 's'}`,
    })
  }

  const quarantined = gov.quarantine?.quarantined_count ?? 0
  if (quarantined > 0) {
    out.push({
      key: 'quarantine',
      label: 'Events quarantined',
      tone: 'critical',
      detail: `${quarantined} event${quarantined === 1 ? '' : 's'} in quarantine`,
    })
  }

  const replayFailed = gov.replay?.failed_count ?? 0
  if (replayFailed > 0) {
    out.push({
      key: 'replay-failed',
      label: 'Replay failure',
      tone: 'warning',
      detail: `${replayFailed} replay event${replayFailed === 1 ? '' : 's'} failed`,
    })
  }

  const failoverFailures = gov.failover?.failover_failures ?? 0
  const failoverAttempts = gov.failover?.failover_attempts ?? 0
  if (failoverAttempts > 0) {
    out.push({
      key: 'failover',
      label: failoverFailures > 0 ? 'Failover partial failure' : 'Failover activated',
      tone: failoverFailures > 0 ? 'warning' : 'info',
      detail:
        failoverFailures > 0
          ? `${failoverFailures} of ${failoverAttempts} failover attempt${failoverAttempts === 1 ? '' : 's'} failed`
          : `${failoverAttempts} failover attempt${failoverAttempts === 1 ? '' : 's'} recorded`,
    })
  }

  return out
}

export function deriveOperationalIssues(
  ctx: StreamIssueContext,
  gov?: StreamGovernanceSnapshot | null,
): OperationalIssue[] {
  const delivery = deriveDeliveryIssues(ctx)
  const governance = deriveGovernanceIssues(gov)
  const seen = new Set<string>()
  return [...delivery, ...governance].filter((issue) => {
    if (seen.has(issue.key)) return false
    seen.add(issue.key)
    return true
  })
}

export function deriveStreamIssueSummaries(
  ctx: StreamIssueContext,
  gov?: StreamGovernanceSnapshot | null,
): string[] {
  return deriveOperationalIssues(ctx, gov).map((i) => i.label)
}

export function deriveConsoleRowIssueSummaries(row: {
  status: StreamRuntimeStatus
  routesError: number
  routesDegraded?: number
  deliveryPctKnown: boolean
  deliveryPct: number
  recentErrors?: ReadonlyArray<{ message: string }>
}): string[] {
  const ctx: StreamIssueContext = {
    id: '',
    status: row.status,
    connectorName: '',
    deliveryPctKnown: row.deliveryPctKnown,
    deliveryPct: row.deliveryPct,
    routesError: row.routesError,
    lastActivityRelative: '',
    recentErrors: row.recentErrors ?? [],
  }
  return deriveStreamIssueSummaries(ctx)
}

export function buildIssueWhyChain(
  issues: readonly OperationalIssue[],
  ctx: StreamIssueContext,
  gov?: StreamGovernanceSnapshot | null,
): IssueWhyStep[] {
  if (!issues.length) {
    return [{ label: 'All systems operating normally', detail: 'No delivery, schema, or governance issues detected.' }]
  }

  const chain: IssueWhyStep[] = []
  const primary = issues[0]

  chain.push({ label: primary.label, detail: primary.detail })

  if (primary.key === 'destination' || primary.key === 'destination-degraded') {
    if (ctx.recentErrors[0]?.message) {
      chain.push({ label: 'Delivery path error', detail: ctx.recentErrors[0].message })
    }
    if (ctx.routesError > 0) {
      chain.push({
        label: `${ctx.routesError} failed delivery path${ctx.routesError === 1 ? '' : 's'}`,
        detail: ctx.deliveryPctKnown ? `Success rate ${ctx.deliveryPct.toFixed(1)}%` : undefined,
      })
    }
    const failoverAttempts = gov?.failover?.failover_attempts ?? 0
    if (failoverAttempts > 0) {
      chain.push({
        label: 'Failover activated',
        detail: `${gov?.failover?.failover_successes ?? 0} successful of ${failoverAttempts} attempts`,
      })
    }
  }

  if (primary.key === 'schema-drift' && gov?.schemaDrift) {
    const cats = gov.schemaDrift.by_category
    if (cats.field_added) chain.push({ label: 'Field added', detail: `${cats.field_added} new field${cats.field_added === 1 ? '' : 's'}` })
    if (cats.field_type_changed) {
      chain.push({ label: 'Field type changed', detail: `${cats.field_type_changed} field${cats.field_type_changed === 1 ? '' : 's'}` })
    }
    if (gov.sensitive?.confirm_runs_required) {
      chain.push({ label: 'Confirmation runs', detail: `${gov.sensitive.confirm_runs_required} consecutive runs required` })
    }
  }

  if (primary.key === 'sensitive' && gov?.sensitive) {
    chain.push({
      label: 'Open sensitive findings',
      detail: `${gov.sensitive.open_count} finding${gov.sensitive.open_count === 1 ? '' : 's'} pending review`,
    })
    if ((gov.protection?.total_protected_events ?? 0) > 0) {
      chain.push({
        label: 'Protection applied',
        detail: `${gov.protection?.total_protected_events} protected event${gov.protection?.total_protected_events === 1 ? '' : 's'}`,
      })
    }
  }

  if (issues.length > 1) {
    chain.push({
      label: `${issues.length - 1} additional issue${issues.length === 2 ? '' : 's'}`,
      detail: issues.slice(1, 4).map((i) => i.label).join(' · '),
    })
  }

  return chain
}

/** Map timeline stage/message to operator-facing event labels. */
export function toOperatorEventLabel(message: string, stage?: string | null): string {
  const m = message.toLowerCase()
  const st = String(stage ?? '').toLowerCase()

  if (m.includes('failover') || st.includes('failover')) return 'Failover activated'
  if (m.includes('schema') && (m.includes('drift') || st.includes('drift'))) return 'Schema drift detected'
  if (st.includes('protection') || m.includes('protection')) {
    if (m.includes('fail')) return 'Protection failure'
    return 'Protection applied'
  }
  if (st.includes('sensitive') || m.includes('sensitive')) return 'Sensitive data detected'
  if (m.includes('quarantine')) return 'Event quarantined'
  if (m.includes('replay')) return m.includes('fail') ? 'Replay failed' : 'Replay executed'
  if (m.includes('checkpoint') || st.includes('checkpoint')) return 'Checkpoint updated'
  if (m.includes('429') || m.includes('throttl')) return 'Destination throttled'
  if (m.includes('recovered') || (m.includes('success') && m.includes('deliver'))) return 'Destination recovered'
  if (m.includes('fail') && (m.includes('deliver') || m.includes('route') || m.includes('destination'))) {
    return 'Destination failure'
  }
  if (m.includes('routing') || st.includes('routing')) return 'Routing evaluated'
  if (m.includes('policy') || st.includes('policy')) return 'Policy evaluated'
  if (m.includes('run') && m.includes('start')) return 'Pipeline run started'
  if (m.includes('mapping')) return 'Mapping applied'
  if (m.includes('enrich')) return 'Enrichment applied'
  if (m.includes('extract')) return 'Events extracted'

  if (message.length > 100) return `${message.slice(0, 97)}…`
  return message
}

export function hasOperationalIssues(
  ctx: StreamIssueContext,
  gov?: StreamGovernanceSnapshot | null,
): boolean {
  return deriveOperationalIssues(ctx, gov).length > 0
}

export function protectionViolationsFromSnapshot(gov: StreamGovernanceSnapshot | null | undefined): boolean {
  return (gov?.quarantine?.quarantined_count ?? 0) > 0
}

export function governanceFlowHints(gov: StreamGovernanceSnapshot | null | undefined): {
  schemaDriftOpen: number
  sensitiveOpen: number
  protectionActive: boolean
  policyMatched: number
  routingActive: boolean
  failoverAttempts: number
} {
  return {
    schemaDriftOpen: gov?.schemaDrift?.open_count ?? 0,
    sensitiveOpen: gov?.sensitive?.open_count ?? 0,
    protectionActive: (gov?.protection?.protection_enabled ?? false) && (gov?.protection?.enabled_rule_count ?? 0) > 0,
    policyMatched: gov?.policy?.matched_policies ?? 0,
    routingActive: (gov?.dynamicRouting?.matched_dynamic_routes ?? 0) > 0,
    failoverAttempts: gov?.failover?.failover_attempts ?? 0,
  }
}

export function streamHasAttention(
  row: PartialStreamSeverityInput & { recentErrors?: ReadonlyArray<{ message: string }> },
): boolean {
  return effectiveStreamSeverity(normalizeSeverityInput(row)) !== 'healthy'
}
