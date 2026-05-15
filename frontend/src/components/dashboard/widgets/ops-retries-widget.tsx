import { Link } from 'react-router-dom'
import { NAV_PATH, runtimeAnalyticsPath } from '../../../config/nav-paths'
import { RuntimeChartCard } from '../../shell/runtime-chart-card'
import type { RetrySummaryResponse } from '../../../api/types/gdcApi'

export type OpsRetriesWidgetProps = {
  retries: RetrySummaryResponse | null
  loading: boolean
}

export function OpsRetriesWidget({ retries, loading }: OpsRetriesWidgetProps) {
  const r = retries
  const total = r?.total_retry_outcome_events
  return (
    <RuntimeChartCard
      title="Retries"
      subtitle="Retry-stage outcomes in delivery_logs for the selected window."
      actions={
        <Link
          to={runtimeAnalyticsPath({ window: r?.time.window })}
          className="text-[11px] font-semibold text-violet-700 hover:underline dark:text-violet-300"
        >
          Analytics
        </Link>
      }
    >
      <div className={`space-y-2 ${loading ? 'opacity-80' : ''}`} aria-busy={loading}>
        {!r && !loading ? (
          <p className="text-[12px] text-slate-500 dark:text-gdc-muted">No retry summary.</p>
        ) : null}
        {r ? (
          <>
            <p className="font-mono text-2xl font-semibold tabular-nums text-slate-900 dark:text-slate-50">
              {total != null ? total : '—'}
            </p>
            <ul className="space-y-1 text-[11px] text-slate-600 dark:text-gdc-muted">
              <li className="flex justify-between gap-2 tabular-nums">
                <span>Retry success</span>
                <span className="font-medium text-emerald-700 dark:text-emerald-400">{r.retry_success_events}</span>
              </li>
              <li className="flex justify-between gap-2 tabular-nums">
                <span>Retry failed</span>
                <span className="font-medium text-red-700 dark:text-red-400">{r.retry_failed_events}</span>
              </li>
            </ul>
            {r.retry_failed_events > r.retry_success_events && r.retry_failed_events >= 3 ? (
              <p className="rounded-md border border-amber-200/80 bg-amber-500/[0.06] px-2 py-1.5 text-[10px] font-semibold leading-snug text-amber-950 dark:border-amber-900/40 dark:bg-amber-500/10 dark:text-amber-100">
                Retry failures dominate successes — check route_send_failed / route_retry_failed in Logs and confirm
                destinations are reachable.
              </p>
            ) : null}
            <Link
              to={NAV_PATH.logs}
              className="inline-block text-[10px] font-semibold text-violet-700 hover:underline dark:text-violet-300"
            >
              Search delivery logs →
            </Link>
          </>
        ) : null}
      </div>
    </RuntimeChartCard>
  )
}
