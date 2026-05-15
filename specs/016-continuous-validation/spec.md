# 016 Continuous validation

## Purpose

Operator-defined **synthetic operational validation** that periodically executes real `StreamRunner.run()` cycles and records outcomes in `validation_runs`, independent from `delivery_logs` analytics.

## Rules

- No StreamRunner bypass; no alternate runtime commit paths for pipeline data.
- Checkpoint semantics follow `specs/002-runtime-pipeline/spec.md`.
- PostgreSQL only; additive persistence via `continuous_validations` and `validation_runs`.
- Scheduler is separate from the stream polling scheduler; per-validation execution lock prevents overlap.

## References

- Implementation: `app/validation/`
- Operator guide: `docs/testing/continuous-validation.md`
- WireMock regression (different scope): `specs/014-wiremock-template-e2e/spec.md`
