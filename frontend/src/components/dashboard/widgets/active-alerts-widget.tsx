import { AlertTriangle, XCircle } from 'lucide-react'
import { Link } from 'react-router-dom'
import { logsExplorerPath } from '../../../config/nav-paths'
import { cn } from '../../../lib/utils'
import type { RuntimeAlertSummaryItem } from '../../../api/types/gdcApi'

function fmtUtcTime(iso: string): string {
  try {
    const d = new Date(iso)
    return `${d.toISOString().slice(11, 19)} UTC`
  } catch {
    return iso
  }
}

export type ActiveAlertsWidgetProps = {
  items: RuntimeAlertSummaryItem[]
  loading: boolean
}

export function ActiveAlertsWidget({ items, loading }: ActiveAlertsWidgetProps) {
  const display = items.slice(0, 8)

  return (
    <div className={cn('space-y-1.5', loading && 'opacity-80')} aria-busy={loading}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-gdc-muted">
          Active alerts
        </h3>
        <Link to="/logs" className="text-[11px] font-semibold text-violet-700 hover:underline dark:text-violet-300">
          Logs
        </Link>
      </div>
      <ul className="space-y-2 rounded-md border border-slate-200/80 bg-white/60 p-2 dark:border-gdc-divider dark:bg-gdc-section">
        {display.length === 0 ? (
          <li className="px-1 py-2 text-[12px] text-slate-500 dark:text-gdc-muted">No WARN/ERROR clusters.</li>
        ) : (
          display.map((item, i) => (
            <li key={`${item.stream_id}-${item.latest_occurrence}-${i}`} className="flex gap-2 text-[11px] leading-snug">
              {item.severity === 'ERROR' ? (
                <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-500" aria-hidden />
              ) : (
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" aria-hidden />
              )}
              <div className="min-w-0 flex-1">
                <p className="font-medium text-slate-800 dark:text-slate-100">
                  <Link
                    to={logsExplorerPath({ stream_id: item.stream_id })}
                    className="text-violet-700 hover:underline dark:text-violet-300"
                  >
                    {item.stream_name}
                  </Link>
                  <span className="text-slate-400 dark:text-gdc-muted"> · {item.connector_name}</span>
                </p>
                <p className="text-slate-600 dark:text-gdc-muted">
                  {item.severity}: {item.count} events · last {fmtUtcTime(item.latest_occurrence)}
                </p>
              </div>
            </li>
          ))
        )}
      </ul>
    </div>
  )
}
