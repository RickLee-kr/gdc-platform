import { Link } from 'react-router-dom'
import { runtimeAnalyticsPath } from '../../../config/nav-paths'
import { cn } from '../../../lib/utils'
import { RuntimeChartCard } from '../../shell/runtime-chart-card'
import type { HealthOverviewResponse, RouteHealthRow, StreamHealthRow } from '../../../api/types/gdcApi'

type LatencyRow =
  | { kind: 'stream'; row: StreamHealthRow }
  | { kind: 'route'; row: RouteHealthRow }

export type OpsLatencyWidgetProps = {
  health: HealthOverviewResponse | null
  loading: boolean
}

function collectLatencyRows(health: HealthOverviewResponse | null): LatencyRow[] {
  if (!health) return []
  const out: LatencyRow[] = []
  for (const row of health.worst_streams) {
    if (row.metrics.latency_ms_p95 != null && row.metrics.latency_ms_p95 > 0) {
      out.push({ kind: 'stream', row })
    }
  }
  for (const row of health.worst_routes) {
    if (row.metrics.latency_ms_p95 != null && row.metrics.latency_ms_p95 > 0) {
      out.push({ kind: 'route', row })
    }
  }
  out.sort((a, b) => {
    const pa = a.row.metrics.latency_ms_p95 ?? 0
    const pb = b.row.metrics.latency_ms_p95 ?? 0
    return pb - pa
  })
  return out.slice(0, 6)
}

export function OpsLatencyWidget({ health, loading }: OpsLatencyWidgetProps) {
  const ranked = collectLatencyRows(health)
  const top = ranked[0]

  return (
    <RuntimeChartCard
      title="Delivery latency"
      subtitle="Highest observed p95 send latency in this window (from health metrics when delivery timings exist)."
      actions={
        <Link
          to={runtimeAnalyticsPath({ window: health?.time.window })}
          className="text-[11px] font-semibold text-violet-700 hover:underline dark:text-violet-300"
        >
          Analytics
        </Link>
      }
    >
      <div className={cn('space-y-2', loading && 'opacity-80')} aria-busy={loading}>
        {!health && !loading ? (
          <p className="text-[12px] text-slate-500 dark:text-gdc-muted">Health data unavailable.</p>
        ) : null}
        {ranked.length === 0 && health && !loading ? (
          <p className="text-[12px] text-slate-500 dark:text-gdc-muted">
            No p95 latency samples in this window (timings may be absent for your destination types).
          </p>
        ) : null}
        {top ? (
          <div className="rounded-md border border-slate-200/80 bg-slate-50/80 px-3 py-2 dark:border-gdc-divider dark:bg-gdc-elevated">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-gdc-muted">Worst p95</p>
            <p className="font-mono text-xl font-semibold tabular-nums text-slate-900 dark:text-slate-50">
              {top.row.metrics.latency_ms_p95 != null ? `${Math.round(top.row.metrics.latency_ms_p95)} ms` : '—'}
            </p>
            <p className="mt-1 truncate text-[11px] text-slate-600 dark:text-gdc-muted">
              {top.kind === 'stream' ? (
                <>
                  Stream{' '}
                  <span className="font-medium text-slate-800 dark:text-slate-100">
                    {top.row.stream_name ?? `#${top.row.stream_id}`}
                  </span>
                </>
              ) : (
                <>
                  Route #{top.row.route_id}
                  {top.row.stream_id != null ? (
                    <span className="text-slate-500"> · stream #{top.row.stream_id}</span>
                  ) : null}
                </>
              )}
            </p>
          </div>
        ) : null}
        {ranked.length > 1 ? (
          <ul className="space-y-1 text-[11px] text-slate-600 dark:text-gdc-muted">
            {ranked.slice(1).map((item, i) => (
              <li key={i} className="flex justify-between gap-2 tabular-nums">
                <span className="min-w-0 truncate">
                  {item.kind === 'stream'
                    ? item.row.stream_name ?? `Stream ${item.row.stream_id}`
                    : `Route ${item.row.route_id}`}
                </span>
                <span className="shrink-0 font-medium text-slate-800 dark:text-slate-100">
                  {item.row.metrics.latency_ms_p95 != null ? `${Math.round(item.row.metrics.latency_ms_p95)} ms` : '—'}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </RuntimeChartCard>
  )
}
