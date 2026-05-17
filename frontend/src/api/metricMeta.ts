import type { MetricMetaMap } from './types/gdcApi'

const FALLBACK_DESCRIPTIONS: Record<string, string> = {
  'processed_events.window': 'Source input events from run_complete.',
  'delivery_outcomes.window': 'Destination delivery outcome events.',
  'runtime_telemetry_rows.window': 'Committed delivery_logs telemetry rows including lifecycle stages.',
  'runtime_telemetry_rows.loaded': 'Committed delivery_logs telemetry rows in the current Logs load.',
  'historical_health.routes': 'Historical route health, not live failure.',
  'current_runtime.failed_routes': 'Current runtime posture only.',
  'current_runtime.healthy_streams': 'Current runtime posture only.',
  'runtime.throughput.processed_events_per_second': 'Processed source input events per second.',
  'routes.throughput.delivery_outcomes_per_second': 'Destination delivery outcome events per second.',
}

export function metricDescription(meta: MetricMetaMap | null | undefined, metricId: string): string {
  return meta?.[metricId]?.description ?? FALLBACK_DESCRIPTIONS[metricId] ?? metricId
}

export function metricMetaTitle(meta: MetricMetaMap | null | undefined, metricId: string): string {
  const m = meta?.[metricId]
  if (!m) return metricDescription(meta, metricId)
  return `${m.frontend_label ?? m.label}: ${m.frontend_description ?? m.description}`
}

function formatUtcTime(iso: string | null | undefined): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (!Number.isFinite(d.getTime())) return null
  return d.toISOString().slice(11, 19)
}

export function metricSnapshotLabel(
  meta: MetricMetaMap | null | undefined,
  metricId: string,
  fallbackWindow?: string,
): string {
  const m = meta?.[metricId]
  const start = formatUtcTime(m?.window_start)
  const end = formatUtcTime(m?.window_end)
  if (start && end) return `Window: ${fallbackWindow ?? `${start}-${end} UTC`} · Generated: ${end} UTC`
  const generated = formatUtcTime(m?.generated_at)
  if (generated) return `Generated: ${generated} UTC`
  return fallbackWindow ? `Window: ${fallbackWindow}` : ''
}
