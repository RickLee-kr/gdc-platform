import type {
  DashboardOutcomeTimeseriesResponse,
  DashboardSummaryResponse,
  HealthOverviewResponse,
  RetrySummaryResponse,
} from './types/gdcApi'
import { metricDescription, metricMetaTitle, metricSnapshotLabel } from './metricMeta'

export type KpiCard = {
  label: string
  value: string
  sub: string
  subClass: string
  linkTo: string
  title?: string
  /** Normalized counts for mini sparkline (e.g. events per bucket). */
  sparkline?: number[]
}

const SUB_NEUTRAL = 'text-slate-600 dark:text-gdc-muted' as const

function windowLabel(window: string): string {
  switch (window) {
    case '15m':
      return '15m'
    case '1h':
      return '1h'
    case '6h':
      return '6h'
    case '24h':
      return '24h'
    default:
      return window
  }
}

function eventSparkline(outcome: DashboardOutcomeTimeseriesResponse | null | undefined): number[] | undefined {
  if (!outcome?.buckets?.length) return undefined
  const vals = outcome.buckets.map((b) => b.success + b.failed + b.rate_limited)
  return vals.some((v) => v > 0) ? vals : undefined
}

/** Builds six KPI cards from runtime dashboard, health, retry, and outcome timeseries APIs. */
export function buildKpiCards(input: {
  dashboard: DashboardSummaryResponse | null
  health: HealthOverviewResponse | null
  retries: RetrySummaryResponse | null
  outcomeTs: DashboardOutcomeTimeseriesResponse | null
  window: string
}): KpiCard[] {
  const { dashboard, health, retries, outcomeTs, window } = input
  const s = dashboard?.summary
  const meta = dashboard?.metric_meta
  const wl = windowLabel(window)

  const totalStreams = s?.total_streams ?? 0
  const healthyCount = s?.current_runtime_streams_healthy ?? health?.streams.healthy
  const healthyStr = healthyCount != null ? String(healthyCount) : '—'
  const healthySub =
    healthyCount != null && totalStreams > 0
      ? `${Math.round((healthyCount / totalStreams) * 100)}% of ${totalStreams} total streams`
      : totalStreams > 0
        ? 'Health data not available for this window'
        : 'No streams configured'

  const totalRoutesConfigured = s?.total_routes ?? 0
  const failedRoutesRaw =
    health != null ? health.routes.unhealthy + health.routes.critical : null
  const failedRoutesCapped =
    failedRoutesRaw != null && totalRoutesConfigured > 0
      ? Math.min(failedRoutesRaw, totalRoutesConfigured)
      : failedRoutesRaw
  const failedRoutesStr = failedRoutesCapped != null ? String(failedRoutesCapped) : '—'
  const failedSub =
    health != null
      ? `${health.routes.healthy} healthy · ${health.routes.degraded} degraded · ${health.routes.idle ?? 0} idle · ${
          health.routes.disabled ?? 0
        } disabled`
      : 'Route health scoring unavailable'

  const retryTotal = retries?.total_retry_outcome_events
  const retryStr = retryTotal != null ? String(retryTotal) : '—'
  const retrySub =
    retries != null
      ? `${retries.retry_success_events} retry success · ${retries.retry_failed_events} retry failed outcomes`
      : 'Retry-stage outcomes from delivery logs'

  const events = s != null ? String(s.recent_logs) : '—'
  const telemetrySnapshot = metricSnapshotLabel(meta, 'runtime_telemetry_rows.window', wl)
  const eventsSub =
    s != null
      ? `${s.recent_successes} delivery ok rows · ${s.recent_failures} delivery failed rows · ${s.recent_rate_limited} rate-limit rows`
      : 'Committed delivery_logs telemetry rows in the selected window'

  const dest = s != null ? String(s.enabled_destinations) : '—'
  const destSub =
    s != null ? `${s.total_destinations} total · ${s.disabled_destinations} disabled` : 'Configured destinations'

  const spark = eventSparkline(outcomeTs)

  return [
    {
      label: 'Active Streams',
      value: s != null ? String(s.running_streams) : '—',
      sub: `${totalStreams} total configured`,
      subClass: 'text-emerald-700/90 dark:text-emerald-400/90',
      linkTo: '/streams',
    },
    {
      label: 'Healthy Streams (live)',
      value: healthyStr,
      sub:
        healthyCount != null && s?.current_runtime_streams_healthy != null
          ? `${healthySub} · ${metricDescription(meta, 'current_runtime.healthy_streams')}`
          : healthySub,
      subClass: 'text-emerald-700/90 dark:text-emerald-400/90',
      linkTo: '/streams',
      title: metricMetaTitle(meta, 'current_runtime.healthy_streams'),
    },
    {
      label: 'Failed Routes (Live)',
      value: failedRoutesStr,
      sub: `${failedSub} · ${metricDescription(health?.metric_meta ?? meta, 'current_runtime.failed_routes')}`,
      subClass: 'text-red-700/85 dark:text-red-400/90',
      linkTo: '/routes',
      title: metricMetaTitle(health?.metric_meta ?? meta, 'current_runtime.failed_routes'),
    },
    {
      label: 'Retrying Deliveries',
      value: retryStr,
      sub: retrySub,
      subClass: 'text-amber-800/85 dark:text-amber-400/85',
      linkTo: '/runtime/analytics',
    },
    {
      label: `Runtime Telemetry Rows (${wl})`,
      value: events,
      sub: `${eventsSub} · ${metricDescription(meta, 'runtime_telemetry_rows.window')}${telemetrySnapshot ? ` · ${telemetrySnapshot}` : ''}`,
      subClass: SUB_NEUTRAL,
      linkTo: '/logs',
      title: metricMetaTitle(meta, 'runtime_telemetry_rows.window'),
      sparkline: spark,
    },
    {
      label: 'Destinations',
      value: dest,
      sub: destSub,
      subClass: 'text-emerald-700/90 dark:text-emerald-400/90',
      linkTo: '/destinations',
    },
  ]
}

/** @deprecated Use buildKpiCards — kept for tests that import the old helper name. */
export function kpiCardsFromDashboard(api: DashboardSummaryResponse): KpiCard[] {
  return buildKpiCards({
    dashboard: api,
    health: null,
    retries: null,
    outcomeTs: null,
    window: '1h',
  })
}
