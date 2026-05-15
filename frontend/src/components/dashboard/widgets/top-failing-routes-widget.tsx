import { AlertTriangle, XCircle } from 'lucide-react'
import { Link } from 'react-router-dom'
import { routeEditPath, runtimeOverviewPath } from '../../../config/nav-paths'
import { formatFactorsTooltip, healthLevelToStatusTone, operationalFactorTags } from '../../../lib/operational-health-present'
import { TableContainer } from '../../shell/table-container'
import { StatusBadge } from '../../shell/status-badge'
import type { RouteHealthRow } from '../../../api/types/gdcApi'
import { opTable, opTd, opTh, opThRow, opTr } from './operational-table-styles'
import { cn } from '../../../lib/utils'

function routeIcon(rate: number) {
  if (rate >= 0.25) {
    return <XCircle className="h-3.5 w-3.5 shrink-0 text-red-600/90 dark:text-red-400/90" aria-hidden />
  }
  return <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-600/90 dark:text-amber-400/90" aria-hidden />
}

export type TopFailingRoutesWidgetProps = {
  rows: RouteHealthRow[]
  streamNameById: Map<number, string>
  loading: boolean
}

export function TopFailingRoutesWidget({ rows, streamNameById, loading }: TopFailingRoutesWidgetProps) {
  const display = rows.slice(0, 5)

  return (
    <div className={cn('space-y-1.5', loading && 'opacity-80')} aria-busy={loading}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-gdc-muted">
          Top failing routes
        </h3>
        <div className="flex flex-wrap items-center gap-2">
          <Link to="/routes" className="text-[11px] font-semibold text-violet-700 hover:underline dark:text-violet-300">
            View routes
          </Link>
          <span className="text-[10px] text-slate-400 dark:text-gdc-muted">by health score</span>
        </div>
      </div>
      <TableContainer className="rounded-md border border-slate-200/80 bg-white/60 shadow-none dark:border-gdc-divider dark:bg-gdc-section">
        <table className={opTable}>
          <thead>
            <tr className={opThRow}>
              <th className={opTh}>Route</th>
              <th className={opTh}>Stream</th>
              <th className={opTh}>Level</th>
              <th className={opTh}>Signals</th>
              <th className={`${opTh} text-right`}>Failures</th>
              <th className={`${opTh} text-right`}>Fail %</th>
            </tr>
          </thead>
          <tbody>
            {display.length === 0 ? (
              <tr className={opTr}>
                <td className={`${opTd} text-slate-500`} colSpan={6}>
                  No unhealthy routes in this window.
                </td>
              </tr>
            ) : (
              display.map((row) => {
                const failPct = Math.round((row.metrics.failure_rate ?? 0) * 1000) / 10
                const streamLabel =
                  row.stream_id != null ? streamNameById.get(row.stream_id) ?? `Stream #${row.stream_id}` : '—'
                const tags = operationalFactorTags(row.factors, 2)
                const tip = formatFactorsTooltip(row.factors)
                const runtimeHref =
                  row.stream_id != null
                    ? runtimeOverviewPath({ stream_id: row.stream_id, route_id: row.route_id })
                    : null
                return (
                  <tr key={row.route_id} className={opTr}>
                    <td className={opTd}>
                      <div className="flex min-w-0 flex-col gap-0.5">
                        <div className="flex items-center gap-1.5">
                          {routeIcon(row.metrics.failure_rate ?? 0)}
                          <Link
                            to={routeEditPath(String(row.route_id))}
                            className="truncate font-medium text-violet-700 hover:underline dark:text-violet-300"
                          >
                            Route #{row.route_id}
                          </Link>
                        </div>
                        {runtimeHref ? (
                          <Link
                            to={runtimeHref}
                            className="w-fit text-[10px] font-semibold text-slate-500 hover:text-violet-700 hover:underline dark:text-gdc-muted dark:hover:text-violet-300"
                          >
                            Open in Runtime
                          </Link>
                        ) : null}
                      </div>
                    </td>
                    <td className={`${opTd} truncate text-slate-600 dark:text-gdc-muted`}>{streamLabel}</td>
                    <td className={opTd}>
                      <StatusBadge tone={healthLevelToStatusTone(row.level)}>{row.level}</StatusBadge>
                    </td>
                    <td className={opTd}>
                      {tags.length ? (
                        <span className="line-clamp-2 text-[10px] font-medium text-slate-700 dark:text-gdc-mutedStrong" title={tip}>
                          {tags.join(' · ')}
                        </span>
                      ) : (
                        <span className="text-[10px] text-slate-400">—</span>
                      )}
                    </td>
                    <td className={`${opTd} text-right tabular-nums text-slate-800 dark:text-slate-200`}>
                      {row.metrics.failure_count}
                    </td>
                    <td className={`${opTd} text-right`}>
                      <span
                        className={
                          failPct >= 25
                            ? 'font-medium tabular-nums text-red-700/90 dark:text-red-400/90'
                            : 'font-medium tabular-nums text-amber-800/90 dark:text-amber-400/90'
                        }
                      >
                        {failPct}%
                      </span>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </TableContainer>
    </div>
  )
}
