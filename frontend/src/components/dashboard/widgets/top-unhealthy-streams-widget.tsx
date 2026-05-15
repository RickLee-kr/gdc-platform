import { Link } from 'react-router-dom'
import { streamRuntimePath } from '../../../config/nav-paths'
import { formatFactorsTooltip, healthLevelToStatusTone, operationalFactorTags } from '../../../lib/operational-health-present'
import { TableContainer } from '../../shell/table-container'
import { StatusBadge } from '../../shell/status-badge'
import type { StreamHealthRow } from '../../../api/types/gdcApi'
import { opTable, opTd, opTh, opThRow, opTr } from './operational-table-styles'
import { cn } from '../../../lib/utils'

export type TopUnhealthyStreamsWidgetProps = {
  rows: StreamHealthRow[]
  loading: boolean
}

export function TopUnhealthyStreamsWidget({ rows, loading }: TopUnhealthyStreamsWidgetProps) {
  const display = rows.slice(0, 5)

  const successPct = (row: StreamHealthRow) => {
    const s = row.metrics.success_count + row.metrics.failure_count
    if (s <= 0) return 0
    return Math.round((row.metrics.success_count / s) * 1000) / 10
  }

  return (
    <div className={cn('space-y-1.5', loading && 'opacity-80')} aria-busy={loading}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-gdc-muted">
          Top unhealthy streams
        </h3>
        <Link to="/streams" className="text-[11px] font-semibold text-violet-700 hover:underline dark:text-violet-300">
          View streams
        </Link>
      </div>
      <TableContainer className="rounded-md border border-slate-200/80 bg-white/60 shadow-none dark:border-gdc-divider dark:bg-gdc-section">
        <table className={opTable}>
          <thead>
            <tr className={opThRow}>
              <th className={opTh}>Stream</th>
              <th className={`${opTh} text-right`}>Score</th>
              <th className={`${opTh} text-right`}>Success %</th>
              <th className={opTh}>Signals</th>
              <th className={opTh}>Health</th>
            </tr>
          </thead>
          <tbody>
            {display.length === 0 ? (
              <tr className={opTr}>
                <td className={`${opTd} text-slate-500`} colSpan={5}>
                  No degraded streams in this window.
                </td>
              </tr>
            ) : (
              display.map((row) => {
                const tags = operationalFactorTags(row.factors, 2)
                const tip = formatFactorsTooltip(row.factors)
                return (
                  <tr key={row.stream_id} className={opTr}>
                    <td className={opTd}>
                      <Link
                        to={streamRuntimePath(String(row.stream_id))}
                        className="font-medium text-violet-700 hover:underline dark:text-violet-300"
                      >
                        {row.stream_name?.trim() || `Stream #${row.stream_id}`}
                      </Link>
                    </td>
                    <td className={`${opTd} text-right tabular-nums font-medium text-slate-800 dark:text-slate-200`}>
                      {Math.round(row.score)}
                    </td>
                    <td className={`${opTd} text-right tabular-nums text-slate-800 dark:text-slate-200`}>
                      {successPct(row)}%
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
                    <td className={opTd}>
                      <StatusBadge tone={healthLevelToStatusTone(row.level)}>{row.level}</StatusBadge>
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
