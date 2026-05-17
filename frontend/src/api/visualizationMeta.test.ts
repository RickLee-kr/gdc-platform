import { describe, expect, it } from 'vitest'
import {
  enrichSubsetMeta,
  formatCoverageRatio,
  visualizationSummary,
  visualizationTooltipLines,
} from './visualizationMeta'
import type { VisualizationMetaMap } from './types/gdcApi'

const meta = (): VisualizationMetaMap => ({
  'runtime.top_streams.throughput_share.window_avg_eps': {
    metric_id: 'runtime.throughput.processed_events_per_second',
    chart_metric_id: 'runtime.top_streams.throughput_share.window_avg_eps',
    aggregation_type: 'top_n_window_avg_eps_divided_by_global_window_avg_eps',
    visualization_type: 'donut',
    normalization_rule: 'eps_window_avg',
    bucket_unit: 'window',
    bucket_size_seconds: null,
    y_axis_semantics: 'Top stream processed event EPS share over the full resolved window.',
    avg_vs_peak_semantics: 'Top-N total is a subset of global throughput, not a reconciliation error.',
    cumulative_semantics: 'not_cumulative',
    subset_semantics: 'subset_of_global_metric',
    chart_window_semantics: 'Uses the same snapshot window as the global runtime throughput KPI.',
    snapshot_alignment_required: true,
    display_unit: 'evt/s',
    tooltip_template: '{metric_family}: {value} {unit}; subset coverage {coverage}; snapshot {snapshot_time}.',
    generated_at: '2026-01-01T01:00:00Z',
  },
})

describe('visualization meta helpers', () => {
  it('formats semantic summaries from metadata', () => {
    const summary = visualizationSummary(meta(), 'runtime.top_streams.throughput_share.window_avg_eps')
    expect(summary).toContain('Metric family: runtime.throughput.processed_events_per_second')
    expect(summary).toContain('Normalization: eps_window_avg')
    expect(summary).toContain('Unit: evt/s')
  })

  it('formats tooltip lines required by chart contract', () => {
    const lines = visualizationTooltipLines(meta(), 'runtime.top_streams.throughput_share.window_avg_eps')
    expect(lines).toEqual(
      expect.arrayContaining([
        'Metric family: runtime.throughput.processed_events_per_second',
        'Aggregation: top_n_window_avg_eps_divided_by_global_window_avg_eps',
        'Normalization: eps_window_avg',
        'Unit: evt/s',
      ]),
    )
  })

  it('computes top subset coverage against the global denominator', () => {
    const enriched = enrichSubsetMeta(meta()['runtime.top_streams.throughput_share.window_avg_eps'], 0.013, 0.034)
    expect(enriched?.subset?.subset_coverage_ratio).toBeCloseTo(0.38235, 5)
    expect(formatCoverageRatio(enriched?.subset?.subset_coverage_ratio)).toBe('38.2% coverage')
  })
})

