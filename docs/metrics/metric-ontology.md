# Metric Ontology Contract

Runtime KPIs use explicit `metric_id` values from `app/runtime/metric_contract.py`. The rule is simple: the same `metric_id` must use the same formula everywhere, and different concepts must not be forced to match.

## Metric IDs

| metric_id | Meaning | Source | Formula | UI Usage |
| --- | --- | --- | --- | --- |
| `current_runtime.healthy_streams` | Live healthy stream posture | streams + current runtime health scoring | Count streams scored `HEALTHY` in `current_runtime` mode | Operations, Runtime, Streams |
| `current_runtime.failed_routes` | Live failed route posture | routes + delivery_logs health scoring | Count live route rows scored `UNHEALTHY` or `CRITICAL` | Operations |
| `processed_events.window` | Source input events processed | `delivery_logs` stage `run_complete` | `SUM(GREATEST(0, payload_sample.input_events))` | Operations, Streams, Runtime |
| `delivery_outcomes.window` | Destination delivery outcome events | route success/failure/retry outcome stages | `SUM(GREATEST(1, payload_sample.event_count))` | Runtime, Routes, Analytics |
| `delivery_outcomes.success` | Successful delivery outcome events | `route_send_success`, `route_retry_success` | `SUM(GREATEST(1, payload_sample.event_count))` | Runtime, Analytics |
| `delivery_outcomes.failure` | Failed delivery outcome events | `route_send_failed`, `route_retry_failed`, `route_unknown_failure_policy` | `SUM(GREATEST(1, payload_sample.event_count))` | Runtime, Routes, Analytics |
| `runtime_telemetry_rows.window` | Committed runtime telemetry rows | all committed `delivery_logs` stages | `COUNT(delivery_logs.id)` | Operations, Logs |
| `runtime_telemetry_rows.loaded` | Current Logs page/query telemetry rows | logs response rows | Count loaded or matching rows in current response | Logs |
| `historical_health.routes` | Full-window route health | historical route health scoring | Health level counts from full-window outcome aggregates | Routes, Analytics |
| `historical_health.streams` | Full-window stream health | historical stream health scoring | Health level counts from full-window outcome aggregates | Analytics |
| `route_config.total` | Configured route count | `routes` | `COUNT(routes.id)` | Operations, Routes |
| `route_config.enabled` | Enabled route count | `routes` + `destinations` | route enabled and destination enabled or absent | Operations, Routes |
| `route_config.disabled` | Disabled route count | `routes` + `destinations` | `route_config.total - route_config.enabled` | Operations, Routes |
| `runtime.throughput.processed_events_per_second` | Processed event throughput | `processed_events.window` | `processed_events.window / window_seconds` | Runtime |
| `routes.throughput.delivery_outcomes_per_second` | Delivery outcome throughput | `delivery_outcomes.window` | `delivery_outcomes.window / window_seconds` | Routes |

## Important Differences

`runtime_telemetry_rows != processed_events`: one `run_complete` row can report many source input events, and runtime telemetry rows also include lifecycle or rate-limit rows.

`processed_events != delivery_outcomes`: processed events are source input events from `run_complete`; delivery outcomes are destination delivery event counts after route fan-out and retries.

`live failed routes != historical error routes`: live failed routes are current runtime posture only; historical error routes are full-window route health and may include routes that recovered.

## Policies

Retry success counts as successful delivery outcome; retry failure counts as failed delivery outcome. Retry rows count as one row each for `runtime_telemetry_rows.*`.

Lifecycle rows, including `run_complete`, are included in `runtime_telemetry_rows.window` but excluded from `delivery_outcomes.window`.

Disabled and idle routes are reported separately from live failures. They do not become failed routes unless there are committed delivery outcome rows and scoring evidence for that metric.
