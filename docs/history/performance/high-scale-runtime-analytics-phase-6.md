# High-scale Runtime Analytics — Phase 6

Phase 6 separates **operational current state** from **historical analytics** using pre-aggregated bucket tables. `delivery_logs` remains the immutable forensic ledger.

## 1. Previous historical analytics problem

| Symptom | Cause |
|---------|--------|
| `slow_sql_critical` on long-window charts | Per-request `GROUP BY` over `delivery_logs` |
| Outcome-timeseries latency grows with log volume | Full-window bucket scans per dashboard refresh |
| Analytics coupled to ledger size | No retention-independent read model for trends |

Phase 5 moved **operational** dashboard KPIs to `runtime_*_snapshot`. Deep timeseries and analytics trends still hit `delivery_logs` for windows > 1h.

## 2. Analytics bucket architecture

```text
delivery_logs (immutable ledger, monthly partitions)
  → RuntimeAnalyticsBucketUpdater (30s default)
  → runtime_analytics_bucket_1m | runtime_analytics_bucket_5m
  → runtime_analytics_bucket_read_repository
  → analytics APIs + dashboard outcome-timeseries (historical)

runtime_*_snapshot
  → operational snapshot APIs (current posture, short charts)

delivery_logs (bounded scans)
  → logs explorer, top error codes, last event times (forensic)
```

### Bucket fields (wide denormalized rows)

| Field | Purpose |
|-------|---------|
| `bucket_start` | UTC-aligned bucket start |
| `stream_id` / `route_id` / `destination_id` | Nullable dims; platform rollup uses all `NULL` |
| `event_count`, `success_count`, `failure_count`, `retry_count` | Outcome counters |
| `rate_limited_count` | Platform stacked chart |
| `eps_avg` | Events per second for bucket width |
| `latency_avg_ms`, `latency_p95_ms`, `latency_max_ms` | Latency trend proxies |
| `updated_at` | Upsert timestamp |

### Resolutions

| Table | Width | Query use |
|-------|-------|-----------|
| `runtime_analytics_bucket_1m` | 60s | Windows ≤ 24h |
| `runtime_analytics_bucket_5m` | 300s | Windows > 24h (7d, 30d) |
| Future `1h` rollup | 3600s | Optional; design reserved |

## 3. Bucket updater flow

1. Read `runtime_analytics_bucket_updater_state.last_delivery_log_id`.
2. Incremental scan: `delivery_logs WHERE id > cursor ORDER BY id LIMIT batch` (no full-history scan).
3. Aggregate into route-level buckets + platform rollup per resolution.
4. PostgreSQL `UPSERT` with additive counters on conflict.
5. Advance cursor; optional bounded retention delete per tick.

Fail-open: updater errors log `runtime_analytics_bucket_update_failed` and do not affect StreamRunner.

## 4. Partition-aware query strategy

- Queries are **bounded by time** (`bucket_start >= since AND bucket_start < until`).
- `delivery_logs` partitions prune the **updater** scan via `created_at` on bootstrap only.
- API reads hit bucket indexes (`bucket_start`, dimension indexes, composite `(bucket_start, stream, route, dest)`).
- Chart endpoints **re-bucket** 1m/5m rows to the UI `bucket_seconds` (max 256 points).

**Never** run large `delivery_logs GROUP BY` on the analytics bucket path when buckets are populated.

## 5. Operational vs historical separation

| Layer | Read model | Examples |
|-------|----------|----------|
| Operational current | `runtime_*_snapshot` | `operational-snapshot`, dashboard summary, retry KPI (5m proxy), ≤1h outcome stub |
| Historical analytics | `runtime_analytics_bucket_*` | outcome-timeseries (>1h), route failures trend, stream retries, destination outcomes |
| Forensic | `delivery_logs` | logs search/page, top error codes, last event timestamps |

`query_boundary.classify_query_category()` exposes: `runtime_operational_snapshot`, `runtime_analytics_bucket`, `runtime_forensic_logs`.

## 6. Expected scale behavior

| Request | Before Phase 6 | After (populated buckets) |
|---------|----------------|---------------------------|
| 24h outcome-timeseries | O(delivery_logs in 24h) | O(buckets in 24h) ≈ 1.4k rows (1m platform) |
| 7d failure trend | O(delivery_logs in 7d) | O(buckets in 7d) ≈ 2k rows (5m) |
| Analytics latency vs log growth | Coupled | Decoupled (bucket retention) |

Target: stable sub-second analytics reads on dev for 24h/7d windows with millions of `delivery_logs` rows.

## 7. Retention strategy

| Store | Default retention | Notes |
|-------|-------------------|-------|
| `runtime_analytics_bucket_1m` | 30 days | `GDC_RUNTIME_ANALYTICS_BUCKET_1M_RETENTION_DAYS` |
| `runtime_analytics_bucket_5m` | 90 days | `GDC_RUNTIME_ANALYTICS_BUCKET_5M_RETENTION_DAYS` |
| `delivery_logs` | Platform retention policy | Independent; forensic history |

Cleanup: bounded `DELETE ... LIMIT batch` per updater tick (no long table locks). Disable via `GDC_RUNTIME_ANALYTICS_BUCKET_RETENTION_CLEANUP_ENABLED=false`.

## Configuration

| Variable | Default | Purpose |
|----------|---------|---------|
| `GDC_RUNTIME_ANALYTICS_BUCKET_READ_ENABLED` | `true` | API uses buckets when populated |
| `GDC_RUNTIME_ANALYTICS_BUCKET_UPDATER_ENABLED` | `true` | Background updater |
| `GDC_RUNTIME_ANALYTICS_BUCKET_UPDATER_INTERVAL_SECONDS` | `30` | Tick interval |
| `GDC_RUNTIME_ANALYTICS_BUCKET_BATCH_LIMIT` | `50000` | Max logs per tick |
| `GDC_RUNTIME_ANALYTICS_BUCKET_BOOTSTRAP_MINUTES` | `60` | Initial cursor window |

## Tests

```bash
python3 -m pytest tests/test_runtime_analytics_buckets.py \
  tests/test_runtime_query_boundary.py \
  tests/test_runtime_snapshot_updater.py \
  tests/test_runtime_metrics.py -q
```

## Known limitations

- Top error codes / failed stages / last event times still scan `delivery_logs` (forensic).
- Bucket latency P95 is approximated from per-bucket max (not exact global percentile).
- `health_transition_count` reserved; not incremented in v1.
- First deploy uses `delivery_logs` fallback until updater populates platform buckets.
- Optional 1h rollup table not implemented (5m covers 7d/30d).
