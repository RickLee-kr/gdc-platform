# 041 Metric Ontology Contract

## Scope

Introduce a runtime Metric Ontology Contract so operational KPIs expose their semantic meaning, source, formula, window, retry policy, lifecycle policy, and disabled/idle route policy.

This spec covers runtime KPI metadata only. It does not change StreamRunner transaction ownership, delivery behavior, checkpoint policy, route fan-out, or database schema.

## Contract Rules

- Every shared KPI that appears across Operations, Streams, Runtime, Routes, Analytics, or Logs must reference a stable `metric_id`.
- The same `metric_id` must use the same aggregation formula in every helper and API response.
- Different semantic concepts must keep different `metric_id` values, even when stored in `delivery_logs`.
- Runtime metric APIs remain read-only over PostgreSQL state.
- Product text, API descriptions, tests, and docs must remain English-only.

## Required Semantic Types

- `current_runtime_state`
- `source_input_events`
- `delivery_outcome_events`
- `telemetry_rows`
- `historical_health`
- `route_config_count`
- `system_resource`

## Required Metrics

- `current_runtime.healthy_streams`
- `current_runtime.failed_routes`
- `processed_events.window`
- `delivery_outcomes.window`
- `delivery_outcomes.success`
- `delivery_outcomes.failure`
- `runtime_telemetry_rows.window`
- `historical_health.routes`
- `historical_health.streams`
- `route_config.total`
- `route_config.enabled`
- `route_config.disabled`
- `runtime.throughput.processed_events_per_second`
- `routes.throughput.delivery_outcomes_per_second`

## Runtime Semantics

`processed_events.window` is source input events from committed `run_complete` rows:

```text
SUM(GREATEST(0, payload_sample.input_events))
```

`delivery_outcomes.window` is destination outcome event units from route delivery outcome stages:

```text
SUM(GREATEST(1, payload_sample.event_count))
```

`runtime_telemetry_rows.window` is committed runtime telemetry row count:

```text
COUNT(delivery_logs.id)
```

Lifecycle rows can appear in delivery log row metrics. They must not be included in delivery outcome metrics.

## API Requirement

Runtime summary, health, analytics, stream metrics, routes-composed runtime data, and logs responses should include `metric_meta` for major KPIs. Windowed responses should expose resolved `window_start` and `window_end` or equivalent resolved time metadata.

## UI Requirement

UI surfaces must use contract descriptions for tooltip or secondary explanatory text. Labels must distinguish:

- Processed Events: source input events from `run_complete`.
- Delivery Outcomes: destination delivery outcome events.
- Runtime Telemetry Rows: committed `delivery_logs` telemetry rows, including lifecycle stages.
- Historical Error Routes: historical route health, not live failure.
- Failed Routes Live: current runtime posture only.

## Out Of Scope

- No numeric reconciliation between different metric IDs.
- No frontend-only correction factors.
- No prefix-based entity inference.
- No schema migrations or runtime write paths.
