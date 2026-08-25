# Operational Snapshot — Phase 1 (Backend)

## Problem

Routes, Runtime, and Streams screens currently assemble observability from many separate API calls (`routes`, `streams`, `destinations`, per-stream `metrics`, `logs`, `checkpoints`). That causes:

- Waterfall loading (serial dependent fetches)
- N+1 patterns (one metrics/log aggregate call per stream or route)
- Repeated `delivery_logs` aggregation on every page visit

## Phase 1 solution: virtual operational snapshot API

**Endpoint:** `GET /api/v1/runtime/operational-snapshot`

Phase 1 adds a single read-only contract that returns:

- `global` — platform-wide health and throughput summary
- `streams` — per-stream operational row
- `routes` — per-route delivery posture
- `destinations` — per-destination inbound/failure signals
- `problems` — actionable warnings and critical issues
- `updated_at` — snapshot generation time

Implementation reads existing PostgreSQL tables (`streams`, `routes`, `destinations`, `checkpoints`, `delivery_logs`) via **bulk GROUP BY queries** and assembles a “virtual snapshot” in Python. No physical snapshot tables are used.

Layering:

| Layer | Module |
|-------|--------|
| Router | `app/runtime/router.py` |
| Service | `app/runtime/operational_snapshot_service.py` |
| Repository | `app/runtime/operational_snapshot_repository.py` |
| Schemas | `app/runtime/operational_snapshot_schemas.py` |

## What Phase 1 does not do

- No `runtime_*_snapshot` tables
- No Alembic migrations for snapshot storage
- No frontend migration in Phase 1 (Routes migration is **Phase 2** — see `routes-page-snapshot-migration.md`)
- No StreamRunner, checkpoint commit, or `delivery_logs` semantics changes
- No DB reset/truncate in product code

## Future phases

| Phase | Scope |
|-------|--------|
| **2** | Routes page consumes `operational-snapshot` instead of per-entity fetches |
| **3** | Runtime Command Center uses the same contract |
| **4** | Physical read model (`runtime_stream_snapshot`, `runtime_route_snapshot`, `runtime_destination_snapshot`) — swap repository internals only |

## Performance goal

- **Fixed API count** regardless of stream count (one GET for the operational surface)
- **Operational snapshot** target &lt; 300 ms on local/dev PostgreSQL
- After Phase 2, **Routes initial visible** target &lt; 1.5 s (UI + single snapshot)

## Known limitations (Phase 1)

- Snapshot is computed on every request (no materialized table or server-side cache yet)
- Short windows only: 1 minute and 5 minute `delivery_logs` aggregates
- Checkpoint lag warning uses `checkpoints.updated_at` vs request time (no new lag semantics)
- Global health derives from generated `problems` list, not a separate scoring engine

## Tests

```bash
python3 -m pytest tests/test_operational_snapshot_endpoint.py \
  tests/test_runtime_metrics.py \
  tests/test_runtime_dashboard_summary_endpoint.py \
  tests/test_runtime_analytics_endpoints.py
```
