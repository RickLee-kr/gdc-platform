import { AlertTriangle, XCircle } from 'lucide-react'
import { Link } from 'react-router-dom'
import { streamRuntimePath } from '../../config/nav-paths'
import type { ProblemStreamItem } from '../../lib/streams-console-operations'
import { cn } from '../../lib/utils'

function severityLabel(severity: ProblemStreamItem['severity']): string {
  return severity === 'critical' ? 'Critical' : 'Warning'
}

export function StreamsProblemPanel({ items }: { items: readonly ProblemStreamItem[] }) {
  return (
    <section
      aria-label="Problem streams"
      data-testid="streams-problem-panel"
      className="rounded-xl border border-slate-200/80 bg-white p-3 shadow-sm dark:border-gdc-border dark:bg-gdc-card"
    >
      <h3 className="text-[14px] font-semibold text-slate-900 dark:text-slate-100">Problem Streams</h3>
      <p className="mt-0.5 text-[11px] text-slate-500 dark:text-gdc-muted">Warning and critical streams requiring attention.</p>

      {items.length === 0 ? (
        <p className="mt-3 text-[12px] text-slate-500 dark:text-gdc-muted" data-testid="streams-problem-empty">
          No streams currently require attention.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-slate-200/70 dark:divide-gdc-border">
          {items.map((item) => (
            <li key={item.row.id}>
              <Link
                to={streamRuntimePath(item.row.id)}
                data-testid={`streams-problem-row-${item.row.id}`}
                className="flex items-center gap-3 py-2.5 transition hover:bg-slate-50/80 dark:hover:bg-gdc-rowHover/50"
              >
                <span
                  className={cn(
                    'inline-flex shrink-0 items-center gap-1 rounded border px-1.5 py-0.5 text-[9px] font-bold uppercase',
                    item.severity === 'critical'
                      ? 'border-red-500/40 bg-red-500/10 text-red-300'
                      : 'border-amber-500/40 bg-amber-500/10 text-amber-300',
                  )}
                >
                  {item.severity === 'critical' ? (
                    <XCircle className="h-3 w-3" aria-hidden />
                  ) : (
                    <AlertTriangle className="h-3 w-3" aria-hidden />
                  )}
                  {severityLabel(item.severity)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-semibold text-slate-900 dark:text-slate-100">{item.row.name}</p>
                  <p className="truncate text-[11px] text-slate-500 dark:text-gdc-muted">{item.productLabel}</p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-[11px] font-semibold tabular-nums text-slate-700 dark:text-slate-200">
                    {item.issueCount > 0 ? item.issueCount : '—'}
                  </p>
                  <p className="text-[10px] text-slate-500 dark:text-gdc-muted">issues</p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
