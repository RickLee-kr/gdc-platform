# Runtime Snapshot Read Model — Phase 4

Physical operational snapshot tables decouple UI read latency from `delivery_logs` volume.

## 1. Previous structure (virtual aggregate)

```text
GET /api/v1/runtime/operational-snapshot
  → load_operational_snapshot_bulk_data()
  → bulk GROUP BY on delivery_logs (1m / 5m windows)
  → full-table last-outcome CTEs per request
  → assemble OperationalSnapshotResponse in Python
```

Cost scales with `delivery_logs` row count on every UI refresh.

## 2. New structure (physical read model)

```text
delivery_logs (immutable ledger)
  → RuntimeSnapshotScheduler (30s default, single overlap guard)
  → runtime_snapshot_updater.run_runtime_snapshot_update()
  → runtime_snapshot_repository.recompute_and_upsert_snapshots()
  → runtime_stream_snapshot | runtime_route_snapshot | runtime_destination_snapshot

GET /api/v1/runtime/operational-snapshot
  → load_physical_operational_rows() when read model populated
  → else virtual aggregate fallback (Phase 1 path)
  → assemble API contract (unchanged JSON)
```

## 3. Request path change

| Layer | Phase 1–3 | Phase 4 |
|-------|-----------|---------|
| Router | `build_operational_snapshot` | unchanged |
| Service | virtual `_assemble_snapshot` | `_assemble_snapshot_from_physical` when rows exist |
| Repository | `delivery_logs` aggregates | `runtime_*_snapshot` + entity metadata |

API contract and frontend are unchanged.

## 4. Updater flow

1. Collect entity ids from `delivery_logs` since scan window (default 15 minutes) and optional `last_delivery_log_id` cursor.
2. Fixed-count window aggregates: three GROUP BY queries (stream / route / destination) over 1m and 5m windows.
3. Last outcomes: bootstrap uses bulk CTEs once; incremental ticks merge scanned deltas into existing snapshot timestamps.
4. UPSERT all current streams/routes/destinations; delete orphan snapshot rows (CASCADE on entity delete).
5. Persist cursor in `runtime_snapshot_updater_state` (singleton row).
6. Fail-open: updater errors are logged (`runtime_snapshot_update_failed`) and do not affect StreamRunner or delivery.

Overlap prevention: in-process lock + `runtime_snapshot_update_skipped` when a tick is already running.

## 5. Expected scale behavior

| Dimension | Virtual (Phase 1–3) | Physical (Phase 4) |
|-----------|---------------------|---------------------|
| API DB work per request | Proportional to `delivery_logs` | Proportional to entity count (snapshot table scans) |
| API call count | 1 fixed | 1 fixed |
| Background work | None | Bounded scan window every 30s |
| 20–50 streams | Acceptable | Stable sub-300ms target on dev |
| Millions of `delivery_logs` | Heavy per-request aggregates | UI isolated; updater scans recent window only |

## 6. Operational consistency model

- **Eventually consistent**: snapshot may lag real-time delivery by one updater interval (default 30s).
- **Correctness**: each tick recomputes 1m/5m window metrics from `delivery_logs` (not incremental counters), so windowed EPS/rates stay accurate.
- **Last outcomes**: monotonic merge (max timestamps); bootstrap pass fills history once.
- **Entity lifecycle**: deleted streams/routes/destinations removed from snapshot tables on next tick; disabled entities stored with `IDLE` health.
- **Fallback**: empty read model → Phase 1 virtual path until first successful updater tick.

## 7. Configuration

| Variable | Default | Purpose |
|----------|---------|---------|
| `GDC_RUNTIME_OPERATIONAL_SNAPSHOT_READ_MODEL_ENABLED` | `true` | API reads physical tables when populated |
| `GDC_RUNTIME_OPERATIONAL_SNAPSHOT_UPDATER_ENABLED` | `true` | Background updater thread |
| `GDC_RUNTIME_OPERATIONAL_SNAPSHOT_UPDATER_INTERVAL_SECONDS` | `30` | Tick interval |
| `GDC_RUNTIME_OPERATIONAL_SNAPSHOT_SCAN_MINUTES` | `15` | Recent log scan for affected-entity detection |

## 8. Limitations

- No websocket/SSE; UI still polls REST.
- Global snapshot is derived at API time from stream rows (no `runtime_global_snapshot` table).
- First deploy after migration uses virtual path until bootstrap updater tick completes.
- Incremental last-outcome merge does not re-scan full history every tick (bootstrap once).
- `runtime_aggregate_snapshots` (analytics TTL cache) remains separate from operational read model tables.

## Tests

```bash
python3 -m pytest tests/test_operational_snapshot_endpoint.py \
  tests/test_runtime_snapshot_updater.py \
  tests/test_runtime_metrics.py
```
