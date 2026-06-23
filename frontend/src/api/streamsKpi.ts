import { metricDescription, metricSnapshotLabel } from './metricMeta'
import type { DashboardSummaryNumbers, MetricMetaMap } from './types/gdcApi'
import type { OperationalSnapshotResponse } from './operationalSnapshot'
import {
  streamsSectionKpiFromOperationalSnapshot as streamsSectionKpiFromSnapshotSelectors,
  type StreamsSectionKpiFromSnapshot,
} from '../lib/operational-snapshot-selectors'

/** Mirrors `STREAMS_KPI` shape for the streams console header strip. */
export type StreamsSectionKpi = StreamsSectionKpiFromSnapshot

export function streamsSectionKpiFromOperationalSnapshot(snapshot: OperationalSnapshotResponse): StreamsSectionKpi {
  return streamsSectionKpiFromSnapshotSelectors(snapshot)
}

export function streamsSectionKpiFromSummary(s: DashboardSummaryNumbers, meta?: MetricMetaMap): StreamsSectionKpi {
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
    processedEvents: (s.processed_events ?? 0).toLocaleString(),
    processedEventsTrend: `${metricDescription(meta, 'processed_events.window')} · ${metricSnapshotLabel(meta, 'processed_events.window', 'selected window')} · ${(s.delivery_outcome_events ?? 0).toLocaleString()} delivery outcomes`,
  }
}
