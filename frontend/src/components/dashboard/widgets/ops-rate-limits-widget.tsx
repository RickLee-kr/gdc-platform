import { Link } from 'react-router-dom'
import { logsExplorerPath } from '../../../config/nav-paths'
import { cn } from '../../../lib/utils'
import { RuntimeChartCard } from '../../shell/runtime-chart-card'
import { opTable, opTd, opTh, opThRow, opTr } from './operational-table-styles'
import type { DashboardSummaryNumbers, RecentRateLimitedRouteItem } from '../../../api/types/gdcApi'

export type OpsRateLimitsWidgetProps = {
  summary: DashboardSummaryNumbers | null
  recentRateLimitedRoutes: RecentRateLimitedRouteItem[]
  streamNameById: Map<number, string>
  loading: boolean
}

function shortTs(iso: string): string {
  return String(iso).slice(0, 19).replace('T', ' ')
}

export function OpsRateLimitsWidget({
  summary,
  recentRateLimitedRoutes,
  streamNameById,
  loading,
}: OpsRateLimitsWidgetProps) {
  const s = summary
  const rows = recentRateLimitedRoutes.slice(0, 6)

  return (
    <RuntimeChartCard
      title="Rate limits"
      subtitle="Streams currently in source/destination rate-limit state, plus recent destination_rate_limited log rows."
      actions={
        <Link to="/logs" className="text-[11px] font-semibold text-violet-700 hover:underline dark:text-violet-300">
          Logs
        </Link>
      }
    >
      <div className={cn('space-y-3', loading && 'opacity-80')} aria-busy={loading}>
        <div className="grid grid-cols-2 gap-2 text-center">
          <div className="rounded-md border border-amber-200/80 bg-amber-500/[0.06] px-2 py-2 dark:border-amber-800/50 dark:bg-amber-500/10">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-gdc-muted">Source RL</p>
            <p className="font-mono text-lg font-bold tabular-nums text-amber-900 dark:text-amber-100">
              {s != null ? s.rate_limited_source_streams : '—'}
            </p>
            <p className="text-[10px] text-slate-500 dark:text-gdc-muted">streams</p>
          </div>
          <div className="rounded-md border border-amber-200/80 bg-amber-500/[0.06] px-2 py-2 dark:border-amber-800/50 dark:bg-amber-500/10">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-gdc-muted">Dest RL</p>
            <p className="font-mono text-lg font-bold tabular-nums text-amber-900 dark:text-amber-100">
              {s != null ? s.rate_limited_destination_streams : '—'}
            </p>
            <p className="text-[10px] text-slate-500 dark:text-gdc-muted">streams</p>
          </div>
        </div>
        {s != null ? (
          <p className="text-[11px] text-slate-600 dark:text-gdc-muted">
            Window: <span className="tabular-nums font-medium">{s.recent_rate_limited}</span> rate-limited delivery rows.
          </p>
        ) : null}

        <div>
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-gdc-muted">
            Recent rate-limited routes
          </p>
          {rows.length === 0 ? (
            <p className="text-[12px] text-slate-500 dark:text-gdc-muted">No recent destination rate-limit rows.</p>
          ) : (
            <div className="max-h-[200px] overflow-auto rounded-md border border-slate-200/80 dark:border-gdc-divider">
              <table className={opTable}>
                <thead>
                  <tr className={opThRow}>
                    <th className={opTh}>When (UTC)</th>
                    <th className={opTh}>Stream</th>
                    <th className={opTh}>Route</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, i) => (
                    <tr key={`${row.route_id}-${row.created_at}-${i}`} className={opTr}>
                      <td className={opTd}>
                        <Link
                          to={logsExplorerPath({
                            stream_id: row.stream_id,
                            route_id: row.route_id,
                            stage: 'destination_rate_limited',
                          })}
                          className="text-violet-700 hover:underline dark:text-violet-300"
                        >
                          {shortTs(row.created_at)}
                        </Link>
                      </td>
                      <td className={opTd}>
                        <span className="truncate" title={streamNameById.get(row.stream_id) ?? undefined}>
                          {streamNameById.get(row.stream_id) ?? `Stream ${row.stream_id}`}
                        </span>
                      </td>
                      <td className={cn(opTd, 'font-mono')}>#{row.route_id}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </RuntimeChartCard>
  )
}
