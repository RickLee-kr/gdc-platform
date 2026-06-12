import { ChevronDown, Plus, RefreshCw } from 'lucide-react'
import { useLayoutEffect, useMemo, useState } from 'react'
import { loadDashboardRefreshMs, persistDashboardRefreshMs } from '../../localPreferences'
import { Link } from 'react-router-dom'
import type { MetricsWindow } from '../../api/gdcRuntime'
import { newStreamPath } from '../../config/nav-paths'
import { cn } from '../../lib/utils'
import {
  deriveDashboardKpis,
  deriveFlowBreakdown,
  deriveFlowLaneCounts,
  deriveOverallHealth,
  deriveRecentAlertsSummary,
  deriveStreamsOperationalStatus,
  deriveSystemHealth,
  deriveTopSourcesByIngestRate,
  deriveTrafficChartSeries,
  deriveTrafficOverview,
} from './dashboard-charter-metrics'
import {
  DashboardKpiStrip,
  DashboardRunningBadge,
  DataFlowOverview,
  EventsOverTimeChart,
  OverallHealthHero,
  RecentAlertsPanel,
  StreamsStatusDonut,
  SystemHealthBar,
  TopSourcesByIngestRatePanel,
} from './dashboard-visual-panels'
import { useDashboardOverviewData } from './use-dashboard-overview-data'

const WINDOW_OPTIONS: MetricsWindow[] = ['15m', '1h', '6h', '24h']

const REFRESH_OPTIONS: { label: string; ms: number | null }[] = [
  { label: 'Off', ms: null },
  { label: '30s', ms: 30_000 },
  { label: '1m', ms: 60_000 },
]

function windowButtonLabel(w: MetricsWindow): string {
  if (w === '15m') return 'Last 15 minutes'
  if (w === '1h') return 'Last 1 hour'
  if (w === '6h') return 'Last 6 hours'
  if (w === '24h') return 'Last 24 hours'
  return w
}

function windowChipLabel(w: MetricsWindow): string {
  if (w === '15m') return '15m'
  if (w === '1h') return '1h'
  if (w === '6h') return '6h'
  if (w === '24h') return '24h'
  return w
}

export function DashboardOverview() {
  const [metricsWindow, setMetricsWindow] = useState<MetricsWindow>('15m')
  const [refreshMs, setRefreshMs] = useState<number | null>(null)

  useLayoutEffect(() => {
    setRefreshMs(loadDashboardRefreshMs())
  }, [])

  const { bundle, loading, loadError, reload } = useDashboardOverviewData(metricsWindow, refreshMs)
  const initialLoading = loading && bundle == null
  const windowLabel = windowChipLabel(metricsWindow)
  const windowLongLabel = windowButtonLabel(metricsWindow)

  const overallHealth = useMemo(() => deriveOverallHealth(bundle?.health ?? null), [bundle?.health])
  const streamsStatus = useMemo(
    () => deriveStreamsOperationalStatus(bundle?.dashboard ?? null, bundle?.streams ?? []),
    [bundle?.dashboard, bundle?.streams],
  )
  const traffic = useMemo(
    () => deriveTrafficOverview(bundle?.observability ?? null, bundle?.dashboard ?? null, windowLabel),
    [bundle?.observability, bundle?.dashboard, windowLabel],
  )
  const trafficSeries = useMemo(() => deriveTrafficChartSeries(bundle?.outcomeTs ?? null), [bundle?.outcomeTs])
  const alertsSummary = useMemo(
    () => deriveRecentAlertsSummary(bundle?.alerts?.items ?? []),
    [bundle?.alerts?.items],
  )
  const kpiItems = useMemo(
    () =>
      deriveDashboardKpis({
        observability: bundle?.observability ?? null,
        dashboard: bundle?.dashboard ?? null,
        traffic,
        alertsSummary,
        outcomeTs: bundle?.outcomeTs ?? null,
        windowLabel,
      }),
    [bundle?.observability, bundle?.dashboard, traffic, alertsSummary, bundle?.outcomeTs, windowLabel],
  )
  const flowCounts = useMemo(
    () =>
      deriveFlowLaneCounts(
        bundle?.observability ?? null,
        bundle?.dashboard ?? null,
        bundle?.streams ?? [],
        bundle?.connectors?.length ?? 0,
      ),
    [bundle?.observability, bundle?.dashboard, bundle?.streams, bundle?.connectors],
  )
  const flowBreakdown = useMemo(
    () =>
      deriveFlowBreakdown(
        bundle?.observability ?? null,
        bundle?.dashboard ?? null,
        bundle?.streams ?? [],
        bundle?.connectors ?? [],
        bundle?.destinations ?? [],
      ),
    [bundle?.observability, bundle?.dashboard, bundle?.streams, bundle?.connectors, bundle?.destinations],
  )
  const topSources = useMemo(
    () =>
      deriveTopSourcesByIngestRate(
        bundle?.connectors ?? [],
        bundle?.streams ?? [],
        bundle?.observability ?? null,
      ),
    [bundle?.connectors, bundle?.streams, bundle?.observability],
  )
  const systemHealth = useMemo(
    () => deriveSystemHealth(bundle?.health ?? null, bundle?.dashboard ?? null),
    [bundle?.health, bundle?.dashboard],
  )

  const totalStreams =
    bundle?.dashboard?.summary.total_streams ?? bundle?.observability?.totals?.streams_total ?? bundle?.streams.length ?? 0
  const isFreshInstall = !initialLoading && totalStreams === 0

  return (
    <div className="w-full min-w-0 space-y-3">
      <div className="flex flex-col gap-2 border-b border-slate-200/80 pb-3 dark:border-gdc-divider lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-50">Dashboard</h1>
          <p className="mt-0.5 text-[12px] text-slate-600 dark:text-gdc-muted">Operational overview of your data flows.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!isFreshInstall ? (
            <DashboardRunningBadge
              engineStatus={bundle?.dashboard?.runtime_engine_status}
              posture={overallHealth.posture}
            />
          ) : null}
          <div className="relative">
            <label htmlFor="dashboard-window-select" className="sr-only">
              Metrics window
            </label>
            <select
              id="dashboard-window-select"
              value={metricsWindow}
              onChange={(e) => setMetricsWindow(e.target.value as MetricsWindow)}
              className={cn(
                'appearance-none rounded-lg border border-slate-200/80 bg-white py-1.5 pl-3 pr-8 text-[12px] font-medium text-slate-700',
                'dark:border-gdc-border dark:bg-gdc-card dark:text-slate-200',
              )}
            >
              {WINDOW_OPTIONS.map((w) => (
                <option key={w} value={w}>
                  {windowButtonLabel(w)}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" aria-hidden />
          </div>
          <button
            type="button"
            onClick={() => void reload()}
            disabled={initialLoading}
            className={cn(
              'inline-flex items-center justify-center rounded-lg border p-2 transition-colors',
              'border-slate-200/80 text-slate-600 hover:border-slate-300 hover:bg-slate-50',
              'disabled:cursor-not-allowed disabled:opacity-50 dark:border-gdc-border dark:text-gdc-muted dark:hover:bg-gdc-section/60',
            )}
            title="Refresh data now"
            aria-label="Refresh dashboard data now"
          >
            <RefreshCw className={cn('h-4 w-4', initialLoading && 'animate-spin')} aria-hidden />
          </button>
          <details className="relative">
            <summary
              className={cn(
                'cursor-pointer list-none rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold',
                'border-slate-200/80 text-slate-600 dark:border-gdc-border dark:text-gdc-muted',
              )}
            >
              Auto-refresh
            </summary>
            <div className="absolute right-0 z-10 mt-1 min-w-[6rem] rounded-lg border border-slate-200/80 bg-white p-1 shadow-lg dark:border-gdc-border dark:bg-gdc-card">
              {REFRESH_OPTIONS.map((o) => (
                <button
                  key={o.label}
                  type="button"
                  onClick={() => {
                    setRefreshMs(o.ms)
                    persistDashboardRefreshMs(o.ms)
                  }}
                  className={cn(
                    'block w-full rounded-md px-2 py-1 text-left text-[11px] font-semibold',
                    refreshMs === o.ms
                      ? 'bg-violet-500/10 text-violet-800 dark:text-violet-200'
                      : 'text-slate-600 hover:bg-slate-50 dark:text-gdc-muted dark:hover:bg-gdc-section/60',
                  )}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </details>
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

      {initialLoading ? (
        <p className="text-[12px] text-slate-500 dark:text-gdc-muted" role="status">
          Loading dashboard data…
        </p>
      ) : null}

      {isFreshInstall ? (
        <section
          className="rounded-xl border border-violet-200/80 bg-violet-50/50 px-4 py-4 dark:border-violet-500/30 dark:bg-violet-500/10"
          data-testid="dashboard-empty-state"
        >
          <h3 className="text-[14px] font-semibold text-slate-900 dark:text-slate-100">Welcome to Data Relay</h3>
          <p className="mt-1 max-w-2xl text-[13px] text-slate-600 dark:text-gdc-mutedStrong">
            No streams are configured yet. Create your first stream to start collecting, transforming, and delivering data.
          </p>
          <Link
            to={newStreamPath()}
            className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-violet-600 px-3 py-1.5 text-[12px] font-semibold text-white shadow-sm hover:bg-violet-700 dark:bg-violet-500 dark:hover:bg-violet-600"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden />
            Create First Stream
          </Link>
        </section>
      ) : (
        <div className={cn('space-y-3', initialLoading && 'opacity-80')}>
          <OverallHealthHero health={overallHealth} windowLabel={windowLongLabel} />

          <DashboardKpiStrip items={kpiItems} />

          <div className="grid gap-3 lg:grid-cols-12">
            <DataFlowOverview flow={flowCounts} breakdown={flowBreakdown} />
            <EventsOverTimeChart series={trafficSeries} windowLabel={windowLongLabel} loading={initialLoading} />
          </div>

          <div className="grid gap-3 lg:grid-cols-3">
            <StreamsStatusDonut status={streamsStatus} />
            <TopSourcesByIngestRatePanel sources={topSources} />
            <RecentAlertsPanel summary={alertsSummary} items={bundle?.alerts?.items ?? []} />
          </div>

          <SystemHealthBar items={systemHealth} />
        </div>
      )}

      <div className="flex flex-col gap-0.5 border-t border-slate-200/70 pt-2 text-[10px] leading-relaxed text-slate-500 dark:border-gdc-border dark:text-gdc-muted sm:flex-row sm:items-center sm:justify-between">
        <p>© 2025 Data Relay Platform</p>
        <p>All times shown in UTC</p>
      </div>
    </div>
  )
}
