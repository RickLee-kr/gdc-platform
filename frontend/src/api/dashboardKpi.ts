import type {
  DashboardOutcomeTimeseriesResponse,
  DashboardSummaryResponse,
  HealthOverviewResponse,
  RetrySummaryResponse,
} from './types/gdcApi'

export type KpiCard = {
  label: string
  value: string
  sub: string
  subClass: string
  linkTo: string
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
  const wl = windowLabel(window)

  const totalStreams = s?.total_streams ?? 0
  const healthyCount = health?.streams.healthy
  const healthyStr = healthyCount != null ? String(healthyCount) : '—'
  const healthySub =
    healthyCount != null && totalStreams > 0
      ? `${Math.round((healthyCount / totalStreams) * 100)}% of ${totalStreams} total streams`
      : totalStreams > 0
        ? 'Health data not available for this window'
        : 'No streams configured'

  const failedRoutesStr =
    health != null
      ? String(health.routes.unhealthy + health.routes.critical)
      : s != null
        ? String(s.disabled_routes)
        : '—'
  const failedSub =
    health != null
      ? `${health.routes.healthy} healthy routes · ${health.routes.degraded} degraded`
      : 'Open Routes for delivery status'

  const retryTotal = retries?.total_retry_outcome_events
  const retryStr = retryTotal != null ? String(retryTotal) : '—'
  const retrySub =
    retries != null
      ? `${retries.retry_success_events} retry success · ${retries.retry_failed_events} retry failed outcomes`
      : 'Retry-stage outcomes from delivery logs'

  const events = s != null ? String(s.recent_logs) : '—'
  const eventsSub =
    s != null
      ? `${s.recent_successes} ok · ${s.recent_failures} failed · ${s.recent_rate_limited} rate limited`
      : 'Delivery log rows in the selected window'

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
      label: 'Healthy Streams',
      value: healthyStr,
      sub: healthySub,
      subClass: 'text-emerald-700/90 dark:text-emerald-400/90',
      linkTo: '/streams',
    },
    {
      label: 'Failed Routes',
      value: failedRoutesStr,
      sub: failedSub,
      subClass: 'text-red-700/85 dark:text-red-400/90',
      linkTo: '/routes',
    },
    {
      label: 'Retrying Deliveries',
      value: retryStr,
      sub: retrySub,
      subClass: 'text-amber-800/85 dark:text-amber-400/85',
      linkTo: '/runtime/analytics',
    },
    {
      label: `Events (${wl})`,
      value: events,
      sub: eventsSub,
      subClass: SUB_NEUTRAL,
      linkTo: '/logs',
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
