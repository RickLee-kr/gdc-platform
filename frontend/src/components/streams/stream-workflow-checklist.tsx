import { AlertTriangle, ArrowRight, Check, Circle, Cpu, Pencil, ScrollText } from 'lucide-react'
import { Link } from 'react-router-dom'
import { cn } from '../../lib/utils'
import { logsPath } from '../../config/nav-paths'
import type { StreamWorkflowSnapshot, StreamWorkflowStep, StreamWorkflowStepKey } from '../../utils/streamWorkflow'

function statusIcon(step: StreamWorkflowStep) {
  if (step.status === 'complete') {
    return <Check className="h-3 w-3" strokeWidth={3} aria-hidden />
  }
  if (step.status === 'attention') {
    return <AlertTriangle className="h-3 w-3" aria-hidden />
  }
  return <Circle className="h-2.5 w-2.5" aria-hidden />
}

function statusBubbleClass(step: StreamWorkflowStep) {
  if (step.status === 'complete') {
    return 'border-emerald-500/40 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
  }
  if (step.status === 'attention') {
    return 'border-amber-500/40 bg-amber-500/15 text-amber-700 dark:text-amber-300'
  }
  return 'border-slate-300 bg-white text-slate-500 dark:border-gdc-border dark:bg-gdc-card dark:text-gdc-muted'
}

export type StreamWorkflowProgressBadgeProps = {
  snapshot: StreamWorkflowSnapshot
  className?: string
  ariaLabel?: string
}

/** Compact `{completed}/{total}` workflow indicator linking to the next action. */
export function StreamWorkflowProgressBadge({ snapshot, className, ariaLabel }: StreamWorkflowProgressBadgeProps) {
  const tone =
    snapshot.attentionCount > 0
      ? 'border-amber-500/45 bg-amber-500/10 text-amber-900 dark:text-amber-100'
      : snapshot.isReadyToStart
        ? 'border-emerald-500/45 bg-emerald-500/10 text-emerald-900 dark:text-emerald-100'
        : 'border-violet-500/35 bg-violet-500/[0.08] text-violet-900 dark:text-violet-100'
  return (
    <Link
      to={snapshot.nextStepPath}
      className={cn(
        'inline-flex h-7 items-center gap-1 rounded-md border px-2 text-[10px] font-semibold hover:bg-violet-500/[0.14]',
        tone,
        className,
      )}
      title={`Next step: ${snapshot.nextStepLabel}`}
      aria-label={ariaLabel ?? `Workflow ${snapshot.completedCount}/${snapshot.totalCount} · Next: ${snapshot.nextStepLabel}`}
    >
      {snapshot.completedCount}/{snapshot.totalCount}
    </Link>
  )
}

export type StreamWorkflowChecklistProps = {
  snapshot: StreamWorkflowSnapshot
  /** Show the runtime/edit drilldown row underneath the checklist. */
  showRuntimeLinks?: boolean
  /** Optional inline buttons rendered next to the next-action link (e.g. Start/Stop). */
  actions?: React.ReactNode
  className?: string
  /** Smaller layout for sticky sidebars on workflow pages. */
  compact?: boolean
}

/**
 * Operator-facing workflow checklist with progress bar, per-step status, and
 * the next action button. Reused by the streams console and the workflow
 * pages so the same definition drives the UI across the configuration loop.
 */
export function StreamWorkflowChecklist({
  snapshot,
  showRuntimeLinks = true,
  actions,
  className,
  compact = false,
}: StreamWorkflowChecklistProps) {
  return (
    <section
      className={cn(
        'rounded-lg border border-slate-200/80 bg-slate-50/80 p-3 dark:border-gdc-border dark:bg-gdc-card',
        className,
      )}
      aria-label="Stream workflow progress"
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-gdc-muted">
            Workflow Progress
          </p>
          <p className="mt-0.5 text-[12px] font-semibold text-slate-900 dark:text-slate-100">
            {snapshot.completedCount}/{snapshot.totalCount} configured
            <span className="mx-1 text-slate-400">·</span>
            <span className={cn(snapshot.attentionCount > 0 && 'text-amber-700 dark:text-amber-300')}>
              Next: {snapshot.nextStepLabel}
            </span>
          </p>
          {snapshot.nextStepDetail ? (
            <p className="mt-0.5 text-[11px] text-slate-500 dark:text-gdc-muted">{snapshot.nextStepDetail}</p>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {actions}
          <Link
            to={snapshot.nextStepPath}
            className="inline-flex h-8 items-center gap-1.5 rounded-md bg-violet-600 px-3 text-[12px] font-semibold text-white shadow-sm hover:bg-violet-700"
          >
            {snapshot.nextStepLabel}
            <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          </Link>
        </div>
      </div>

      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-gdc-elevated">
        <div
          className={cn(
            'h-full rounded-full transition-[width]',
            snapshot.attentionCount > 0
              ? 'bg-amber-500'
              : snapshot.isReadyToStart
                ? 'bg-emerald-500'
                : 'bg-violet-500',
          )}
          style={{ width: `${snapshot.pct}%` }}
        />
      </div>

      <ul className={cn('mt-2 grid gap-1', compact ? 'sm:grid-cols-2' : 'sm:grid-cols-2 lg:grid-cols-4')}>
        {snapshot.steps.map((step) => (
          <li key={step.key} className="min-w-0">
            <Link
              to={step.to}
              className={cn(
                'flex items-center gap-1.5 rounded-md border px-2 py-1.5 text-[11px] transition-colors',
                step.status === 'complete'
                  ? 'border-emerald-500/30 bg-emerald-500/[0.06] hover:bg-emerald-500/10 dark:border-emerald-500/30'
                  : step.status === 'attention'
                    ? 'border-amber-500/35 bg-amber-500/[0.07] hover:bg-amber-500/12 dark:border-amber-500/35'
                    : 'border-slate-200/80 bg-white/80 hover:bg-slate-50 dark:border-gdc-border dark:bg-gdc-card dark:hover:bg-gdc-rowHover',
              )}
            >
              <span
                className={cn(
                  'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border',
                  statusBubbleClass(step),
                )}
                aria-hidden
              >
                {statusIcon(step)}
              </span>
              <span className="min-w-0 truncate font-semibold text-slate-800 dark:text-slate-200">{step.shortLabel}</span>
              <span className="ml-auto shrink-0 text-[10px] uppercase tracking-wide text-slate-500 dark:text-gdc-muted">
                {step.status === 'complete' ? 'Done' : step.status === 'attention' ? 'Check' : 'To do'}
              </span>
            </Link>
          </li>
        ))}
      </ul>

      {showRuntimeLinks ? (
        <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-slate-200/70 pt-2 text-[11px] dark:border-gdc-border">
          <Link
            to={snapshot.runtimePath}
            className="inline-flex h-7 items-center gap-1 rounded-md border border-violet-200/80 bg-violet-500/[0.06] px-2 font-semibold text-violet-900 hover:bg-violet-500/10 dark:border-violet-500/30 dark:bg-violet-500/10 dark:text-violet-100 dark:hover:bg-violet-500/15"
          >
            <Cpu className="h-3.5 w-3.5" aria-hidden />
            View Runtime
          </Link>
          <Link
            to={snapshot.editPath}
            className="inline-flex h-7 items-center gap-1 rounded-md border border-slate-200/90 bg-white px-2 font-semibold text-slate-800 hover:bg-slate-50 dark:border-gdc-border dark:bg-gdc-card dark:text-slate-100 dark:hover:bg-gdc-rowHover"
          >
            <Pencil className="h-3.5 w-3.5" aria-hidden />
            Edit Stream
          </Link>
          <Link
            to={logsPath(snapshot.streamId)}
            className="inline-flex h-7 items-center gap-1 rounded-md border border-slate-200/90 bg-white px-2 font-semibold text-slate-800 hover:bg-slate-50 dark:border-gdc-border dark:bg-gdc-card dark:text-slate-100 dark:hover:bg-gdc-rowHover"
          >
            <ScrollText className="h-3.5 w-3.5" aria-hidden />
            View Logs
          </Link>
          <span className="ml-auto text-[10px] text-slate-500 dark:text-gdc-muted">
            {snapshot.isNumericStreamId
              ? 'API-backed stream id · live runtime data when available'
              : 'Slug-based stream id · runtime view falls back to baseline data'}
          </span>
        </div>
      ) : null}
    </section>
  )
}

export type StreamWorkflowSummaryStripProps = {
  snapshot: StreamWorkflowSnapshot
  /** Steps to highlight as already configured (forces 'complete' on the strip view only). */
  highlightCompleted?: ReadonlyArray<StreamWorkflowStepKey>
  /** Active step on the current page (rendered as 'in-progress'). */
  activeStep?: StreamWorkflowStepKey
  className?: string
}

/**
 * Slim workflow summary banner for sub-pages like API Test, Mapping, Enrichment.
 *
 * Shows a horizontal step list with the current page highlighted, the next
 * action button, and direct drilldowns to Runtime / Edit / Logs.
 */
export function StreamWorkflowSummaryStrip({
  snapshot,
  highlightCompleted,
  activeStep,
  className,
}: StreamWorkflowSummaryStripProps) {
  const overrides = new Set(highlightCompleted ?? [])
  return (
    <section
      className={cn(
        'flex flex-wrap items-center gap-2 rounded-lg border border-slate-200/80 bg-white/80 px-3 py-2 text-[11px] shadow-sm dark:border-gdc-border dark:bg-gdc-card',
        className,
      )}
      aria-label="Stream workflow summary"
    >
      <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500 dark:text-gdc-muted">
        Workflow {snapshot.completedCount}/{snapshot.totalCount}
      </span>
      <ol className="flex flex-wrap items-center gap-1">
        {snapshot.steps.map((step, index) => {
          const isActive = activeStep === step.key
          const treatComplete = step.status === 'complete' || overrides.has(step.key)
          const tone = isActive
            ? 'border-violet-500/45 bg-violet-500/[0.10] text-violet-800 dark:bg-violet-500/15 dark:text-violet-200'
            : treatComplete
              ? 'border-emerald-500/30 bg-emerald-500/[0.06] text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-200'
              : step.status === 'attention'
                ? 'border-amber-500/35 bg-amber-500/[0.07] text-amber-800 dark:bg-amber-500/10 dark:text-amber-200'
                : 'border-slate-200/90 bg-slate-50 text-slate-600 dark:border-gdc-border dark:bg-gdc-card dark:text-gdc-mutedStrong'
          return (
            <li key={step.key} className="flex items-center">
              <Link
                to={step.to}
                className={cn(
                  'inline-flex h-6 items-center gap-1 rounded-md border px-1.5 font-semibold transition-colors hover:brightness-105',
                  tone,
                )}
              >
                <span className="text-[9px] font-bold tabular-nums">{index + 1}</span>
                <span className="hidden sm:inline">{step.shortLabel}</span>
                {isActive ? null : treatComplete ? (
                  <Check className="h-3 w-3" aria-hidden />
                ) : step.status === 'attention' ? (
                  <AlertTriangle className="h-3 w-3" aria-hidden />
                ) : null}
              </Link>
              {index < snapshot.steps.length - 1 ? (
                <span aria-hidden className="px-1 text-slate-300 dark:text-gdc-muted">›</span>
              ) : null}
            </li>
          )
        })}
      </ol>
      <Link
        to={snapshot.nextStepPath}
        className="ml-auto inline-flex h-7 items-center gap-1 rounded-md bg-violet-600 px-2.5 text-[11px] font-semibold text-white hover:bg-violet-700"
        title={`Next: ${snapshot.nextStepLabel}`}
      >
        {snapshot.nextStepLabel}
        <ArrowRight className="h-3.5 w-3.5" aria-hidden />
      </Link>
      <Link
        to={snapshot.runtimePath}
        className="inline-flex h-7 items-center gap-1 rounded-md border border-violet-200/80 bg-violet-500/[0.06] px-2 font-semibold text-violet-900 hover:bg-violet-500/10 dark:border-violet-500/30 dark:bg-violet-500/10 dark:text-violet-100 dark:hover:bg-violet-500/15"
      >
        <Cpu className="h-3.5 w-3.5" aria-hidden />
        Runtime
      </Link>
      <Link
        to={snapshot.editPath}
        className="inline-flex h-7 items-center gap-1 rounded-md border border-slate-200/90 bg-white px-2 font-semibold text-slate-800 hover:bg-slate-50 dark:border-gdc-border dark:bg-gdc-card dark:text-slate-100 dark:hover:bg-gdc-rowHover"
      >
        <Pencil className="h-3.5 w-3.5" aria-hidden />
        Edit
      </Link>
    </section>
  )
}
