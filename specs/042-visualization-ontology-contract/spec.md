# Visualization Ontology Contract

## Scope

Runtime charts, sparklines, donuts, and KPI-adjacent visualizations must expose the same semantic contract as numeric KPIs. This spec extends the metric ontology contract with chart-specific semantics: aggregation, normalization, bucket/window behavior, axis units, cumulative behavior, subset coverage, and snapshot alignment.

This spec does not change StreamRunner transaction ownership, checkpoint behavior, delivery behavior, route fan-out, or database writes. Runtime visualization APIs remain read-only over PostgreSQL state.

## Contract Rules

- Every chart series must reference a stable `chart_metric_id`.
- Every `chart_metric_id` must reference a source metric `metric_id`.
- The same `chart_metric_id` must use the same aggregation and normalization rules in every API and UI surface.
- Different visual semantics must use different `chart_metric_id` values, even when they share the same source metric.
- Throughput visualizations must use exactly one normalization rule: `raw_count`, `eps_bucket`, or `eps_window_avg`.
- Histogram, cumulative, rolling average, instantaneous, and window average semantics must not be mixed under one chart metric.
- Windowed chart APIs must expose `snapshot_id`, `generated_at`, `window_start`, `window_end`, bucket metadata, and visualization metadata.
- Chart snapshots that share a requested `snapshot_id` must use the same generated time, window bounds, and bucket set.
- Subset charts must expose the denominator metric and coverage ratio.
- Product text, API metadata, tests, and UI labels must remain English-only.

## Required Metadata

Every visualization metadata entry must include:

- `metric_id`
- `chart_metric_id`
- `aggregation_type`
- `visualization_type`
- `normalization_rule`
- `bucket_unit`
- `bucket_size_seconds`
- `y_axis_semantics`
- `avg_vs_peak_semantics`
- `cumulative_semantics`
- `subset_semantics`
- `chart_window_semantics`
- `snapshot_alignment_required`
- `display_unit`
- `tooltip_template`

Windowed chart responses must also include:

- `bucket_size_seconds`
- `bucket_count`
- `bucket_alignment`
- `bucket_timezone`
- `bucket_mode`

## Required Chart Metrics

- `runtime.throughput.window_avg_eps`: processed source input event throughput over the whole window.
- `runtime.throughput.bucket_eps`: processed source input event throughput per fixed bucket.
- `routes.throughput.window_avg_eps`: destination delivery outcome throughput over the whole window.
- `routes.throughput.bucket_eps`: destination delivery outcome throughput per fixed bucket.
- `dashboard.delivery_outcomes.bucket_count`: stacked delivery outcome event counts per fixed bucket.
- `stream.processed_events.bucket_count`: processed source input event counts per fixed bucket.
- `stream.delivery_outcomes.bucket_count`: delivered and failed delivery outcome counts per fixed bucket.
- `analytics.delivery_failures.bucket_histogram`: failed delivery outcome event counts per fixed bucket.
- `runtime_telemetry.rows.bucket_count`: committed runtime telemetry row counts per fixed bucket.
- `runtime.top_streams.throughput_share.window_avg_eps`: top stream subset share of global processed-event throughput.
- `routes.destination_delivery_outcomes.donut_count`: destination delivery outcome event share.
- `routes.success_rate.bucket_ratio`: success ratio per fixed bucket.
- `routes.latency.bucket_avg_ms`: average latency per fixed bucket.

## Semantic Distinctions

`eps_window_avg` means total source or delivery events divided by the full resolved window seconds. This is KPI-friendly and can be lower than the highest chart bucket.

`eps_bucket` means a single bucket event count divided by that bucket's size in seconds. A bucket peak can be higher than the window average when events cluster in time.

`raw_count` means the y-axis is an event or row count for that bucket. It must not be displayed as EPS.

`histogram` means each bucket is independent. It is not cumulative and must not be rendered or described as a running total.

`subset` means the displayed values are intentionally less than or equal to a denominator metric. The response must expose `subset_of_metric_id` and `subset_coverage_ratio`.

## Required Explanations

The contract must make these relationships provable in code and tests:

- Runtime throughput KPI is a source input event window average.
- Runtime throughput charts are either source input event bucket EPS or bucket counts, never both under one chart metric.
- Route throughput KPI is a destination delivery outcome window average.
- Route throughput charts use destination delivery outcome bucket EPS.
- Analytics failure trends are fixed-window histograms unless a different chart metric explicitly says otherwise.
- Telemetry row charts count committed `delivery_logs` rows; processed event KPIs sum `run_complete.payload_sample.input_events`.
- Top-N throughput share is a subset of global throughput and exposes coverage.
- Stream health and route posture are different hierarchies and use different source metric families.

