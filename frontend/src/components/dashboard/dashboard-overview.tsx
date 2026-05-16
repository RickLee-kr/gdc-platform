import { Activity, RefreshCw } from 'lucide-react'
import { useLayoutEffect, useMemo, useState } from 'react'
import { loadDashboardRefreshMs, persistDashboardRefreshMs } from '../../localPreferences'
import { Link } from 'react-router-dom'
import { buildKpiCards } from '../../api/dashboardKpi'
import type { MetricsWindow } from '../../api/gdcRuntime'
import { NAV_PATH } from '../../config/nav-paths'
import { cn } from '../../lib/utils'
import { useDashboardOverviewData } from './use-dashboard-overview-data'
import { ActiveAlertsWidget } from './widgets/active-alerts-widget'
import { DestinationHealthWidget } from './widgets/destination-health-widget'
import { EventsOutcomePanel } from './widgets/events-outcome-panel'
import { KpiSummaryWidget } from './widgets/kpi-summary-widget'
import { PipelineHealthStrip } from './widgets/pipeline-health-strip'
import { RecentDeliveriesWidget } from './widgets/recent-deliveries-widget'
import { RuntimeVolumeWidget } from './widgets/runtime-volume-widget'
import { TopFailingRoutesWidget } from './widgets/top-failing-routes-widget'
import { TopUnhealthyStreamsWidget } from './widgets/top-unhealthy-streams-widget'
import { OpsLatencyWidget } from './widgets/ops-latency-widget'
import { OpsRateLimitsWidget } from './widgets/ops-rate-limits-widget'
import { OpsRecentFailuresWidget } from './widgets/ops-recent-failures-widget'
import { OpsRetriesWidget } from './widgets/ops-retries-widget'
import { OpsRetentionSummaryWidget } from './widgets/ops-retention-summary-widget'
import { OpsRouteHealthSummaryWidget } from './widgets/ops-route-health-summary-widget'
import { OpsRuntimeEngineWidget } from './widgets/ops-runtime-engine-widget'
import { RuntimeOperationsIncidents } from './widgets/runtime-operations-incidents'
import { ValidationOperationalWidget } from './widgets/validation-operational-widget'

const WINDOW_OPTIONS: MetricsWindow[] = ['15m', '1h', '6h', '24h']

const REFRESH_OPTIONS: { label: string; ms: number | null }[] = [
  { label: 'Off', ms: null },
  { label: '30s', ms: 30_000 },
  { label: '1m', ms: 60_000 },
]

function windowButtonLabel(w: MetricsWindow): string {
  if (w === '15m') return '15m'
  if (w === '1h') return '1h'
  if (w === '6h') return '6h'
  if (w === '24h') return '24h'
  return w
}

export function DashboardOverview() {
  const [metricsWindow, setMetricsWindow] = useState<MetricsWindow>('1h')
  const [refreshMs, setRefreshMs] = useState<number | null>(null)
  useLayoutEffect(() => {
    setRefreshMs(loadDashboardRefreshMs())
  }, [])
  const { bundle, loading, loadError, reload } = useDashboardOverviewData(metricsWindow, refreshMs)

  const streamNameById = useMemo(() => {
    const m = new Map<number, string>()
    for (const s of bundle?.streams ?? []) {
      if (typeof s.id === 'number' && s.name) m.set(s.id, s.name)
    }
    return m
  }, [bundle?.streams])

  const destinationNameById = useMemo(() => {
    const m = new Map<number, string>()
    for (const d of bundle?.destinations ?? []) {
      m.set(d.id, d.name)
    }
    return m
  }, [bundle?.destinations])

  const kpiCards = useMemo(
    () =>
      buildKpiCards({
        dashboard: bundle?.dashboard ?? null,
        health: bundle?.health ?? null,
        retries: bundle?.retries ?? null,
        outcomeTs: bundle?.outcomeTs ?? null,
        window: metricsWindow,
      }),
    [bundle?.dashboard, bundle?.health, bundle?.retries, bundle?.outcomeTs, metricsWindow],
  )

  const running = bundle?.dashboard?.summary.running_streams ?? 0
  const outcomeBuckets = bundle?.outcomeTs?.buckets ?? []
  const health = bundle?.health
  const summary = bundle?.dashboard?.summary ?? null
  const logs = bundle?.logsPage?.items ?? []
  const alerts = bundle?.alerts?.items ?? []
  const recentFailures = bundle?.dashboard?.recent_problem_routes ?? []
  const recentRlRoutes = bundle?.dashboard?.recent_rate_limited_routes ?? []

  return (
    <div className="w-full min-w-0 space-y-5">
      <div className="flex flex-col gap-3 border-b border-slate-200/80 pb-4 dark:border-gdc-divider lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-slate-900 dark:text-slate-50">Operations Center</h2>
          <p className="text-[13px] text-slate-600 dark:text-gdc-muted">
            Global operational overview: stream health, incidents, alerts, retries, limits, delivery failures, checkpoints,
            lag, and engine posture — from live runtime APIs only.
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
          <span
            className="inline-flex w-fit items-center gap-1.5 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-semibold text-emerald-800 dark:text-emerald-200/90"
            title="Streams currently in RUNNING state"
          >
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-40" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
            </span>
            {running} streams active
          </span>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-gdc-muted">
              Window
            </span>
            {WINDOW_OPTIONS.map((w) => (
              <button
                key={w}
                type="button"
                onClick={() => setMetricsWindow(w)}
                className={cn(
                  'rounded-md border px-2 py-1 text-[11px] font-semibold transition-colors',
                  w === metricsWindow
                    ? 'border-violet-500/50 bg-violet-500/10 text-violet-800 dark:text-violet-200'
                    : 'border-slate-200/80 text-slate-600 hover:border-slate-300 dark:border-gdc-border dark:text-gdc-muted',
                )}
              >
                {windowButtonLabel(w)}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-gdc-muted">
              Auto-refresh
            </span>
            {REFRESH_OPTIONS.map((o) => (
              <button
                key={o.label}
                type="button"
                onClick={() => {
                  setRefreshMs(o.ms)
                  persistDashboardRefreshMs(o.ms)
                }}
                className={cn(
                  'inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-semibold transition-colors',
                  refreshMs === o.ms
                    ? 'border-violet-500/50 bg-violet-500/10 text-violet-800 dark:text-violet-200'
                    : 'border-slate-200/80 text-slate-600 hover:border-slate-300 dark:border-gdc-border dark:text-gdc-muted',
                )}
              >
                {o.label}
                {o.ms != null ? <RefreshCw className="h-3 w-3 opacity-60" aria-hidden /> : null}
              </button>
            ))}
            <button
              type="button"
              onClick={() => void reload()}
              disabled={loading}
              className={cn(
                'inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-semibold transition-colors',
                'border-slate-200/80 text-slate-600 hover:border-slate-300 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gdc-border dark:text-gdc-muted',
              )}
              title="Refresh data now"
              aria-label="Refresh operational data now"
            >
              <RefreshCw className="h-3 w-3" aria-hidden />
              Now
            </button>
          </div>
        </div>
      </div>

      {loadError ? (
        <div
          className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-950 dark:border-amber-400/30 dark:bg-amber-500/10 dark:text-amber-100"
          role="alert"
        >
          {loadError}
        </div>
      ) : null}

      {loading && !bundle ? (
        <p className="text-[12px] text-slate-500 dark:text-gdc-muted" role="status">
          Loading operational data…
        </p>
      ) : null}

      <KpiSummaryWidget cards={kpiCards} loading={loading} />

      <RuntimeOperationsIncidents operational={bundle?.dashboard?.validation_operational} loading={loading} />

      <nav
        aria-label="Operations Center quick links"
        className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-slate-200/70 bg-slate-50/60 px-2.5 py-2 text-[11px] font-semibold dark:border-gdc-border dark:bg-gdc-section/80"
      >
        <Link to={NAV_PATH.runtime} className="text-violet-700 hover:underline dark:text-violet-300">
          Stream runtime
        </Link>
        <Link to={NAV_PATH.logs} className="text-violet-700 hover:underline dark:text-violet-300">
          Logs
        </Link>
        <Link to={NAV_PATH.routes} className="text-violet-700 hover:underline dark:text-violet-300">
          Routes
        </Link>
        <Link to={NAV_PATH.analytics} className="text-violet-700 hover:underline dark:text-violet-300">
          Analytics
        </Link>
        <Link to={NAV_PATH.connectors} className="text-violet-700 hover:underline dark:text-violet-300">
          Connectors
        </Link>
        <Link to={NAV_PATH.destinations} className="text-violet-700 hover:underline dark:text-violet-300">
          Destinations
        </Link>
        <Link to={NAV_PATH.validation} className="text-violet-700 hover:underline dark:text-violet-300">
          Advanced health checks
        </Link>
      </nav>

      <PipelineHealthStrip health={health ?? null} summary={summary} loading={loading} />

      <OpsRouteHealthSummaryWidget
        routes={health?.routes ?? null}
        destinations={health?.destinations ?? null}
        window={metricsWindow}
        loading={loading}
      />

      <section aria-label="Retries, rate limits, latency, engine" className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <OpsRetriesWidget retries={bundle?.retries ?? null} loading={loading} />
        <OpsRateLimitsWidget
          summary={summary}
          recentRateLimitedRoutes={recentRlRoutes}
          streamNameById={streamNameById}
          loading={loading}
        />
        <OpsLatencyWidget health={health ?? null} loading={loading} />
        <OpsRuntimeEngineWidget
          dashboard={bundle?.dashboard ?? null}
          systemResources={bundle?.systemResources ?? null}
          loading={loading}
        />
      </section>

      <div className="grid gap-4 lg:grid-cols-12 lg:items-stretch">
        <RuntimeVolumeWidget
          buckets={outcomeBuckets}
          windowLabel={windowButtonLabel(metricsWindow)}
          loading={loading}
        />
        <EventsOutcomePanel summary={summary} loading={loading} />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <TopFailingRoutesWidget
          rows={health?.worst_routes ?? []}
          streamNameById={streamNameById}
          loading={loading}
        />
        <TopUnhealthyStreamsWidget rows={health?.worst_streams ?? []} loading={loading} />
        <DestinationHealthWidget rows={health?.worst_destinations ?? []} loading={loading} />
      </div>

      <OpsRecentFailuresWidget
        rows={recentFailures}
        streamNameById={streamNameById}
        loading={loading}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <RecentDeliveriesWidget
          items={logs}
          streamNameById={streamNameById}
          destinationNameById={destinationNameById}
          loading={loading}
        />
        <ActiveAlertsWidget items={alerts} loading={loading} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <OpsRetentionSummaryWidget status={bundle?.retentionStatus ?? null} loading={loading} />
        <ValidationOperationalWidget operational={bundle?.dashboard?.validation_operational} loading={loading} />
      </div>

      <p className="flex items-center gap-2 border-t border-slate-200/70 pt-2.5 text-[10px] leading-relaxed text-slate-500 dark:border-gdc-border dark:text-gdc-muted">
        <Activity className="h-3 w-3 shrink-0 text-slate-400" aria-hidden />
        All times shown in UTC. Health scores and tables use the selected window of delivery logs. Engine:{' '}
        {bundle?.dashboard?.runtime_engine_status ?? '—'}
        {bundle?.dashboard?.active_worker_count != null
          ? ` · ${bundle.dashboard.active_worker_count} active workers`
          : null}
        .
      </p>
    </div>
  )
}
