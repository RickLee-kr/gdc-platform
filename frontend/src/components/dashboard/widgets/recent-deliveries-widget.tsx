import { Link } from 'react-router-dom'
import { logsExplorerPath } from '../../../config/nav-paths'
import { StatusBadge } from '../../shell/status-badge'
import { TableContainer } from '../../shell/table-container'
import type { RuntimeLogsPageItem } from '../../../api/types/gdcApi'
import { opTable, opTd, opTh, opThRow, opTr } from './operational-table-styles'
import { cn } from '../../../lib/utils'

function fmtUtcTime(iso: string): string {
  try {
    const d = new Date(iso)
    return `${d.toISOString().slice(11, 19)} UTC`
  } catch {
    return iso
  }
}

function isDeliveryStage(stage: string): boolean {
  return (
    stage.startsWith('route_') ||
    stage === 'destination_rate_limited' ||
    stage === 'source_rate_limited'
  )
}

function outcomeTone(stage: string): 'success' | 'error' | 'warning' | 'neutral' | 'info' {
  const s = stage.toLowerCase()
  if (s.includes('rate')) return 'warning'
  if (s.includes('failed') || s.includes('unknown_failure')) return 'error'
  if (s.includes('retry')) return 'neutral'
  return 'success'
}

function outcomeLabel(stage: string): string {
  const s = stage.toLowerCase()
  if (s.includes('rate')) return 'Rate limited'
  if (s.includes('failed') || s.includes('unknown_failure')) return 'Failed'
  if (s.includes('retry')) return 'Retry'
  if (s.includes('success')) return 'Success'
  return stage
}

export type RecentDeliveriesWidgetProps = {
  items: RuntimeLogsPageItem[]
  streamNameById: Map<number, string>
  destinationNameById: Map<number, string>
  loading: boolean
}

export function RecentDeliveriesWidget({
  items,
  streamNameById,
  destinationNameById,
  loading,
}: RecentDeliveriesWidgetProps) {
  const rows = items.filter((r) => r.stream_id != null && isDeliveryStage(r.stage)).slice(0, 12)

  return (
    <div className={cn('space-y-1.5', loading && 'opacity-80')} aria-busy={loading}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-gdc-muted">
          Recent deliveries
        </h3>
        <Link to="/logs" className="text-[11px] font-semibold text-violet-700 hover:underline dark:text-violet-300">
          View logs
        </Link>
      </div>
      <TableContainer className="rounded-md border border-slate-200/80 bg-white/60 shadow-none dark:border-gdc-divider dark:bg-gdc-section">
        <table className={opTable}>
          <thead>
            <tr className={opThRow}>
              <th className={opTh}>Time</th>
              <th className={opTh}>Stream</th>
              <th className={opTh}>Destination</th>
              <th className={opTh}>Status</th>
              <th className={`${opTh} text-right`}>Latency</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr className={opTr}>
                <td className={`${opTd} text-slate-500`} colSpan={5}>
                  No recent delivery rows in this window.
                </td>
              </tr>
            ) : (
              rows.map((row) => {
                const streamId = row.stream_id as number
                const destId = row.destination_id
                const streamLabel = streamNameById.get(streamId) ?? `Stream #${streamId}`
                const destLabel =
                  destId != null ? destinationNameById.get(destId) ?? `Dest #${destId}` : '—'
                const tone = outcomeTone(row.stage)
                const label = outcomeLabel(row.stage)
                return (
                  <tr key={row.id} className={opTr}>
                    <td className={`${opTd} whitespace-nowrap tabular-nums text-slate-500 dark:text-gdc-muted`}>
                      {fmtUtcTime(row.created_at)}
                    </td>
                    <td className={opTd}>
                      <Link
                        to={logsExplorerPath({ stream_id: streamId })}
                        className="font-medium text-violet-700 hover:underline dark:text-violet-300"
                      >
                        {streamLabel}
                      </Link>
                    </td>
                    <td className={`${opTd} truncate text-slate-600 dark:text-gdc-muted`}>{destLabel}</td>
                    <td className={opTd}>
                      <StatusBadge tone={tone}>{label}</StatusBadge>
                    </td>
                    <td className={`${opTd} text-right tabular-nums text-slate-500 dark:text-gdc-muted`}>
                      {row.latency_ms != null ? `${row.latency_ms} ms` : '—'}
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
