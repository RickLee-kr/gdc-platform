# Runtime Operations Console

## Purpose

Single primary operational view for administrators and operators: stream health, delivery alerts (runtime log clusters), retries, rate-limit signals, destination failures, checkpoint drift from continuous validation, delivery latency where measured, and host/runtime engine posture.

## Constraints

- No changes to StreamRunner execution semantics.
- Data comes only from existing read APIs (`/runtime/dashboard/*`, `/runtime/health/*`, `/runtime/logs/alerts/summary`, `/runtime/analytics/retries/summary`, `/runtime/system/resources`, embedded `validation_operational` on dashboard summary).
- No fabricated KPIs; empty windows show honest empty states.

## UI

- Primary route remains `/` (sidebar: **Operations Center** — global operational overview; distinct from stream-level **Runtime** under Operations).
- Composes existing dashboard widgets and adds focused panels for retries, rate-limit posture, worst-case latency from health metrics, recent route failures from dashboard summary, and runtime engine + host snapshot.

## Alignment

Follows `specs/002-runtime-pipeline/spec.md`, `specs/012-runtime-health-scoring/spec.md`, and constitution checkpoint/delivery rules.
