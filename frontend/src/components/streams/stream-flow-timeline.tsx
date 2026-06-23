import { AlertTriangle, ArrowRight, Check, Circle, Minus } from 'lucide-react'
import { Link } from 'react-router-dom'
import { cn } from '../../lib/utils'
import { streamEditPath, streamMappingPath } from '../../config/nav-paths'
import type { StreamWorkflowSnapshot } from '../../utils/streamWorkflow'
import type { StreamRuntimeStatus } from '../../api/streamRows'
import {
  governanceFlowHints,
  type StreamGovernanceSnapshot,
} from '../../lib/stream-governance-snapshot'

export type FlowTimelineStageStatus = 'ok' | 'warn' | 'error' | 'skipped' | 'pending'

export type FlowTimelineStage = {
  key: string
  label: string
  shortLabel: string
  status: FlowTimelineStageStatus
  href?: string
  detail?: string
}

/** Neutral governance label when wizard defaults are unchanged and nothing needs attention. */
export const GOVERNANCE_NO_CHANGE_DETAIL = 'No Change'

function governanceNoChangeStage(): Pick<FlowTimelineStage, 'status' | 'detail'> {
  return { status: 'ok', detail: GOVERNANCE_NO_CHANGE_DETAIL }
}

function safeNonNeg(n: unknown): number {
  const x = typeof n === 'number' ? n : Number(n)
  if (!Number.isFinite(x) || x < 0) return 0
  return Math.floor(x)
}

function stageIcon(status: FlowTimelineStageStatus) {
  switch (status) {
    case 'ok':
      return <Check className="h-3 w-3" strokeWidth={3} aria-hidden />
    case 'warn':
      return <AlertTriangle className="h-3 w-3" aria-hidden />
    case 'error':
      return <span className="text-[10px] font-bold leading-none" aria-hidden>✕</span>
    case 'skipped':
      return <Minus className="h-3 w-3" aria-hidden />
    default:
      return <Circle className="h-2.5 w-2.5" aria-hidden />
  }
}

function stageBubbleClass(status: FlowTimelineStageStatus) {
  switch (status) {
    case 'ok':
      return 'border-emerald-500/50 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
    case 'warn':
      return 'border-amber-500/50 bg-amber-500/15 text-amber-700 dark:text-amber-300'
    case 'error':
      return 'border-red-500/50 bg-red-500/15 text-red-700 dark:text-red-300'
    case 'skipped':
      return 'border-slate-300 bg-slate-100 text-slate-400 dark:border-gdc-border dark:bg-gdc-elevated dark:text-gdc-muted'
    default:
      return 'border-slate-300 bg-white text-slate-500 dark:border-gdc-border dark:bg-gdc-card dark:text-gdc-muted'
  }
}

export function buildFlowTimelineStages(params: {
  streamId: string
  displayStatus: StreamRuntimeStatus
  workflow: StreamWorkflowSnapshot
  deliveryPct: number | null
  deliveredLastHour?: number | null
  failedLastHour?: number | null
  routesErr: number | null
  usesPushIngest: boolean
  governance?: StreamGovernanceSnapshot | null
}): FlowTimelineStage[] {
  const {
    streamId,
    displayStatus,
    workflow,
    deliveryPct,
    deliveredLastHour = 0,
    failedLastHour = 0,
    routesErr,
    usesPushIngest,
    governance,
  } = params
  const govHints = governanceFlowHints(governance)

  const mappingStep = workflow.steps.find((s) => s.key === 'mapping')
  const enrichmentStep = workflow.steps.find((s) => s.key === 'enrichment')
  const routeStep = workflow.steps.find((s) => s.key === 'route')

  const sourceStatus: FlowTimelineStageStatus =
    displayStatus === 'ERROR' ? 'error' : displayStatus === 'DEGRADED' ? 'warn' : displayStatus === 'STOPPED' ? 'pending' : 'ok'

  const mappingStatus: FlowTimelineStageStatus =
    mappingStep?.status === 'attention' ? 'warn' : mappingStep?.status === 'complete' ? 'ok' : 'pending'

  const enrichStatus: FlowTimelineStageStatus =
    enrichmentStep?.status === 'attention' ? 'warn' : enrichmentStep?.status === 'complete' ? 'ok' : 'pending'

  let schemaStage = governanceNoChangeStage()
  if (govHints.schemaDriftOpen > 0) {
    schemaStage = { status: 'warn', detail: `${govHints.schemaDriftOpen} open` }
  } else if (governance?.schemaDrift?.drift_detection_enabled === false) {
    schemaStage = { status: 'skipped', detail: 'Disabled' }
  } else if (displayStatus === 'ERROR') {
    schemaStage = { status: 'warn', detail: GOVERNANCE_NO_CHANGE_DETAIL }
  }

  let sensitiveStage = governanceNoChangeStage()
  if (govHints.sensitiveOpen > 0) {
    sensitiveStage = { status: 'warn', detail: `${govHints.sensitiveOpen} open` }
  } else if (governance?.sensitive?.detection_enabled === false) {
    sensitiveStage = { status: 'skipped', detail: 'Disabled' }
  }

  let protectionStage = governanceNoChangeStage()
  const quarantinedCount = governance?.quarantine?.quarantined_count ?? 0
  const protectedEvents = governance?.protection?.total_protected_events ?? 0
  if (quarantinedCount > 0) {
    protectionStage = {
      status: 'error',
      detail: `${quarantinedCount} quarantined`,
    }
  } else if (protectedEvents > 0) {
    protectionStage = { status: 'ok', detail: `${protectedEvents} protected` }
  } else if (govHints.protectionActive) {
    protectionStage = { status: 'ok', detail: 'Active' }
  } else if (governance?.protection?.protection_enabled === false) {
    protectionStage = { status: 'skipped', detail: 'Off' }
  }

  let policyStage = governanceNoChangeStage()
  if ((governance?.policy?.audit_events ?? 0) > 0 && govHints.policyMatched === 0) {
    policyStage = {
      status: 'warn',
      detail: `${governance?.policy?.audit_events ?? 0} audit`,
    }
  } else if (displayStatus === 'ERROR') {
    policyStage = { status: 'warn', detail: GOVERNANCE_NO_CHANGE_DETAIL }
  } else if (govHints.policyMatched > 0) {
    policyStage = { status: 'ok', detail: `${govHints.policyMatched} matched` }
  }

  const routingStatus: FlowTimelineStageStatus =
    (governance?.failover?.failover_failures ?? 0) > 0
      ? 'warn'
      : govHints.failoverAttempts > 0 || govHints.routingActive
        ? 'ok'
        : governance?.dynamicRouting || governance?.failover
          ? 'ok'
          : 'pending'
  const routingDetail =
    govHints.failoverAttempts > 0
      ? `Failover ${govHints.failoverAttempts}`
      : govHints.routingActive
        ? 'Dynamic routes'
        : governance?.dynamicRouting || governance?.failover
          ? 'Ready'
          : 'No data'

  let destStatus: FlowTimelineStageStatus = 'pending'
  const hasDeliveryOutcomes = safeNonNeg(deliveredLastHour) + safeNonNeg(failedLastHour) > 0
  if (routeStep?.status === 'complete') {
    if ((routesErr ?? 0) > 0 || displayStatus === 'ERROR') destStatus = 'error'
    else if (deliveryPct != null && deliveryPct < 85) destStatus = 'warn'
    else if (displayStatus === 'DEGRADED') destStatus = 'warn'
    else destStatus = 'ok'
  } else if (routeStep?.status === 'attention') {
    destStatus = 'warn'
  }

  return [
    {
      key: 'source',
      label: usesPushIngest ? 'Push ingest' : 'Source',
      shortLabel: 'Source',
      status: sourceStatus,
      href: streamEditPath(streamId),
      detail: displayStatus,
    },
    {
      key: 'mapping',
      label: 'Mapping',
      shortLabel: 'Mapping',
      status: mappingStatus,
      href: streamMappingPath(streamId),
    },
    {
      key: 'enrichment',
      label: 'Enrichment',
      shortLabel: 'Enrichment',
      status: enrichStatus,
      href: streamMappingPath(streamId),
    },
    {
      key: 'schema_drift',
      label: 'Schema Drift',
      shortLabel: 'Schema Drift',
      status: schemaStage.status,
      detail: schemaStage.detail,
    },
    {
      key: 'sensitive',
      label: 'Sensitive Data',
      shortLabel: 'Sensitive',
      status: sensitiveStage.status,
      detail: sensitiveStage.detail,
    },
    {
      key: 'protection',
      label: 'Protection',
      shortLabel: 'Protection',
      status: protectionStage.status,
      detail: protectionStage.detail,
    },
    {
      key: 'policy',
      label: 'Policy',
      shortLabel: 'Policy',
      status: policyStage.status,
      detail: policyStage.detail,
    },
    {
      key: 'routing',
      label: 'Routing',
      shortLabel: 'Routing',
      status: routingStatus,
      detail: routingDetail,
    },
    {
      key: 'destination',
      label: 'Destination',
      shortLabel: 'Destination',
      status: destStatus,
      href: `${streamEditPath(streamId)}?section=delivery`,
      detail: hasDeliveryOutcomes && deliveryPct != null ? `${deliveryPct.toFixed(1)}% delivered` : undefined,
    },
  ]
}

export type StreamFlowTimelineProps = {
  stages: FlowTimelineStage[]
  lastRunLabel?: string | null
  className?: string
}

function stageStatusLabel(status: FlowTimelineStageStatus, detail?: string): string {
  if (detail === GOVERNANCE_NO_CHANGE_DETAIL) return GOVERNANCE_NO_CHANGE_DETAIL
  switch (status) {
    case 'ok':
      return 'Success'
    case 'warn':
      return 'Warning'
    case 'error':
      return 'Failed'
    case 'skipped':
      return 'Skipped'
    default:
      return 'Pending'
  }
}

function stageStatusClass(status: FlowTimelineStageStatus, detail?: string): string {
  if (detail === GOVERNANCE_NO_CHANGE_DETAIL) return 'text-slate-500 dark:text-gdc-muted'
  switch (status) {
    case 'ok':
      return 'text-emerald-600 dark:text-emerald-400'
    case 'warn':
      return 'text-amber-600 dark:text-amber-400'
    case 'error':
      return 'text-red-600 dark:text-red-400'
    default:
      return 'text-slate-500 dark:text-gdc-muted'
  }
}

export function StreamFlowTimeline({ stages, lastRunLabel, className }: StreamFlowTimelineProps) {
  const warnStage = stages.find((s) => s.status === 'warn' || s.status === 'error')

  return (
    <section
      aria-label="Flow status"
      data-testid="stream-flow-timeline"
      className={cn(
        'rounded-xl border border-slate-200/80 bg-white px-4 py-4 shadow-sm dark:border-gdc-border dark:bg-gdc-card',
        className,
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[13px] font-semibold text-slate-900 dark:text-slate-100">Flow Status</h3>
        {lastRunLabel ? (
          <p className="text-[10px] font-medium tabular-nums text-slate-500 dark:text-gdc-muted">Last run: {lastRunLabel}</p>
        ) : null}
      </div>

      <div className="mt-4 overflow-x-auto pb-1">
        <ol className="flex min-w-max items-start gap-0">
          {stages.map((stage, index) => {
            const statusLabel = stageStatusLabel(stage.status, stage.detail)
            const content = (
              <div className="flex w-[7.5rem] flex-col items-center gap-1.5 px-1">
                <span
                  className={cn(
                    'flex h-9 w-9 items-center justify-center rounded-full border-2',
                    stageBubbleClass(stage.status),
                  )}
                  title={`${stage.label}: ${statusLabel}`}
                >
                  {stageIcon(stage.status)}
                </span>
                <span className="text-center text-[11px] font-semibold text-slate-800 dark:text-slate-100">{stage.shortLabel}</span>
                <span className={cn('text-center text-[10px] font-medium', stageStatusClass(stage.status, stage.detail))}>
                  {statusLabel}
                </span>
              </div>
            )
            return (
              <li key={stage.key} className="flex items-start">
                {stage.href ? (
                  <Link to={stage.href} className="rounded-md transition-colors hover:bg-slate-50 dark:hover:bg-gdc-rowHover">
                    {content}
                  </Link>
                ) : (
                  content
                )}
                {index < stages.length - 1 ? (
                  <ArrowRight className="mx-1 mt-3 h-4 w-4 shrink-0 text-slate-400 dark:text-gdc-muted" aria-hidden />
                ) : null}
              </li>
            )
          })}
        </ol>
      </div>

      {warnStage ? (
        <p className="mt-3 text-[11px] text-amber-800 dark:text-amber-200">
          <AlertTriangle className="mr-1 inline h-3.5 w-3.5 align-text-bottom" aria-hidden />
          {warnStage.label}: {warnStage.status === 'error' ? 'error' : 'needs attention'}
          {warnStage.detail ? ` — ${warnStage.detail}` : ''}
        </p>
      ) : null}
    </section>
  )
}
