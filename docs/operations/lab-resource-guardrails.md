# Lab / platform resource guardrails

This document describes how the development platform separates **core** services from **lab fixtures**, and how lab retention + **resource budget** keep a long-running E2E lab from exhausting host memory/disk.

## Platform vs `--profile lab`

Default:

```bash
docker compose -f docker-compose.platform.yml up -d
```

Starts **core only**: `postgres`, `api`, `scheduler`, `frontend`, `reverse-proxy`.

Lab HTTP fixtures (`gdc-wiremock-test` service, DNS alias **`gdc-platform-wiremock-test`**) are behind Compose profile **`lab`**:

```bash
docker compose -f docker-compose.platform.yml --profile lab up -d
```

**Do not start a second WireMock** from project `gdc-platform-test` (`wiremock-test` / container `gdc-wiremock-test`) on network `gdc-dev-validation` while the platform lab WireMock is running — that creates DNS split-brain. Platform + lab bootstrap scripts skip fixture `wiremock-test` and warn if more than one WireMock is running. Canonical URL: `http://gdc-platform-wiremock-test:8080`.

Lab bootstrap scripts (`scripts/dev/bootstrap-dev-platform.sh`, `scripts/dev-validation/bootstrap-platform-dev-validation.sh`) pass `--profile lab` when they need fixtures.

`ENABLE_DEV_VALIDATION_LAB` defaults to **`false`** in `docker-compose.platform.yml` for a safer core platform. Lab overlays / bootstrap set it to **`true`** (`docker-compose.platform.dev-validation.yml`).

Why fixtures are not in default `up`: WireMock journals, webhook echo, and syslog sinks consume RAM/CPU and are only needed for DEV VALIDATION / E2E visual lab work — not for a plain API/UI stack.

## Cleanup recoverability

When delivery_logs is over budget, status/diagnostics report one of:

| Status | Meaning | Pause lab/e2e generation? |
|--------|---------|---------------------------|
| `recoverable_by_auto_cleanup` | One auto row-delete cycle should restore budget | No |
| `needs_multiple_auto_cleanup_cycles` | Auto cleanup can finish, but needs several capped runs | No |
| `destructive_cleanup_recommended` | Old partitions exist; manual DROP review advised for disk reclaim | No (advisory only) |
| `destructive_cleanup_required` | Auto cleanup cannot safely recover; manual partition review required | Yes |
| `cleanup_failed` / `cleanup_insufficient` | Auto cleanup errored or could not restore budget | Yes |

Core scheduler tasks are never paused by this policy.

`partition_drop_candidates` include size/rows/date range/`safe_to_drop_candidate`/`reason`.
Current/next month partitions are never `safe_to_drop_candidate=true`.

Preview DROP SQL (never executes; prints DB target + dry-run warning):

```bash
cd /home/aella/gdc-platform
.venv/bin/python -m app.dev_validation_lab.lab_cleanup_cli --show-partition-drop-sql
```


When budget is exceeded and `lab_effective()`:

1. WireMock journal reset (`DELETE /__admin/requests`) if needed
2. Retention-aged `platform_alert_history` row deletes
3. Retention-aged `stream_replay_events` row deletes
4. Retention-aged `delivery_logs` row deletes (capped per run)
5. Re-check budget
6. If recovered → lab generation continues
7. If `destructive_cleanup_recommended` / multi-cycle / recoverable → lab generation continues (advisory only)
8. If unrecovered and auto recovery is not possible → pause lab generation only (`cleanup_failed` / `cleanup_insufficient` / `destructive_cleanup_required`)

| Variable | Default |
|----------|---------|
| `GDC_LAB_AUTO_REMEDIATION_ENABLED` | true |
| `GDC_LAB_AUTO_CLEANUP_ON_BUDGET_EXCEEDED` | true |
| `GDC_LAB_AUTO_WIREMOCK_RESET` | true |
| `GDC_LAB_AUTO_CLEANUP_COOLDOWN_SECONDS` | 120 |
| `GDC_LAB_AUTO_CLEANUP_MAX_ROWS_PER_RUN` | 100000 |

**Never automatic:** partition `DROP`, `TRUNCATE`, `VACUUM FULL`. Partition drop candidates appear in status only.

Production / lab-off: auto remediation is always inactive.

Manual CLI remains available for operators:

```bash
cd /home/aella/gdc-platform
.venv/bin/python -m app.dev_validation_lab.lab_cleanup_cli
.venv/bin/python -m app.dev_validation_lab.lab_cleanup_cli --execute
```

## Resource budget env vars

| Variable | Default | Notes |
|----------|---------|-------|
| `GDC_LAB_RESOURCE_GUARDRAIL_ENABLED` | true | Requires `lab_effective()`; inactive in production without lab |
| `GDC_LAB_MAX_DELIVERY_LOG_ROWS` | 100000 | Hard pause when exceeded |
| `GDC_LAB_MAX_DELIVERY_LOG_SIZE_BYTES` | 536870912 (512 MiB) | Relation size estimate |
| `GDC_LAB_MAX_ALERT_HISTORY_ROWS` | 20000 | |
| `GDC_LAB_MAX_REPLAY_EVENT_ROWS` | 20000 | |
| `GDC_LAB_MAX_WIREMOCK_JOURNAL_ENTRIES` | 500 | Lab budget threshold; platform WireMock disables the request journal |
| `GDC_LAB_MAX_RECENT_EPS` | 20 | Pause when recent EPS (rows/10m ÷ 600) exceeds |
| `GDC_LAB_MAX_ROWS_PER_10M` | 12000 | ≈ 20 EPS × 600s |
| `GDC_LAB_PAUSE_ON_BUDGET_EXCEEDED` | true | Set false to report exceeded without pausing |
| `GDC_LAB_WIREMOCK_JOURNAL_AUTO_RESET` | true | Lab-only `DELETE /__admin/requests` near/at cap |
| `GDC_LAB_PAUSE_BACKOFF_SECONDS` | 30 | Wait between pause re-checks |

## WireMock limits

- Platform lab WireMock (`docker-compose.platform.yml`):
  - `mem_limit: 1g` / `memswap_limit: 1536m`
  - `JAVA_OPTS=-Xms128m -Xmx512m` (heap capped below container limit)
  - `--no-request-journal` (lab EPS stubs must not retain request/response bodies)
  - Healthcheck: `GET http://127.0.0.1:8080/__admin/health` must return `"status":"healthy"`
- Lab fixtures (`gdc-webhook-receiver-test`, `gdc-syslog-test`, `gdc-wiremock-test`) use Docker `json-file` log rotation (`max-size=10m`, `max-file=3`) so E2E echo/syslog stdout cannot fill the host disk
- Test compose WireMock may still use `--max-request-journal-entries 500` for pytest verification
- Lab status reports `wiremock_journal_entries`; auto-reset only when `lab_effective()`

## Memory defaults (platform compose)

| Service   | mem_limit default | memswap default |
|-----------|-------------------|-----------------|
| api       | 2g (`GDC_API_MEM_LIMIT`) | 3g |
| scheduler | 1.5g (`GDC_SCHEDULER_MEM_LIMIT`) | 2g |
| postgres  | 2g (`GDC_POSTGRES_MEM_LIMIT`) | 3g |
| wiremock  | 1g | 1536m |

Lab feeder / StreamRunner E2E path: dispatch in small chunks (`GDC_LAB_FEED_DISPATCH_CHUNK_SIZE`, default 25) and discard batch memory after send/flush (fetch → send → discard).

## Lab retention env vars

| Variable | Default | Notes |
|----------|---------|-------|
| `GDC_LAB_DELIVERY_LOG_RETENTION_DAYS` | 1 | Row eligibility cutoff (keep E2E history minimal) |
| `GDC_LAB_ALERT_HISTORY_RETENTION_DAYS` | 1 | `platform_alert_history` |
| `GDC_LAB_REPLAY_EVENT_RETENTION_DAYS` | 1 | `stream_replay_events` |
| `GDC_LAB_VALIDATION_RUN_RETENTION_DAYS` | 1 | `validation_runs` |
| `GDC_LAB_RETENTION_ENABLED` | true | Only applies when `lab_effective()` |
| `GDC_LAB_RETENTION_AUTOMATIC_CLEANUP` | **true** | Scheduler **executes** retention-aged deletes |
| `GDC_LAB_RETENTION_BATCH_SIZE` | 5000 | Batched deletes |
| `GDC_LAB_FEED_DISPATCH_CHUNK_SIZE` | 25 | Feeder webhook/DB insert chunk size |

### Auto cleanup scope (safe only)

When `GDC_LAB_RETENTION_AUTOMATIC_CLEANUP=true` **and** lab retention is enabled, the scheduler may delete **retention-aged rows** from:

- `platform_alert_history`
- `stream_replay_events`
- `validation_runs`
- `delivery_logs` (row delete)

**Never automatic:** partition `DROP`, `TRUNCATE`, `VACUUM FULL`. Those remain manual operator steps.

Retention never drops the **current** or **next** month `delivery_logs` partition. Partition drop candidates are listed in preview only.

If automatic cleanup fails, lab generation pauses with reason `cleanup_failed`.

## Dry-run vs `--execute` cleanup

```bash
# Preview only (default)
python -m app.dev_validation_lab.lab_cleanup_cli
./scripts/ops/lab_cleanup.py

# Destructive (prints warning; does not auto VACUUM)
python -m app.dev_validation_lab.lab_cleanup_cli --execute
```

### Unpause after budget exceeded

1. `python -m app.dev_validation_lab.lab_cleanup_cli` (dry-run)
2. `python -m app.dev_validation_lab.lab_cleanup_cli --execute`
3. `./scripts/diagnostics/check_lab_resource_usage.sh`
4. When metrics are under limits, feeder/scheduler **auto-resume** lab generation (no manual flag clear required)

## Diagnostics (read-only)

```bash
./scripts/diagnostics/check_lab_resource_usage.sh
```

Reports host memory, `docker stats`, relation sizes, WireMock journal, scheduler status, lab status budget fields (current/limit/pause). **Never deletes.**

## Status / health

- `GET /api/v1/admin/dev-validation/status` — `resource_budget_status`, `exceeded_reasons`, `lab_paused`, `lab_pause_reason`, row/size/EPS/journal fields, `next_retry_after`
- `GET /api/v1/platform-admin/maintenance/health` — panel `lab_resource_budget`

## EPS note

DEV VALIDATION / DEV E2E streams target the **5–20 EPS** band when budget allows. Budget caps **pause** generation above the configured max; they do not raise EPS or create retry bursts.
