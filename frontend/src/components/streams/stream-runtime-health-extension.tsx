import { Activity, ExternalLink, LineChart as LineChartIcon, ListTree } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  fetchRouteFailuresAnalytics,
  fetchRetriesSummary,
  fetchStreamRetriesAnalytics,
  type AnalyticsWindowToken,
} from '../../api/gdcRuntimeAnalytics'
import { fetchRouteHealthList, fetchStreamHealthDetail } from '../../api/gdcRuntimeHealth'
import type { RouteFailuresAnalyticsResponse, RouteHealthRow, StreamHealthDetailResponse } from '../../api/types/gdcApi'
import { logsExplorerPath, NAV_PATH, runtimeAnalyticsPath, routeEditPath } from '../../config/nav-paths'
import { cn } from '../../lib/utils'
import { opTable, opTd, opTh, opThRow, opTr } from '../dashboard/widgets/operational-table-styles'
import { HealthBadge } from '../runtime/operational-health/health-badge'
import { HealthScoreCard } from '../runtime/operational-health/health-score-card'
import { HealthTrendMiniChart } from '../runtime/operational-health/health-trend-mini-chart'
import { RetryPressureIndicator } from '../runtime/operational-health/retry-pressure-indicator'

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

export function StreamRuntimeHealthExtension({ backendStreamId }: { backendStreamId: number | undefined }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [healthDetail, setHealthDetail] = useState<StreamHealthDetailResponse | null>(null)
  const [routeRows, setRouteRows] = useState<RouteHealthRow[]>([])
  const [failures, setFailures] = useState<RouteFailuresAnalyticsResponse | null>(null)
  const [retrySummary, setRetrySummary] = useState<Awaited<ReturnType<typeof fetchRetriesSummary>>>(null)
  const [retryRank, setRetryRank] = useState<Awaited<ReturnType<typeof fetchStreamRetriesAnalytics>>>(null)

  useEffect(() => {
    if (backendStreamId == null) {
      setHealthDetail(null)
      setRouteRows([])
      setFailures(null)
      setRetrySummary(null)
      setRetryRank(null)
      setError(null)
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    ;(async () => {
      try {
        const [h, routes, f, rs, rr] = await Promise.all([
          fetchStreamHealthDetail(backendStreamId, { window: DEFAULT_WINDOW }),
          fetchRouteHealthList({ stream_id: backendStreamId, window: DEFAULT_WINDOW }),
          fetchRouteFailuresAnalytics({ stream_id: backendStreamId, window: DEFAULT_WINDOW }),
          fetchRetriesSummary({ stream_id: backendStreamId, window: DEFAULT_WINDOW }),
          fetchStreamRetriesAnalytics({ stream_id: backendStreamId, window: DEFAULT_WINDOW, limit: 20 }),
        ])
        if (cancelled) return
        setHealthDetail(h)
        setRouteRows(routes?.rows ?? [])
        setFailures(f)
        setRetrySummary(rs)
        setRetryRank(rr)
        if (h == null && routes == null && f == null) {
          setError('Health and analytics APIs unavailable for this stream.')
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
  }, [backendStreamId])

  const topFailingRoutes = useMemo(() => {
    const rows = [...routeRows]
    rows.sort((a, b) => a.score - b.score)
    return rows.slice(0, 6)
  }, [routeRows])

  const failureTrendValues = useMemo(
    () => (failures?.failure_trend ?? []).map((b) => b.failure_count),
    [failures],
  )

  const streamRetryRow = useMemo(
    () => (retryRank?.retry_heavy_streams ?? []).find((r) => r.stream_id === backendStreamId),
    [retryRank, backendStreamId],
  )

  const rl = useMemo(() => rateLimitHits(failures?.top_failed_stages), [failures])

  const analyticsHref = useMemo(
    () => runtimeAnalyticsPath({ window: DEFAULT_WINDOW, stream_id: backendStreamId }),
    [backendStreamId],
  )
  const logsHref = useMemo(
    () => (backendStreamId != null ? logsExplorerPath({ stream_id: backendStreamId }) : logsExplorerPath()),
    [backendStreamId],
  )

  if (backendStreamId == null) {
    return (
      <section
        aria-label="Stream operational health"
        className="rounded-xl border border-slate-200/80 bg-slate-50/50 p-3 text-[12px] text-slate-600 dark:border-gdc-border dark:bg-gdc-card dark:text-gdc-muted"
        data-testid="stream-health-summary-unavailable"
      >
        Operational health requires a numeric stream id.
      </section>
    )
  }

  return (
    <section
      aria-label="Stream operational health"
      className="space-y-3 rounded-xl border border-slate-200/80 bg-slate-50/50 p-3 shadow-sm dark:border-gdc-border dark:bg-gdc-card"
      data-testid="stream-runtime-health-extension"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-violet-600 dark:text-violet-400" aria-hidden />
          <h3 className="text-[13px] font-semibold text-slate-900 dark:text-slate-100">Stream health summary</h3>
          <span className="rounded-md border border-slate-200/90 bg-white px-2 py-0.5 text-[10px] font-medium text-slate-600 dark:border-gdc-border dark:bg-gdc-card dark:text-gdc-mutedStrong">
            {DEFAULT_WINDOW} window
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold">
          <Link
            to={analyticsHref}
            className="inline-flex items-center gap-1 rounded-md border border-slate-200/90 bg-white px-2 py-1 text-violet-800 hover:bg-slate-50 dark:border-gdc-border dark:bg-gdc-card dark:text-violet-200 dark:hover:bg-gdc-rowHover"
          >
            <LineChartIcon className="h-3.5 w-3.5" aria-hidden />
            Analytics
          </Link>
          <Link
            to={logsHref}
            className="inline-flex items-center gap-1 rounded-md border border-slate-200/90 bg-white px-2 py-1 text-violet-800 hover:bg-slate-50 dark:border-gdc-border dark:bg-gdc-card dark:text-violet-200 dark:hover:bg-gdc-rowHover"
          >
            Runtime logs
            <ExternalLink className="h-3 w-3" aria-hidden />
          </Link>
          <Link to={NAV_PATH.runtime} className="text-violet-700 hover:underline dark:text-violet-300">
            Runtime overview
          </Link>
        </div>
      </div>

      {error ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-[12px] text-amber-950 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-100">
          {error}
        </div>
      ) : null}

      {loading && !healthDetail?.score ? (
        <div className="grid gap-2 md:grid-cols-2" data-testid="stream-health-loading">
          <div className="h-28 animate-pulse rounded-xl bg-slate-200/80 dark:bg-gdc-elevated" />
          <div className="h-28 animate-pulse rounded-xl bg-slate-200/80 dark:bg-gdc-elevated" />
        </div>
      ) : null}

      {!loading && healthDetail == null ? (
        <p className="text-[12px] text-slate-600 dark:text-gdc-muted" data-testid="stream-health-empty">
          No health score available yet (no committed delivery outcomes in this window).
        </p>
      ) : healthDetail?.score ? (
        <HealthScoreCard score={healthDetail.score} dense />
      ) : null}

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-200/80 bg-white p-3 shadow-sm dark:border-gdc-border dark:bg-gdc-card">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h4 className="text-[12px] font-semibold text-slate-900 dark:text-slate-100">Top failing routes (score)</h4>
            <ListTree className="h-3.5 w-3.5 text-slate-400" aria-hidden />
          </div>
          <div className="overflow-x-auto">
            <table className={opTable}>
              <thead>
                <tr className={opThRow}>
                  <th className={opTh} scope="col">
                    Route
                  </th>
                  <th className={opTh} scope="col">
                    Health
                  </th>
                  <th className={cn(opTh, 'text-right')} scope="col">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {topFailingRoutes.length === 0 ? (
                  <tr className={opTr}>
                    <td className={opTd} colSpan={3}>
                      No route health rows for this stream in this window.
                    </td>
                  </tr>
                ) : (
                  topFailingRoutes.map((r) => (
                    <tr key={r.route_id} className={opTr}>
                      <td className={cn(opTd, 'font-mono text-[11px]')}>
                        #{r.route_id}
                        {r.destination_id != null ? (
                          <span className="ml-1 text-slate-500 dark:text-gdc-muted">→ dest {r.destination_id}</span>
                        ) : null}
                      </td>
                      <td className={opTd}>
                        <HealthBadge level={r.level} score={r.score} factors={r.factors} compact />
                      </td>
                      <td className={cn(opTd, 'text-right')}>
                        <Link
                          to={routeEditPath(String(r.route_id))}
                          className="text-[11px] font-semibold text-violet-700 hover:underline dark:text-violet-300"
                        >
                          Route
                        </Link>
                        <span className="text-slate-300 dark:text-gdc-muted"> · </span>
                        <Link
                          to={logsExplorerPath({ stream_id: backendStreamId, route_id: r.route_id })}
                          className="text-[11px] font-semibold text-violet-700 hover:underline dark:text-violet-300"
                        >
                          Logs
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
          <h4 className="mb-2 text-[12px] font-semibold text-slate-900 dark:text-slate-100">Retry pressure · failure trend</h4>
          <div className="flex flex-wrap items-start gap-4">
            <div className="min-w-0 flex-1">
              <RetryPressureIndicator
                retryEventCount={
                  streamRetryRow?.retry_event_count ??
                  retrySummary?.total_retry_outcome_events ??
                  healthDetail?.score?.metrics?.retry_event_count
                }
                retryRate={healthDetail?.score?.metrics?.retry_rate}
                label="Retry pressure"
              />
              {retrySummary != null ? (
                <p className="mt-1 text-[10px] text-slate-600 dark:text-gdc-muted">
                  Retry outcomes: {retrySummary.retry_success_events} ok · {retrySummary.retry_failed_events} failed ·{' '}
                  {retrySummary.total_retry_outcome_events} total
                </p>
              ) : null}
              <p className="mt-2 text-[10px] text-slate-500 dark:text-gdc-muted">
                Rate limits (stages): source {rl.src} · destination {rl.dest}
              </p>
            </div>
            <div>
              <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500 dark:text-gdc-muted">Failure trend</p>
              <HealthTrendMiniChart values={failureTrendValues} />
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
