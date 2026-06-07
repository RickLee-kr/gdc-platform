import { AlertTriangle, ArrowRight, Check, Circle, Minus } from 'lucide-react'
import { Link } from 'react-router-dom'
import { cn } from '../../lib/utils'
import { streamEditPath, streamMappingPath } from '../../config/nav-paths'
import type { StreamWorkflowSnapshot } from '../../utils/streamWorkflow'
import type { StreamRuntimeStatus } from '../../api/streamRows'

export type FlowTimelineStageStatus = 'ok' | 'warn' | 'error' | 'skipped' | 'pending'

export type FlowTimelineStage = {
  key: string
  label: string
  shortLabel: string
  status: FlowTimelineStageStatus
  href?: string
  detail?: string
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
  routesErr: number | null
  usesPushIngest: boolean
}): FlowTimelineStage[] {
  const { streamId, displayStatus, workflow, deliveryPct, routesErr, usesPushIngest } = params

  const mappingStep = workflow.steps.find((s) => s.key === 'mapping')
  const enrichmentStep = workflow.steps.find((s) => s.key === 'enrichment')
  const routeStep = workflow.steps.find((s) => s.key === 'route')

  const sourceStatus: FlowTimelineStageStatus =
    displayStatus === 'ERROR' ? 'error' : displayStatus === 'DEGRADED' ? 'warn' : displayStatus === 'STOPPED' ? 'pending' : 'ok'

  const mappingStatus: FlowTimelineStageStatus =
    mappingStep?.status === 'attention' ? 'warn' : mappingStep?.status === 'complete' ? 'ok' : 'pending'

  const enrichStatus: FlowTimelineStageStatus =
    enrichmentStep?.status === 'attention' ? 'warn' : enrichmentStep?.status === 'complete' ? 'ok' : 'pending'

  const policyStatus: FlowTimelineStageStatus = displayStatus === 'ERROR' ? 'warn' : 'ok'

  let destStatus: FlowTimelineStageStatus = 'pending'
  if (routeStep?.status === 'complete') {
    if ((routesErr ?? 0) > 0 || displayStatus === 'ERROR') destStatus = 'error'
    else if ((deliveryPct ?? 100) < 85 || displayStatus === 'DEGRADED') destStatus = 'warn'
    else destStatus = 'ok'
  } else if (routeStep?.status === 'attention') {
    destStatus = 'warn'
  }

  return [
    {
      key: 'source',
      label: usesPushIngest ? 'Push ingest' : 'Source',
      shortLabel: 'Src',
      status: sourceStatus,
      href: streamEditPath(streamId),
      detail: displayStatus,
    },
    {
      key: 'mapping',
      label: 'Mapping',
      shortLabel: 'Map',
      status: mappingStatus,
      href: streamMappingPath(streamId),
    },
    {
      key: 'enrichment',
      label: 'Enrichment',
      shortLabel: 'Enr',
      status: enrichStatus,
      href: streamMappingPath(streamId),
    },
    {
      key: 'policy',
      label: 'Policy',
      shortLabel: 'Pol',
      status: policyStatus,
      detail: 'Governance rules',
    },
    {
      key: 'destination',
      label: 'Destination',
      shortLabel: 'Dest',
      status: destStatus,
      href: `${streamEditPath(streamId)}?section=delivery`,
      detail: deliveryPct != null ? `${deliveryPct.toFixed(1)}% delivered` : undefined,
    },
  ]
}

export type StreamFlowTimelineProps = {
  stages: FlowTimelineStage[]
  lastRunLabel?: string | null
  className?: string
}

export function StreamFlowTimeline({ stages, lastRunLabel, className }: StreamFlowTimelineProps) {
  const warnStage = stages.find((s) => s.status === 'warn' || s.status === 'error')

  return (
    <section
      aria-label="Flow timeline"
      data-testid="stream-flow-timeline"
      className={cn(
        'rounded-xl border border-slate-200/80 bg-white px-4 py-3 shadow-sm dark:border-gdc-border dark:bg-gdc-card',
        className,
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-[13px] font-semibold text-slate-900 dark:text-slate-100">Flow Timeline</h3>
          <p className="text-[11px] text-slate-600 dark:text-gdc-muted">Single pipeline flow — stage status at a glance</p>
        </div>
        {lastRunLabel ? (
          <p className="text-[10px] font-medium tabular-nums text-slate-500 dark:text-gdc-muted">Last run: {lastRunLabel}</p>
        ) : null}
      </div>

      <div className="mt-3 overflow-x-auto pb-1">
        <ol className="flex min-w-max items-center gap-0">
          {stages.map((stage, index) => {
            const content = (
              <div className="flex flex-col items-center gap-1 px-1">
                <span
                  className={cn(
                    'flex h-7 w-7 items-center justify-center rounded-full border-2',
                    stageBubbleClass(stage.status),
                  )}
                  title={`${stage.label}: ${stage.status}`}
                >
                  {stageIcon(stage.status)}
                </span>
                <span className="text-[10px] font-semibold text-slate-700 dark:text-slate-200">{stage.shortLabel}</span>
                <span className="hidden text-[9px] text-slate-500 dark:text-gdc-muted sm:inline">{stage.label}</span>
              </div>
            )
            return (
              <li key={stage.key} className="flex items-center">
                {stage.href ? (
                  <Link to={stage.href} className="rounded-md transition-colors hover:bg-slate-50 dark:hover:bg-gdc-rowHover">
                    {content}
                  </Link>
                ) : (
                  content
                )}
                {index < stages.length - 1 ? (
                  <ArrowRight className="mx-0.5 h-3.5 w-3.5 shrink-0 text-slate-300 dark:text-gdc-muted" aria-hidden />
                ) : null}
              </li>
            )
          })}
        </ol>
      </div>

      {warnStage ? (
        <p className="mt-2 text-[11px] text-amber-800 dark:text-amber-200">
          <AlertTriangle className="mr-1 inline h-3.5 w-3.5 align-text-bottom" aria-hidden />
          {warnStage.label}: {warnStage.status === 'error' ? 'error' : 'needs attention'}
          {warnStage.detail ? ` — ${warnStage.detail}` : ''}
        </p>
      ) : null}

      <p className="mt-2 text-[9px] text-slate-400 dark:text-gdc-muted">
        Legend: <span className="text-emerald-600 dark:text-emerald-400">● ok</span>
        {' · '}
        <span className="text-amber-600 dark:text-amber-400">○ warn</span>
        {' · '}
        <span className="text-red-600 dark:text-red-400">✕ error</span>
        {' · '}
        <span>— skipped</span>
      </p>
    </section>
  )
}
