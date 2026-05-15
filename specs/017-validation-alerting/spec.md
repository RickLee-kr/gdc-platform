# 017 Validation alerting

## Purpose

Operational monitoring for continuous validation: deduplicated `validation_alerts`, recovery timeline rows, outbound notifications, and read-only integration with runtime/dashboard APIs—without altering `StreamRunner` transaction ownership or checkpoint semantics.

## Rules

- PostgreSQL only; additive tables `validation_alerts`, `validation_recovery_events`, and `continuous_validations.last_failing_started_at`.
- Notifications are asynchronous, fail-open, and must not block validation persistence.
- WARN-only validation outcomes must not create CRITICAL alerts.
- Recovery auto-resolves OPEN alerts after a `PASS` outcome for the same validation definition.

## References

- Implementation: `app/validation/alert_service.py`, `app/validation/notifiers/`, `app/validation/ops_read.py`
- Operator notes: `docs/testing/validation-alerting.md`
