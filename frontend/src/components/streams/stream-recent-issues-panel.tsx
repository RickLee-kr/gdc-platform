import { AlertTriangle, CheckCircle2, XCircle } from 'lucide-react'
import { Link } from 'react-router-dom'
import { logsPath } from '../../config/nav-paths'
import type { StreamIssueContext } from '../../lib/stream-issue-context'
import type { IssueWhyStep, OperationalIssue, StreamGovernanceSnapshot } from '../../lib/stream-governance-snapshot'
import { cn } from '../../lib/utils'

type StatusRow = {
  key: string
  label: string
  detail: string
  tone: 'ok' | 'warn' | 'critical'
}

function issueToStatusRow(issue: OperationalIssue): StatusRow {
  return {
    key: issue.key,
    label: issue.label,
    detail: issue.detail ?? 'Active on this stream',
    tone: issue.tone === 'critical' ? 'critical' : issue.tone === 'warning' ? 'warn' : 'ok',
  }
}

function buildStatusRows(
  ctx: StreamIssueContext,
  issues: OperationalIssue[],
  gov?: StreamGovernanceSnapshot | null,
): StatusRow[] {
  const byKey = new Map(issues.map((i) => [i.key, i]))
  const rows: StatusRow[] = []

  const destIssue = byKey.get('destination') ?? byKey.get('destination-degraded') ?? byKey.get('low-success')
  rows.push(
    destIssue
      ? issueToStatusRow(destIssue)
      : {
          key: 'destination',
          label: 'Destination delivery',
          detail: ctx.routesError > 0 ? `${ctx.routesError} path error` : 'No delivery failures',
          tone: ctx.routesError > 0 || ctx.status === 'ERROR' ? 'critical' : ctx.status === 'DEGRADED' ? 'warn' : 'ok',
        },
  )

  const errorRateIssue = issues.find((i) => i.key === 'low-success' || i.label.toLowerCase().includes('error'))
  rows.push(
    errorRateIssue
      ? issueToStatusRow(errorRateIssue)
      : {
          key: 'error-rate',
          label: 'High error rate',
          detail:
            ctx.deliveryPctKnown && ctx.deliveryPct < 90
              ? `Success rate ${ctx.deliveryPct.toFixed(1)}%`
              : 'Within healthy threshold',
          tone: ctx.deliveryPctKnown && ctx.deliveryPct < 85 ? 'critical' : ctx.deliveryPctKnown && ctx.deliveryPct < 95 ? 'warn' : 'ok',
        },
  )

  rows.push({
    key: 'volume',
    label: 'Low volume',
    detail: 'Ingest within expected range',
    tone: 'ok',
  })

  const schemaIssue = byKey.get('schema-drift')
  rows.push(
    schemaIssue
      ? issueToStatusRow(schemaIssue)
      : {
          key: 'schema-drift',
          label: 'Schema drift',
          detail: (gov?.schemaDrift?.open_count ?? 0) > 0 ? `${gov?.schemaDrift?.open_count} open` : 'No drift detected',
          tone: (gov?.schemaDrift?.open_count ?? 0) > 0 ? 'warn' : 'ok',
        },
  )

  const sensitiveIssue = byKey.get('sensitive')
  rows.push(
    sensitiveIssue
      ? issueToStatusRow(sensitiveIssue)
      : {
          key: 'sensitive',
          label: 'Sensitive detection',
          detail: (gov?.sensitive?.open_count ?? 0) > 0 ? `${gov?.sensitive?.open_count} open` : 'No sensitive findings',
          tone: (gov?.sensitive?.open_count ?? 0) > 0 ? 'warn' : 'ok',
        },
  )

  return rows
}

function StatusIcon({ tone }: { tone: StatusRow['tone'] }) {
  if (tone === 'critical') return <XCircle className="h-4 w-4 shrink-0 text-red-500" aria-hidden />
  if (tone === 'warn') return <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" aria-hidden />
  return <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" aria-hidden />
}

export function StreamRecentIssuesPanel({
  ctx,
  issues,
  whyChain: _whyChain,
  governance,
}: {
  ctx: StreamIssueContext
  issues: OperationalIssue[]
  whyChain: IssueWhyStep[]
  governance?: StreamGovernanceSnapshot | null
}) {
  const statusRows = buildStatusRows(ctx, issues, governance)
  const activeCount = statusRows.filter((r) => r.tone !== 'ok').length

  return (
    <section
      aria-label="Recent issues"
      data-testid="stream-recent-issues-panel"
      className="flex min-h-[280px] flex-col rounded-xl border border-slate-200/80 bg-white shadow-sm dark:border-gdc-border dark:bg-gdc-card"
    >
      <div className="flex items-center justify-between gap-2 border-b border-slate-200/80 px-4 py-3 dark:border-gdc-border">
        <div>
          <h3 className="text-[13px] font-semibold text-slate-900 dark:text-slate-100">Recent Issues</h3>
          <p className="mt-0.5 text-[10px] text-slate-500 dark:text-gdc-muted">
            {activeCount > 0 ? `${activeCount} item${activeCount === 1 ? '' : 's'} need attention` : 'Operational status by category'}
          </p>
        </div>
        <Link to={logsPath(ctx.id)} className="text-[11px] font-semibold text-violet-600 hover:underline dark:text-violet-400">
          View all →
        </Link>
      </div>

      <ul className="flex-1 divide-y divide-slate-200/70 dark:divide-gdc-divider">
        {statusRows.map((row) => (
          <li key={row.key} className="flex items-start gap-3 px-4 py-3">
            <StatusIcon tone={row.tone} />
            <div className="min-w-0 flex-1">
              <p
                className={cn(
                  'text-[12px] font-semibold',
                  row.tone === 'critical' && 'text-red-700 dark:text-red-300',
                  row.tone === 'warn' && 'text-amber-800 dark:text-amber-200',
                  row.tone === 'ok' && 'text-slate-800 dark:text-slate-100',
                )}
              >
                {row.label}
              </p>
              <p className="mt-0.5 text-[11px] text-slate-500 dark:text-gdc-muted">{row.detail}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
