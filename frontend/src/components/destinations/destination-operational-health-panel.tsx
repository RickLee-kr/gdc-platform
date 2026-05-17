import { Activity, ExternalLink, LineChart as LineChartIcon } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { fetchRouteFailuresAnalytics, fetchRetriesSummary, type AnalyticsWindowToken } from '../../api/gdcRuntimeAnalytics'
import { fetchDestinationHealthList, fetchRouteHealthList } from '../../api/gdcRuntimeHealth'
import type { DestinationHealthRow, HealthScore, RouteFailuresAnalyticsResponse, RouteHealthRow } from '../../api/types/gdcApi'
import { logsExplorerPath, runtimeAnalyticsPath, routeEditPath } from '../../config/nav-paths'
import { cn } from '../../lib/utils'
import { opTable, opTd, opTh, opThRow, opTr } from '../dashboard/widgets/operational-table-styles'
import { FailureRateIndicator } from '../runtime/operational-health/failure-rate-indicator'
import { HealthBadge } from '../runtime/operational-health/health-badge'
import { HealthScoreCard } from '../runtime/operational-health/health-score-card'
import { HealthTrendMiniChart } from '../runtime/operational-health/health-trend-mini-chart'

const DEFAULT_WINDOW: AnalyticsWindowToken = '24h'

function rateLimitHits(stages: { stage: string; count: number }[] | undefined): { src: number; dest: number } {
  let src = 0
  let dest = 0
  for (const row of stages ?? []) {
    const s = String(row.stage ?? '').toLowerCase()
    if (s.includes('source_rate')) src += row.count
    if (s.includes('destination_rate')) dest += row.count
  }
  return { src, dest }
}

export function DestinationOperationalHealthPanel({ destinationId }: { destinationId: number }) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [destRow, setDestRow] = useState<DestinationHealthRow | null>(null)
  const [routeRows, setRouteRows] = useState<RouteHealthRow[]>([])
  const [failures, setFailures] = useState<RouteFailuresAnalyticsResponse | null>(null)
  const [retries, setRetries] = useState<Awaited<ReturnType<typeof fetchRetriesSummary>>>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    ;(async () => {
      try {
        const [dList, routes, f, r] = await Promise.all([
          fetchDestinationHealthList({ destination_id: destinationId, window: DEFAULT_WINDOW }),
          fetchRouteHealthList({ destination_id: destinationId, window: DEFAULT_WINDOW }),
          fetchRouteFailuresAnalytics({ destination_id: destinationId, window: DEFAULT_WINDOW }),
          fetchRetriesSummary({ destination_id: destinationId, window: DEFAULT_WINDOW }),
        ])
        if (cancelled) return
        const row = (dList?.rows ?? []).find((x) => x.destination_id === destinationId) ?? dList?.rows?.[0] ?? null
        setDestRow(row)
        setRouteRows(routes?.rows ?? [])
        setFailures(f)
        setRetries(r)
        if (dList == null && routes == null && f == null) {
          setError('Health and analytics APIs unavailable for this destination.')
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [destinationId])

  const failureTrendValues = useMemo(() => (failures?.failure_trend ?? []).map((b) => b.failure_count), [failures])
  const rl = useMemo(() => rateLimitHits(failures?.top_failed_stages), [failures])
  const logsHref = useMemo(() => logsExplorerPath({ destination_id: destinationId }), [destinationId])
  const analyticsHref = useMemo(() => runtimeAnalyticsPath({ window: DEFAULT_WINDOW, destination_id: destinationId }), [destinationId])

  const syntheticScore = useMemo((): HealthScore | null => {
    if (destRow == null) return null
    return {
      score: destRow.score,
      level: destRow.level,
      factors: destRow.factors,
      metrics: destRow.metrics,
      scoring_mode: 'current_runtime',
    }
  }, [destRow])

  return (
    <section
      aria-label="Destination operational health"
      className="space-y-3 rounded-xl border border-violet-200/50 bg-violet-500/[0.04] p-3 shadow-sm dark:border-violet-900/40 dark:bg-violet-950/20"
      data-testid="destination-operational-health-panel"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-violet-600 dark:text-violet-400" aria-hidden />
          <h3 className="text-[13px] font-semibold text-slate-900 dark:text-slate-100">Destination health summary</h3>
          <span className="rounded-md border border-slate-200/90 bg-white px-2 py-0.5 text-[10px] font-medium text-slate-600 dark:border-gdc-border dark:bg-gdc-card dark:text-gdc-mutedStrong">
            {DEFAULT_WINDOW}
          </span>
        </div>
        <div className="flex flex-wrap gap-2 text-[11px] font-semibold">
          <Link
            to={logsHref}
            className="inline-flex items-center gap-1 rounded-md border border-slate-200/90 bg-white px-2 py-1 text-violet-800 hover:bg-slate-50 dark:border-gdc-border dark:bg-gdc-card dark:text-violet-200 dark:hover:bg-gdc-rowHover"
          >
            Logs
            <ExternalLink className="h-3 w-3" aria-hidden />
          </Link>
          <Link
            to={analyticsHref}
            className="inline-flex items-center gap-1 rounded-md border border-slate-200/90 bg-white px-2 py-1 text-violet-800 hover:bg-slate-50 dark:border-gdc-border dark:bg-gdc-card dark:text-violet-200 dark:hover:bg-gdc-rowHover"
          >
            <LineChartIcon className="h-3.5 w-3.5" aria-hidden />
            Analytics
          </Link>
        </div>
      </div>

      {error ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-[12px] text-amber-950 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-100">
          {error}
        </div>
      ) : null}

      {loading && !syntheticScore ? (
        <div className="h-28 animate-pulse rounded-xl bg-slate-200/80 dark:bg-gdc-elevated" data-testid="destination-health-loading" />
      ) : null}

      {!loading && syntheticScore == null ? (
        <p className="text-[12px] text-slate-600 dark:text-gdc-muted" data-testid="destination-health-empty">
          No destination health row in this window (no committed deliveries for this destination).
        </p>
      ) : syntheticScore ? (
        <HealthScoreCard score={syntheticScore} dense />
      ) : null}

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-200/80 bg-white p-3 shadow-sm dark:border-gdc-border dark:bg-gdc-card">
          <h4 className="text-[12px] font-semibold text-slate-900 dark:text-slate-100">Routes using this destination</h4>
          <div className="mt-2 overflow-x-auto">
            <table className={opTable}>
              <thead>
                <tr className={opThRow}>
                  <th className={opTh} scope="col">
                    Route
                  </th>
                  <th className={opTh} scope="col">
                    Stream
                  </th>
                  <th className={opTh} scope="col">
                    Health
                  </th>
                  <th className={cn(opTh, 'text-right')} scope="col">
                    Logs
                  </th>
                </tr>
              </thead>
              <tbody>
                {routeRows.length === 0 ? (
                  <tr className={opTr}>
                    <td className={opTd} colSpan={4}>
                      No route health rows for this destination in this window.
                    </td>
                  </tr>
                ) : (
                  routeRows.slice(0, 12).map((r) => (
                    <tr key={r.route_id} className={opTr}>
                      <td className={cn(opTd, 'font-mono text-[11px]')}>#{r.route_id}</td>
                      <td className={opTd}>{r.stream_id ?? '—'}</td>
                      <td className={opTd}>
                        <HealthBadge level={r.level} score={r.score} factors={r.factors} compact />
                      </td>
                      <td className={cn(opTd, 'text-right')}>
                        <Link
                          to={logsExplorerPath({ destination_id: destinationId, route_id: r.route_id, stream_id: r.stream_id ?? undefined })}
                          className="text-[11px] font-semibold text-violet-700 hover:underline dark:text-violet-300"
                        >
                          Logs
                        </Link>
                        <span className="text-slate-300 dark:text-gdc-muted"> · </span>
                        <Link to={routeEditPath(String(r.route_id))} className="text-[11px] font-semibold text-violet-700 hover:underline dark:text-violet-300">
                          Route
                        </Link>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200/80 bg-white p-3 shadow-sm dark:border-gdc-border dark:bg-gdc-card">
          <h4 className="text-[12px] font-semibold text-slate-900 dark:text-slate-100">Success / failure · latency · rate limits</h4>
          <div className="mt-2 flex flex-wrap gap-4">
            <FailureRateIndicator
              rate={
                failures?.totals && failures.totals.failure_events + failures.totals.success_events > 0
                  ? failures.totals.failure_events / (failures.totals.failure_events + failures.totals.success_events)
                  : destRow?.metrics.failure_rate
              }
              label="Failure ratio (outcomes)"
            />
            <div>
              <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500">Latency p95 / avg</p>
              <p className="mt-0.5 text-[12px] font-semibold tabular-nums text-slate-900 dark:text-slate-50">
                {failures?.latency_ms_p95 != null ? `${Math.round(failures.latency_ms_p95)} ms` : syntheticScore?.metrics.latency_ms_p95 != null ? `${Math.round(syntheticScore.metrics.latency_ms_p95!)} ms` : '—'}
                <span className="font-normal text-slate-500"> · </span>
                <span className="font-normal">
                  {failures?.latency_ms_avg != null ? `${Math.round(failures.latency_ms_avg)} ms` : syntheticScore?.metrics.latency_ms_avg != null ? `${Math.round(syntheticScore.metrics.latency_ms_avg!)} ms` : '—'}
                </span>
              </p>
            </div>
          </div>
          <p className="mt-2 text-[10px] text-slate-600 dark:text-gdc-muted">
            Rate limits (stages): source {rl.src} · destination {rl.dest}
          </p>
          {retries != null ? (
            <p className="mt-1 text-[10px] text-slate-600 dark:text-gdc-muted">
              Retry outcomes (scoped): {retries.retry_success_events} ok · {retries.retry_failed_events} failed · {retries.total_retry_outcome_events}{' '}
              total
            </p>
          ) : null}
          <div className="mt-2">
            <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500">Failure trend</p>
            <HealthTrendMiniChart values={failureTrendValues} strokeClassName="text-orange-600 dark:text-orange-400" />
          </div>
        </div>
      </div>
    </section>
  )
}
