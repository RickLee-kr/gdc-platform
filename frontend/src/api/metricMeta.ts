import type { MetricMetaMap } from './types/gdcApi'
import { OP_COPY, sanitizeOperatorDisplayText } from '../lib/operator-vocabulary'

const FALLBACK_DESCRIPTIONS: Record<string, string> = {
  'processed_events.window': 'Source input events from run_complete.',
  'delivery_outcomes.window': 'Destination delivery outcome events.',
  'runtime_telemetry_rows.window': OP_COPY.deliveryLogsLifecycle,
  'runtime_telemetry_rows.loaded': OP_COPY.deliveryLogsLoaded,
  'historical_health.routes': 'Historical route health, not live failure.',
  'current_runtime.failed_routes': 'Current runtime posture only.',
  'current_runtime.healthy_streams': 'Current runtime posture only.',
  'runtime.throughput.processed_events_per_second': 'Processed source input events per second.',
  'routes.throughput.delivery_outcomes_per_second': 'Destination delivery outcome events per second.',
  runtime_telemetry_rows: OP_COPY.deliveryLogsTotal,
  lifecycle_rows: 'Non-operational lifecycle telemetry rows in the selected window.',
  delivery_success_events: 'Successful first-attempt destination delivery outcomes.',
  delivery_failed_events: 'Failed first-attempt destination delivery outcomes.',
  retry_success_events: 'Successful retry delivery outcomes.',
  retry_failed_events: 'Failed retry delivery outcomes.',
  processed_events: 'Source-side processed event count from run_complete.',
  throughput_eps: 'Delivery outcome throughput normalized by seconds.',
  p95_latency_ms: 'P95 delivery latency from committed delivery outcome rows.',
}

export function metricDescription(meta: MetricMetaMap | null | undefined, metricId: string): string {
  const raw = meta?.[metricId]?.description ?? FALLBACK_DESCRIPTIONS[metricId] ?? metricId
  return sanitizeOperatorDisplayText(raw)
}

export function metricMetaTitle(meta: MetricMetaMap | null | undefined, metricId: string): string {
  const m = meta?.[metricId]
  if (!m) return metricDescription(meta, metricId)
  const label = sanitizeOperatorDisplayText(String(m.frontend_label ?? m.label ?? metricId))
  const description = sanitizeOperatorDisplayText(String(m.frontend_description ?? m.description ?? ''))
  return `${label}: ${description}`
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
