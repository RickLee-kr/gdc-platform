# Operational helper scripts

All scripts in this directory are **non-destructive by default**: they either issue **read-only** HTTP calls or print documentation.

## `retention_operator_helpers.sh`

Thin wrappers around the retention HTTP API:

- `retention_preview` — `GET /api/v1/retention/preview` (row counts and cutoffs).
- `retention_status` — `GET /api/v1/retention/status`.
- `retention_dry_run` — `POST /api/v1/retention/run` with `{"dry_run": true}`.

### Environment

| Variable | Default | Purpose |
|----------|---------|---------|
| `GDC_API_BASE` | `http://127.0.0.1:8000` | API origin (no trailing slash). |
| `GDC_API_TOKEN` | *(empty)* | Optional `Authorization: Bearer …` when `REQUIRE_AUTH=true`. |

### Examples

```bash
export GDC_API_BASE=https://gdc.example:8443
export GDC_API_TOKEN=your-jwt
./scripts/ops/retention_operator_helpers.sh retention_preview
./scripts/ops/retention_operator_helpers.sh retention_dry_run
```

See also `docs/operations/retention-policies.md`.
