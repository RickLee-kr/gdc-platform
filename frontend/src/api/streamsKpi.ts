import type { DashboardSummaryNumbers } from './types/gdcApi'

/** Mirrors `STREAMS_KPI` shape for the streams console header strip. */
export type StreamsSectionKpi = {
  total: number
  totalTrend: string
  running: number
  runningPct: string
  degraded: number
  degradedPct: string
  error: number
  errorPct: string
  stopped: number
  stoppedPct: string
  events24h: string
  events24hTrend: string
}

export function streamsSectionKpiFromSummary(s: DashboardSummaryNumbers): StreamsSectionKpi {
  const total = Math.max(0, s.total_streams)
  const running = s.running_streams
  const degradedApprox = s.rate_limited_source_streams + s.rate_limited_destination_streams + s.paused_streams
  const error = s.error_streams
  const stopped = s.stopped_streams
  const pct = (n: number) => (total > 0 ? `${Math.round((100 * n) / total)}% of total` : '—')

  return {
    total,
    totalTrend: 'Live · dashboard summary',
    running,
    runningPct: pct(running),
    degraded: degradedApprox,
    degradedPct: pct(degradedApprox),
    error,
    errorPct: pct(error),
    stopped,
    stoppedPct: pct(stopped),
    events24h: s.recent_logs.toLocaleString(),
    events24hTrend: `${s.recent_successes} successes · ${s.recent_failures} failures (window)`,
  }
}
