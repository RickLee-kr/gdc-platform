import { Link } from 'react-router-dom'
import { destinationDetailPath } from '../../../config/nav-paths'
import { formatFactorsTooltip, healthLevelToStatusTone, operationalFactorTags } from '../../../lib/operational-health-present'
import { TableContainer } from '../../shell/table-container'
import { StatusBadge } from '../../shell/status-badge'
import type { DestinationHealthRow } from '../../../api/types/gdcApi'
import { opTable, opTd, opTh, opThRow, opTr } from './operational-table-styles'
import { cn } from '../../../lib/utils'

function shortTs(iso: string | null | undefined): string {
  if (iso == null || String(iso).trim() === '') return '—'
  return String(iso).slice(0, 19).replace('T', ' ')
}

export type DestinationHealthWidgetProps = {
  rows: DestinationHealthRow[]
  loading: boolean
}

export function DestinationHealthWidget({ rows, loading }: DestinationHealthWidgetProps) {
  const display = rows.slice(0, 5)

  const deliveries = (row: DestinationHealthRow) => row.metrics.success_count + row.metrics.failure_count

  const successPct = (row: DestinationHealthRow) => {
    const s = row.metrics.success_count + row.metrics.failure_count
    if (s <= 0) return 0
    return Math.round((row.metrics.success_count / s) * 1000) / 10
  }

  const retryPercentOf = (row: DestinationHealthRow) => Math.round((row.metrics.retry_rate ?? 0) * 1000) / 10

  return (
    <div className={cn('space-y-1.5', loading && 'opacity-80')} aria-busy={loading}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-gdc-muted">
          Destination health
        </h3>
        <Link
          to="/destinations"
          className="text-[11px] font-semibold text-violet-700 hover:underline dark:text-violet-300"
        >
          View destinations
        </Link>
      </div>
      <TableContainer className="rounded-md border border-slate-200/80 bg-white/60 shadow-none dark:border-gdc-divider dark:bg-gdc-section">
        <table className={opTable}>
          <thead>
            <tr className={opThRow}>
              <th className={opTh}>Destination</th>
              <th className={`${opTh} text-right`}>Deliveries</th>
              <th className={`${opTh} text-right`}>Success %</th>
              <th className={`${opTh} text-right`}>Retry %</th>
              <th className={`${opTh} text-right`}>p95 ms</th>
              <th className={opTh}>Last fail</th>
              <th className={opTh}>Health</th>
              <th className={opTh}>Signals</th>
            </tr>
          </thead>
          <tbody>
            {display.length === 0 ? (
              <tr className={opTr}>
                <td className={`${opTd} text-slate-500`} colSpan={8}>
                  No destination issues in this window.
                </td>
              </tr>
            ) : (
              display.map((row) => {
                const tags = operationalFactorTags(row.factors, 2)
                const tip = formatFactorsTooltip(row.factors)
                const p95 = row.metrics.latency_ms_p95
                const retryPct = retryPercentOf(row)
                return (
                  <tr key={row.destination_id} className={opTr}>
                    <td className={opTd}>
                      <Link
                        to={destinationDetailPath(String(row.destination_id))}
                        className="truncate font-medium text-violet-700 hover:underline dark:text-violet-300"
                      >
                        {row.destination_name?.trim() || `Destination #${row.destination_id}`}
                      </Link>
                    </td>
                    <td className={`${opTd} text-right tabular-nums text-slate-800 dark:text-slate-200`}>
                      {deliveries(row)}
                    </td>
                    <td className={`${opTd} text-right tabular-nums text-slate-800 dark:text-slate-200`}>
                      {successPct(row)}%
                    </td>
                    <td
                      className={cn(
                        `${opTd} text-right tabular-nums`,
                        retryPct >= 15 ? 'font-semibold text-amber-800 dark:text-amber-400' : 'text-slate-800 dark:text-slate-200',
                      )}
                    >
                      {retryPct}%
                    </td>
                    <td className={`${opTd} text-right tabular-nums text-slate-800 dark:text-slate-200`}>
                      {p95 != null && Number.isFinite(p95) ? `${Math.round(p95)}` : '—'}
                    </td>
                    <td className={`${opTd} whitespace-nowrap font-mono text-[10px] text-slate-600 dark:text-gdc-muted`}>
                      {shortTs(row.metrics.last_failure_at)}
                    </td>
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
