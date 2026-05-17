import type { StreamConsoleRow } from '../../api/streamRows'
import { metricDescription, metricSnapshotLabel } from '../../api/metricMeta'
import type { DashboardSummaryNumbers, MetricMetaMap, StreamRuntimeMetricsResponse } from '../../api/types/gdcApi'

export type MonitoringKpi = {
  id: string
  label: string
  value: string
  subLabel: string
  title?: string
  trend: readonly number[]
  tone: 'neutral' | 'success' | 'warning' | 'error' | 'violet'
}

function repeatTrend(n: number, len = 7): readonly number[] {
  return Array.from({ length: len }, () => n)
}

export function formatCompactInt(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '0'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 10_000) return `${(n / 1_000).toFixed(1)}k`
  return String(Math.round(n))
}

/** Sum events in the last hour across stream rows (stats window aligned with console). */
export function sumEventsLastHour(rows: StreamConsoleRow[]): number {
  let t = 0
  for (const r of rows) t += r.events1h
  return t
}

export function averageLatencyMsFromMetrics(metricsByStream: Map<number, StreamRuntimeMetricsResponse>): number | null {
  const vals: number[] = []
  for (const m of metricsByStream.values()) {
    const v = m.kpis?.avg_latency_ms
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) vals.push(v)
  }
  if (!vals.length) return null
  return vals.reduce((a, b) => a + b, 0) / vals.length
}

export function globalErrorRatePct(dash: DashboardSummaryNumbers | null): number | null {
  if (!dash) return null
  if (dash.delivery_success_events == null || dash.delivery_failure_events == null) return null
  const s = safeNonNeg(dash.delivery_success_events)
  const f = safeNonNeg(dash.delivery_failure_events)
  const d = s + f
  if (d <= 0) return null
  return (100 * f) / d
}

function safeNonNeg(n: unknown): number {
  const x = typeof n === 'number' ? n : Number(n)
  if (!Number.isFinite(x) || x < 0) return 0
  return Math.floor(x)
}

export function statusCounts(rows: StreamConsoleRow[]) {
  let normal = 0
  let warning = 0
  let error = 0
  let stopped = 0
  for (const r of rows) {
    if (r.status === 'RUNNING') normal += 1
    else if (r.status === 'DEGRADED') warning += 1
    else if (r.status === 'ERROR') error += 1
    else stopped += 1
  }
  return { normal, warning, error, stopped }
}

export type MergedTimelinePoint = {
  t: string
  events: number
  label: string
}

/** Merge per-stream `events_over_time` buckets by timestamp; sums event counts. */
export function mergeEventsOverTime(
  metricsByStream: Map<number, StreamRuntimeMetricsResponse>,
): MergedTimelinePoint[] {
  const acc = new Map<string, number>()
  for (const m of metricsByStream.values()) {
    const series = m.events_over_time ?? []
    for (const b of series) {
      const ts = String(b.timestamp ?? '').trim()
      if (!ts) continue
      const ev = typeof b.events === 'number' && Number.isFinite(b.events) ? Math.max(0, b.events) : 0
      acc.set(ts, (acc.get(ts) ?? 0) + ev)
    }
  }
  const sorted = [...acc.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return sorted.map(([t, events]) => ({
    t,
    events,
    label: formatShortTick(t),
  }))
}

function formatShortTick(iso: string): string {
  const s = iso.trim()
  if (s.length >= 16) return s.slice(11, 16)
  return s
}

export function topStreamsByMetric(
  rows: StreamConsoleRow[],
  metricsByStream: Map<number, StreamRuntimeMetricsResponse>,
  topN: number,
): Array<{ id: number; name: string; eventsPerSec: number }> {
  const scored = rows
    .filter((r) => /^\d+$/.test(r.id))
    .map((r) => {
      const id = Number(r.id)
      const m = metricsByStream.get(id)
      const winSec = m?.metrics_window_seconds != null && Number.isFinite(m.metrics_window_seconds) ? m.metrics_window_seconds : 3600
      const events =
        m?.kpis?.events_last_hour != null && Number.isFinite(m.kpis.events_last_hour)
          ? Math.max(0, m.kpis.events_last_hour)
          : r.events1h
      const eps = events / Math.max(1, winSec)
      return { id, name: r.name, eventsPerSec: eps }
    })
  scored.sort((a, b) => b.eventsPerSec - a.eventsPerSec)
  return scored.slice(0, topN)
}

export function buildMonitoringKpis(
  dash: DashboardSummaryNumbers | null,
  rows: StreamConsoleRow[],
  metricsByStream: Map<number, StreamRuntimeMetricsResponse>,
  windowLabel = '1h',
  metricsWindowSeconds = 3600,
  metricMeta?: MetricMetaMap,
): MonitoringKpi[] {
  const total = dash?.total_streams ?? rows.length
  const running = dash?.running_streams ?? rows.filter((r) => r.status === 'RUNNING').length
  const currentHealthy = dash?.current_runtime_streams_healthy
  const currentWarning = dash?.current_runtime_streams_degraded
  const currentError =
    dash != null ? safeNonNeg(dash.current_runtime_streams_unhealthy) + safeNonNeg(dash.current_runtime_streams_critical) : null
  const eventsFromDash = dash?.processed_events
  const eventsTotal =
    eventsFromDash != null && Number.isFinite(eventsFromDash) && eventsFromDash > 0
      ? Math.max(0, Math.floor(eventsFromDash))
      : 0
  const errPct = globalErrorRatePct(dash)
  const avgLat = averageLatencyMsFromMetrics(metricsByStream)

  const windowSeconds = Math.max(1, safeNonNeg(metricsWindowSeconds) || 3600)
  const throughputEps = eventsTotal / windowSeconds
  const thrLabel =
    eventsTotal > 0 ? `${throughputEps >= 1 ? throughputEps.toFixed(2) : throughputEps.toFixed(3)} evt/s` : '—'

  const eventsLabel = eventsTotal > 0 ? `${formatCompactInt(eventsTotal)} events (${windowLabel})` : '—'

  const errLabel = errPct != null ? `${errPct.toFixed(2)}%` : '—'

  const latLabel = avgLat != null ? `${(avgLat / 1000).toFixed(2)}s` : '—'

  const uptimeLabel = running > 0 && dash ? 'Active' : dash ? 'Idle / stopped included' : '—'

  return [
    {
      id: 'streams',
      label: 'Healthy streams (live)',
      value: currentHealthy != null ? `${currentHealthy} / ${total}` : `— / ${total}`,
      subLabel:
        dash != null
          ? `current_runtime source · Warning ${currentWarning ?? '—'} · Error ${currentError ?? '—'}`
          : 'Dashboard summary required for live health',
      trend: repeatTrend(currentHealthy ?? 0),
      tone: currentHealthy != null && currentHealthy > 0 ? 'violet' : 'neutral',
    },
    {
      id: 'throughput',
      label: 'Throughput (total)',
      value: thrLabel,
      subLabel: `${metricDescription(metricMeta, 'runtime.throughput.processed_events_per_second')} · ${metricSnapshotLabel(metricMeta, 'runtime.throughput.processed_events_per_second', windowLabel)}`,
      title: metricDescription(metricMeta, 'runtime.throughput.processed_events_per_second'),
      trend: repeatTrend(Math.min(100, throughputEps)),
      tone: 'success',
    },
    {
      id: 'events',
      label: `Processed events (${windowLabel})`,
      value: eventsLabel,
      subLabel:
        dash?.processed_events != null
          ? `${metricDescription(metricMeta, 'processed_events.window')} · ${metricSnapshotLabel(metricMeta, 'processed_events.window', windowLabel)}`
          : 'Dashboard summary required for processed events',
      title: metricDescription(metricMeta, 'processed_events.window'),
      trend: repeatTrend(Math.min(100, eventsTotal / 10_000)),
      tone: 'success',
    },
    {
      id: 'errors',
      label: 'Delivery failure rate',
      value: errLabel,
      subLabel: dash
        ? `${metricDescription(metricMeta, 'delivery_outcomes.window')} · ${metricSnapshotLabel(metricMeta, 'delivery_outcomes.window', windowLabel)}`
        : 'Summary required',
      title: metricDescription(metricMeta, 'delivery_outcomes.window'),
      trend: repeatTrend(errPct ?? 0),
      tone: errPct != null && errPct > 2 ? 'error' : 'neutral',
    },
    {
      id: 'latency',
      label: 'Avg latency',
      value: latLabel,
      subLabel: metricsByStream.size ? 'Sampled from metrics' : 'No metrics',
      trend: repeatTrend(avgLat != null ? Math.min(100, avgLat / 50) : 0),
      tone: 'violet',
    },
    {
      id: 'uptime',
      label: 'Run state',
      value: uptimeLabel,
      subLabel: dash ? `Stopped ${safeNonNeg(dash.stopped_streams)} · Paused ${safeNonNeg(dash.paused_streams)}` : '—',
      trend: repeatTrend(running > 0 ? 100 : 20),
      tone: running > 0 ? 'success' : 'warning',
    },
  ]
}

export function donutFromTopStreams(
  top: Array<{ id: number; name: string; eventsPerSec: number }>,
  totalEps: number,
): Array<{ name: string; value: number; pct: number }> {
  if (!top.length || totalEps <= 0) return []
  return top.map((s) => ({
    name: s.name,
    value: s.eventsPerSec,
    pct: (100 * s.eventsPerSec) / totalEps,
  }))
}
