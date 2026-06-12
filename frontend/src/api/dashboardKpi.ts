import type {
  DashboardOutcomeTimeseriesResponse,
  DashboardSummaryResponse,
  HealthOverviewResponse,
  ObservabilitySummaryResponse,
  RetrySummaryResponse,
} from './types/gdcApi'
import { metricDescription, metricMetaTitle, metricSnapshotLabel } from './metricMeta'
import { OP_COPY, OP_LABEL, sanitizeOperatorDisplayText } from '../lib/operator-vocabulary'

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
  observability?: ObservabilitySummaryResponse | null
  dashboard: DashboardSummaryResponse | null
  health: HealthOverviewResponse | null
  retries: RetrySummaryResponse | null
  outcomeTs: DashboardOutcomeTimeseriesResponse | null
  window: string
}): KpiCard[] {
  const { observability, dashboard, health, retries, outcomeTs, window } = input
  const s = dashboard?.summary
  const canonical = observability?.totals
  const meta = observability?.metric_meta ?? dashboard?.metric_meta
  const wl = windowLabel(window)

  const totalStreams = canonical?.streams_total ?? s?.total_streams ?? 0
  const healthyCount = s?.current_runtime_streams_healthy ?? health?.streams.healthy
  const healthyStr = healthyCount != null ? String(healthyCount) : '—'
  const healthySub =
    healthyCount != null && totalStreams > 0
      ? `${Math.round((healthyCount / totalStreams) * 100)}% of ${totalStreams} total streams`
      : totalStreams > 0
        ? 'Health data not available for this window'
        : 'No streams configured'

  const deliveryIssues =
    health != null
      ? (health.routes.unhealthy ?? health.routes.critical ?? 0) + (health.routes.degraded ?? 0)
      : s?.recent_failures ?? null
  const deliveryIssuesStr = deliveryIssues != null ? String(deliveryIssues) : '—'
  const deliveryIssuesSub = sanitizeOperatorDisplayText(
    health != null
      ? `${health.routes.degraded} degraded delivery paths · ${health.routes.unhealthy ?? health.routes.critical ?? 0} failing`
      : s != null
        ? `${s.recent_failures} recent delivery failures in window`
        : 'Delivery issue scoring unavailable',
  )

  const retryTotal = canonical != null ? canonical.retry_success_events + canonical.retry_failed_events : retries?.total_retry_outcome_events
  const retryStr = retryTotal != null ? String(retryTotal) : '—'
  const retrySub = sanitizeOperatorDisplayText(
    retries != null
      ? `${canonical?.retry_success_events ?? retries.retry_success_events} retry success · ${
          canonical?.retry_failed_events ?? retries.retry_failed_events
        } retry failed outcomes`
      : 'Retry outcomes in delivery records',
  )

  const events = canonical != null ? String(canonical.runtime_telemetry_rows) : s != null ? String(s.recent_logs) : '—'
  const telemetrySnapshot = metricSnapshotLabel(meta, 'runtime_telemetry_rows.window', wl)
  const eventsSub = sanitizeOperatorDisplayText(
    canonical != null
      ? `${canonical.delivery_success_events} delivery ok · ${canonical.delivery_failed_events} delivery failed · ${canonical.lifecycle_rows} lifecycle records`
      : s != null
        ? `${s.recent_successes} delivery ok · ${s.recent_failures} delivery failed · ${s.recent_rate_limited} rate limited`
        : OP_COPY.deliveryLogsWindow,
  )

  const govRisk =
    (s?.recent_failures ?? 0) > 0 || (health?.streams.unhealthy ?? 0) > 0
      ? 'Attention'
      : healthyCount != null && totalStreams > 0
        ? 'Stable'
        : '—'
  const govRiskSub = 'Policies, violations, and quarantine — open Governance for detail'

  const spark = eventSparkline(outcomeTs)

  return [
    {
      label: 'Active streams',
      value: canonical != null ? String(canonical.streams_running) : s != null ? String(s.running_streams) : '—',
      sub: `${totalStreams} total configured`,
      subClass: 'text-emerald-700/90 dark:text-emerald-400/90',
      linkTo: '/streams?status=RUNNING',
    },
    {
      label: 'Healthy streams',
      value: healthyStr,
      sub: sanitizeOperatorDisplayText(
        healthyCount != null && s?.current_runtime_streams_healthy != null
          ? `${healthySub} · ${metricDescription(meta, 'current_runtime.healthy_streams')}`
          : healthySub,
      ),
      subClass: 'text-emerald-700/90 dark:text-emerald-400/90',
      linkTo: '/streams',
      title: metricMetaTitle(meta, 'current_runtime.healthy_streams'),
    },
    {
      label: OP_LABEL.deliveryIssues,
      value: deliveryIssuesStr,
      sub: deliveryIssuesSub,
      subClass: 'text-red-700/85 dark:text-red-400/90',
      linkTo: '/logs?status=failed',
      title: metricMetaTitle(health?.metric_meta ?? meta, 'current_runtime.failed_routes'),
    },
    {
      label: 'Retrying deliveries',
      value: retryStr,
      sub: retrySub,
      subClass: 'text-amber-800/85 dark:text-amber-400/85',
      linkTo: '/monitoring/analytics?focus=retries',
    },
    {
      label: `${OP_LABEL.deliveryActivityRows} (${wl})`,
      value: events,
      sub: sanitizeOperatorDisplayText(
        `${eventsSub} · ${metricDescription(meta, 'runtime_telemetry_rows.window')}${telemetrySnapshot ? ` · ${telemetrySnapshot}` : ''}`,
      ),
      subClass: SUB_NEUTRAL,
      linkTo: '/logs',
      title: metricMetaTitle(meta, 'runtime_telemetry_rows.window'),
      sparkline: spark,
    },
    {
      label: OP_LABEL.riskAndGovernance,
      value: govRisk,
      sub: govRiskSub,
      subClass: 'text-violet-800/90 dark:text-violet-300/90',
      linkTo: '/governance/operations',
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
