# Continuous validation alerting

## Purpose

Continuous validation executes real `StreamRunner` cycles and records outcomes in `validation_runs`. **Validation alerting** turns repeated failures, auth loss, delivery gaps, checkpoint drift, and prolonged failing windows into **durable `validation_alerts` rows**, optional **outbound notifications**, and **recovery timeline** entries when checks return to `PASS`.

This layer is **additive**: it does not change checkpoint semantics, does not bypass `StreamRunner`, and does not commit inside the runner transaction.

## Alert lifecycle

1. **Trigger** — After each validation run row is appended (`validation_stage=runner_summary`), `apply_validation_alert_cycle` evaluates rules against the latest outcome, `delivery_logs` aggregates for the correlated `run_id`, and the updated validation definition row (including `last_failing_started_at` for prolonged failure tracking).
2. **Dedup** — Alerts deduplicate on `fingerprint` while `status=OPEN`. Repeated failures refresh `message` / `validation_run_id` without creating duplicate OPEN rows, reducing alert storms.
3. **Acknowledge** — Operators may mark an OPEN alert as `ACKNOWLEDGED` via `POST /api/v1/validation/alerts/{id}/acknowledge`.
4. **Resolve** — Automatic resolution occurs when a validation run reaches `PASS` (all OPEN alerts for that definition are set to `RESOLVED` and recovery events are recorded). Operators may also `POST /api/v1/validation/alerts/{id}/resolve` for manual closure.
5. **Notifications** — When a **new** OPEN alert row is inserted, the API schedules HTTP notifications on a **daemon thread** (fail-open). Deduped updates do not re-notify.

## Severity rules

- `WARN` validation outcomes **never** emit `CRITICAL` alerts (`cap_severity_for_overall`).
- Auth failures (`source_fetch_failed` path) map to `AUTH_FAILURE` with `CRITICAL` unless capped by `WARN`.
- Delivery / retry / missing success log signals default to `WARNING` unless capped.
- Prolonged failing windows (`VALIDATION_TIMEOUT`) and slow single runs (very high `latency_ms`) use `WARNING` by default.

## Alert types

| Type | When |
| --- | --- |
| `AUTH_FAILURE` | Auth / source fetch failure path detected |
| `DESTINATION_FAILURE` | `route_send_failed` signals in correlated `delivery_logs` |
| `DELIVERY_MISSING` | Missing `route_send_success` for the correlated `run_id` |
| `RETRY_EXHAUSTED` | `route_retry_failed` present for the correlated `run_id` |
| `CHECKPOINT_DRIFT` | Checkpoint advance expected but drift message emitted |
| `VALIDATION_TIMEOUT` | Failing longer than the configured window or extremely slow run latency |
| `VALIDATION_DEGRADED` | Elevated consecutive failures without a more specific root cause |

## Notification channels

Configure comma-separated targets (all optional, English-only payloads):

| Setting | Behavior |
| --- | --- |
| `VALIDATION_ALERT_NOTIFY_GENERIC_URLS` | POST JSON (`gdc.validation.alert/v1` envelope) |
| `VALIDATION_ALERT_NOTIFY_SLACK_URLS` | Slack-compatible `text` + attachment summary |
| `VALIDATION_ALERT_NOTIFY_PAGERDUTY_ROUTING_KEYS` | PagerDuty Events API v2 `trigger` to `https://events.pagerduty.com/v2/enqueue` |

Notifications include masked structured metadata, bounded HTTP timeouts, and small exponential backoff retries. Failures are logged and **never** propagate to `StreamRunner`.

Set `PLATFORM_PUBLIC_UI_BASE_URL` (no trailing slash) to emit absolute drill-down links in payloads; otherwise relative `/streams/{id}/runtime` style paths are included.

## Runtime and dashboard integration

- `GET /api/v1/runtime/dashboard/summary` embeds `validation_operational` (counts, latest open alerts, recoveries, 24h trend buckets).
- `GET /api/v1/runtime/validation/operational-summary` returns the same operational block for focused dashboards.
- `GET /api/v1/validation/failures/summary` exposes compact counters for automation.

## Production guidance

- Prefer **dedicated validation streams** and non-production receivers for outbound webhooks.
- Treat alert rows as **evidence**: correlate with `validation_runs.run_id` and `delivery_logs` using the UI drill-down links.
- Keep notifier URLs in secrets managers; logs redact query strings where possible.
- Tune supervisor interval (`VALIDATION_SUPERVISOR_INTERVAL_SEC`) separately from notification noise; dedup fingerprints already suppress duplicate OPEN rows.

## Related documents

- `docs/testing/continuous-validation.md` — synthetic validation overview
- `specs/016-continuous-validation/spec.md` — persistence + scheduler rules
- `specs/017-validation-alerting/spec.md` — alerting scope (this feature)
