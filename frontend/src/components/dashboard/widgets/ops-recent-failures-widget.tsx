import { Link } from 'react-router-dom'
import { useMemo } from 'react'
import { logsExplorerPath, runtimeOverviewPath } from '../../../config/nav-paths'
import { cn } from '../../../lib/utils'
import { RuntimeChartCard } from '../../shell/runtime-chart-card'
import { opTable, opTd, opTh, opThRow, opTr } from './operational-table-styles'
import type { RecentProblemRouteItem } from '../../../api/types/gdcApi'

export type OpsRecentFailuresWidgetProps = {
  rows: RecentProblemRouteItem[]
  streamNameById: Map<number, string>
  loading: boolean
}

function shortTs(iso: string): string {
  return String(iso).slice(0, 19).replace('T', ' ')
}

export function OpsRecentFailuresWidget({
  rows,
  streamNameById,
  loading,
}: OpsRecentFailuresWidgetProps) {
  const display = rows.slice(0, 8)
  const distinctCodes = useMemo(() => {
    const s = new Set<string>()
    for (const r of rows) {
      const c = (r.error_code ?? '').trim()
      if (c) s.add(c)
    }
    return s.size
  }, [rows])

  return (
    <RuntimeChartCard
      title="Recent destination failures"
      subtitle="Latest committed route_send_failed / related failure rows from delivery_logs (same window as dashboard summary). Grouped view: use Logs with stage filters for deeper correlation."
      actions={
        <Link
          to={runtimeOverviewPath()}
          className="text-[11px] font-semibold text-violet-700 hover:underline dark:text-violet-300"
        >
          Runtime
        </Link>
      }
    >
      <div className={cn('space-y-2', loading && 'opacity-80')} aria-busy={loading}>
        {display.length === 0 ? (
          <p className="text-[12px] text-slate-500 dark:text-gdc-muted">No recent failure rows in this window.</p>
        ) : (
          <div className="max-h-[260px] overflow-auto rounded-md border border-slate-200/80 dark:border-gdc-divider">
            <table className={opTable}>
              <thead>
                <tr className={opThRow}>
                  <th className={opTh}>When (UTC)</th>
                  <th className={opTh}>Stream</th>
                  <th className={opTh}>Route</th>
                  <th className={opTh}>Stage</th>
                  <th className={opTh}>Summary</th>
                </tr>
              </thead>
              <tbody>
                {display.map((row, i) => (
                  <tr key={`${row.route_id}-${row.created_at}-${i}`} className={opTr}>
                    <td className={opTd}>
                      <Link
                        to={logsExplorerPath({
                          stream_id: row.stream_id,
                          route_id: row.route_id,
                          destination_id: row.destination_id ?? undefined,
                        })}
                        className="text-violet-700 hover:underline dark:text-violet-300"
                      >
                        {shortTs(row.created_at)}
                      </Link>
                    </td>
                    <td className={opTd}>
                      <span className="truncate" title={streamNameById.get(row.stream_id) ?? undefined}>
                        {streamNameById.get(row.stream_id) ?? `#${row.stream_id}`}
                      </span>
                    </td>
                    <td className={cn(opTd, 'font-mono text-[10px] tabular-nums')}>
                      <Link
                        to={logsExplorerPath({
                          stream_id: row.stream_id,
                          route_id: row.route_id,
                          destination_id: row.destination_id ?? undefined,
                        })}
                        className="text-violet-700 hover:underline dark:text-violet-300"
                      >
                        #{row.route_id}
                      </Link>
                    </td>
                    <td className={cn(opTd, 'font-mono text-[10px]')}>{row.stage}</td>
                    <td className={opTd}>
                      <span className="line-clamp-2 text-[11px]" title={row.message}>
                        {row.error_code ? (
                          <span className="font-mono text-slate-500 dark:text-gdc-muted">{row.error_code}: </span>
                        ) : null}
                        {row.message}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {rows.length > 0 ? (
          <p className="text-[10px] text-slate-500 dark:text-gdc-muted">
            Distinct <span className="font-semibold">error_code</span> values in dashboard failure snapshot:{' '}
            <span className="tabular-nums font-semibold text-slate-700 dark:text-slate-200">{distinctCodes}</span>
          </p>
        ) : null}
      </div>
    </RuntimeChartCard>
  )
}
