import { AlertTriangle } from 'lucide-react'
import type { StreamIssueContext } from '../../lib/stream-issue-context'
import type { IssueWhyStep, OperationalIssue } from '../../lib/stream-governance-snapshot'
import { cn } from '../../lib/utils'

function severityBadgeClass(issues: readonly OperationalIssue[]): string {
  if (issues.some((i) => i.tone === 'critical')) {
    return 'border-red-400/50 bg-red-500/10 text-red-300'
  }
  if (issues.length > 0) {
    return 'border-amber-400/50 bg-amber-500/10 text-amber-200'
  }
  return 'border-emerald-400/50 bg-emerald-500/10 text-emerald-300'
}

function severityBadgeLabel(issues: readonly OperationalIssue[]): string {
  if (issues.some((i) => i.tone === 'critical')) return 'Critical'
  if (issues.length > 0) return 'Warning'
  return 'Healthy'
}

function buildSummary(issues: readonly OperationalIssue[], whyChain: readonly IssueWhyStep[]): string {
  if (!issues.length) {
    return 'No delivery, schema, or protection issues detected for this stream in the current window.'
  }
  const parts: string[] = []
  const primary = issues[0]
  if (primary.detail) parts.push(primary.detail)
  else parts.push(primary.label)
  for (const step of whyChain.slice(1, 3)) {
    if (step.detail) parts.push(step.detail)
  }
  return parts.join('. ')
}

function recommendedActions(issues: readonly OperationalIssue[]): string[] {
  if (!issues.length) return []
  const actions: string[] = []
  const keys = new Set(issues.map((i) => i.key))
  if (keys.has('destination') || keys.has('destination-degraded') || keys.has('low-success')) {
    actions.push('Review destination rate limits and retry policy configuration.')
    actions.push('Check delivery logs for HTTP 429 or timeout patterns.')
  }
  if (keys.has('schema-drift')) {
    actions.push('Acknowledge or resolve open schema drift findings.')
  }
  if (keys.has('sensitive') || keys.has('quarantine')) {
    actions.push('Review sensitive data findings and protection rules.')
  }
  if (keys.has('failover')) {
    actions.push('Verify failover route configuration and destination health.')
  }
  if (!actions.length) {
    actions.push('Open delivery records for the latest failure context.')
  }
  return actions.slice(0, 3)
}

export function StreamWhyPanel({
  issues,
  whyChain,
}: {
  ctx: StreamIssueContext
  issues: OperationalIssue[]
  whyChain: IssueWhyStep[]
}) {
  const summary = buildSummary(issues, whyChain)
  const actions = recommendedActions(issues)

  return (
    <section
      aria-label="Why is this happening"
      data-testid="stream-why-panel"
      className="flex flex-col rounded-xl border border-slate-200/80 bg-white shadow-sm dark:border-gdc-border dark:bg-gdc-card"
    >
      <div className="flex items-center justify-between gap-2 border-b border-slate-200/80 px-4 py-3 dark:border-gdc-border">
        <h3 className="text-[13px] font-semibold text-slate-900 dark:text-slate-100">Why is this happening?</h3>
        <span className={cn('rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase', severityBadgeClass(issues))}>
          {severityBadgeLabel(issues)}
        </span>
      </div>
      <div className="flex flex-1 flex-col gap-3 px-4 py-4">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500 dark:text-gdc-muted">Summary</p>
          <p className="mt-1.5 text-[12px] leading-relaxed text-slate-700 dark:text-gdc-mutedStrong">{summary}</p>
        </div>
        {actions.length > 0 ? (
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500 dark:text-gdc-muted">Recommended actions</p>
            <ul className="mt-1.5 space-y-1.5">
              {actions.map((action) => (
                <li key={action} className="flex items-start gap-1.5 text-[11px] text-slate-700 dark:text-gdc-mutedStrong">
                  <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-amber-500" aria-hidden />
                  <span>{action}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </section>
  )
}
