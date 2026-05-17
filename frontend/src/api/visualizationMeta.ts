import type { VisualizationMeta, VisualizationMetaMap } from './types/gdcApi'

export function visualizationMeta(
  meta: VisualizationMetaMap | null | undefined,
  chartMetricId: string,
): VisualizationMeta | null {
  return meta?.[chartMetricId] ?? null
}

export function formatVisualizationSnapshot(meta: VisualizationMeta | null | undefined): string {
  const raw = meta?.generated_at ?? meta?.window_end ?? meta?.snapshot_id
  if (!raw) return 'snapshot n/a'
  try {
    const d = new Date(raw)
    if (!Number.isFinite(d.getTime())) return `snapshot ${raw}`
    return `snapshot ${d.toISOString().slice(0, 19).replace('T', ' ')} UTC`
  } catch {
    return `snapshot ${raw}`
  }
}

export function visualizationSummary(
  meta: VisualizationMetaMap | null | undefined,
  chartMetricId: string,
): string {
  const m = visualizationMeta(meta, chartMetricId)
  if (!m) return 'Visualization semantics unavailable'
  return [
    `Metric family: ${m.metric_id}`,
    `Aggregation: ${m.aggregation_type}`,
    `Normalization: ${m.normalization_rule}`,
    `Bucket: ${m.bucket_size_seconds ? `${m.bucket_size_seconds}s` : m.bucket_unit}`,
    `Unit: ${m.display_unit}`,
    formatVisualizationSnapshot(m),
  ].join(' | ')
}

export function visualizationTooltipLines(
  meta: VisualizationMetaMap | null | undefined,
  chartMetricId: string,
): string[] {
  const m = visualizationMeta(meta, chartMetricId)
  if (!m) return ['Visualization semantics unavailable']
  return [
    `Metric family: ${m.metric_id}`,
    `Aggregation: ${m.aggregation_type}`,
    `Normalization: ${m.normalization_rule}`,
    `Bucket meaning: ${m.y_axis_semantics}`,
    `Unit: ${m.display_unit}`,
    formatVisualizationSnapshot(m),
  ]
}

export function formatCoverageRatio(ratio: number | null | undefined): string {
  if (ratio == null || !Number.isFinite(ratio)) return 'coverage n/a'
  return `${(Math.max(0, ratio) * 100).toFixed(1)}% coverage`
}

export function enrichSubsetMeta(
  base: VisualizationMeta | null | undefined,
  subsetTotal: number,
  globalTotal: number,
): VisualizationMeta | null {
  if (!base) return null
  const safeSubset = Number.isFinite(subsetTotal) ? Math.max(0, subsetTotal) : 0
  const safeGlobal = Number.isFinite(globalTotal) ? Math.max(0, globalTotal) : 0
  const ratio = safeGlobal > 0 ? safeSubset / safeGlobal : 0
  return {
    ...base,
    subset: {
      subset_of_metric_id: base.metric_id,
      subset_total: safeSubset,
      global_total: safeGlobal,
      subset_coverage_ratio: ratio,
      display_unit: base.display_unit,
    },
  }
}

