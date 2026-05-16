# Admin — Dev validation lab diagnostics

## Scope

- Administrator-only HTTP API and Admin Settings UI for **development validation lab** fixture expectations, **live readiness probes** (WireMock, webhook echo, MinIO, PostgreSQL/MySQL/MariaDB fixtures, SFTP), **lab stream dependency gaps** (disabled slice flags, missing routes), and **dev_lab** continuous validation summary.
- **`/health`** extension: lightweight PostgreSQL `pg_index` validity snapshot for `delivery_logs` (invalid / not-ready indexes ⇒ `status: degraded` + structured `delivery_logs_indexes` payload).
- **Maintenance Center** panel `delivery_logs_indexes` plus prominent REINDEX warning when indexes are invalid.
- **Retention**: expose per-process cumulative `delivery_logs` row deletes from the operational retention scheduler on `GET /admin/retention-policy` (`delivery_logs_scheduler_metrics`). Code default for log retention remains **30 days** (`app/retention/config.py`); batch deletes unchanged.

## Non-goals

- No automatic `REINDEX` execution from the API.
- No mutation of user connectors/streams; read-only diagnostics only.

## Related

- `specs/032-dev-validation-lab-source-expansion/spec.md`
- `specs/027-maintenance-center/spec.md`
- `specs/034-data-retention/spec.md`
