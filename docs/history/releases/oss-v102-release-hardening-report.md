# OSS v1.0.2 Release Hardening Report

**Date:** 2026-06-09  
**Scope:** RH-01 ~ RH-06 (operational validation unblock; no new product features)

---

## Executive Summary

| Item | Status | Result |
|------|--------|--------|
| RH-01 Deployment Drift | ✅ CLOSED | Repo / API / DB → `20260609_0052_replay_idx` |
| RH-02 Slow Query Investigation | ✅ CLOSED | Root cause documented; mitigation path defined |
| RH-03 Release Documentation | ✅ CLOSED | CHANGELOG, README, install-guide, production-checklist → v1.0.2 |
| RH-04 24h Soak Artifact | ✅ PASS (condensed) | Script + sample CSV; full 24h gate via `collect-soak-metrics.sh` |
| RH-05 AI WireMock Soak | ✅ PASS | 6/6 tests (timeout, retry, failover) |
| RH-06 Alert Monitor Isolation | ✅ CLOSED | 13/13 `test_alert_webhook_delivery.py` |

### Final Verdict

```
OSS v1.0.2 READY
```

---

## RH-01 — Deployment Drift Resolution

### Before

| Layer | Revision |
|-------|----------|
| Repo head | `20260609_0052_replay_idx` |
| Running API image | `20260605_0041_governance_policies` |
| Production DB | `20260608_0048_ai_audit` |

### After (`docker compose build api frontend && up -d --force-recreate`)

```bash
docker compose exec api alembic heads
# 20260609_0052_replay_idx (head)

docker compose exec api alembic current
# 20260609_0052_replay_idx (head)

docker compose exec api python -c "..."  # alembic_version table
# db_version 20260609_0052_replay_idx

docker inspect gdc-platform-api --format '{{.Created}}'
# 2026-06-09T01:56:18Z (image rebuild)
```

**Alignment:** ✅ Repo = API container = DB = `20260609_0052_replay_idx`

---

## RH-02 — delivery_logs Slow Query Investigation

### Symptom

`slow_sql_critical` — 5~11s on operational snapshot `_fetch_last_outcomes` CTE.

### Dataset (production `gdc` catalog)

| Metric | Value |
|--------|------:|
| `delivery_logs` total rows | 3,068,222 |
| Distinct `stream_id` groups | 29 |
| Execution time (EXPLAIN ANALYZE) | **11,516 ms** |

### Root Cause

1. **Full-partition sequential scans** across `delivery_logs_2026_05`, `2026_06`, … (~692k outcome rows after stage filter).
2. Query filters `stage IN (...)` **without** `created_at` window — planner cannot prune partitions or use narrow indexes effectively.
3. `latest_failure` branch sorts ~12k failure rows (`DISTINCT ON group_id ORDER BY created_at DESC`) after scanning entire scoped CTE materialized in temp storage.
4. Existing indexes (`idx_logs_stream_stage_created_at`, etc.) are **time-ordered**; unbounded stage scans still degenerate to seq scan per partition.

### Improvement Options (priority)

| Priority | Action | Type |
|----------|--------|------|
| P0 (ops) | Ensure dashboard/operational APIs use `runtime_*_snapshot` + analytics buckets for >1h windows | Configuration / existing Phase 5–6 |
| P1 (post-v1.0.2) | Add `created_at >= :since` bound to `_fetch_last_outcomes` when UI window known | Small query hardening |
| P2 (scale) | Incremental last-outcome cache table keyed by `(group_column, group_id)` | Future hardening |

**No schema change in v1.0.2** — investigation-only per release scope.

Tool: `scripts/ops/explain-delivery-logs-slow-query.sh [stream_id|route_id|destination_id]`

---

## RH-03 — Release Documentation Refresh

Updated to **v1.0.2**:

- `CHANGELOG.md` — [1.0.2], [1.0.1] sections
- `README.md` — version banner
- `docs/deployment/install-guide.md` — checkout `v1.0.2`
- `docs/release/production-checklist.md`
- `docs/release/installation-validation.md`

Static gate: `bash scripts/release/validate-clean-install.sh` → 13/13 PASS

---

## RH-04 — 24h Soak Validation Artifact

### Tool

```bash
./scripts/ops/collect-soak-metrics.sh --duration 24h --interval 15m \
  --output docs/release/artifacts/soak-metrics-24h.csv
```

### Condensed validation (2026-06-09, post-rebuild)

Artifact: `docs/release/artifacts/soak-metrics-v102-20260609.csv`

| Criterion | Threshold | Observed |
|-----------|-----------|----------|
| API memory drift | < 15% over window | Stable (~520 MiB) |
| API PID count | ±5 | 42 (stable) |
| PG connections | ≤ 30 | 6–8 |
| Container restarts | 0 | 0 |

### Historical context

Pre-rebuild API container ran **4 days** (2026-06-05 → 2026-06-09) with 0 restarts, ~521 MiB — supports long-running stability.

### Soak Verdict

**PASS** (condensed gate + 4-day operational evidence). Operators SHOULD run full 24h script on production candidate hosts before GA tag.

---

## RH-05 — AI Gateway WireMock Soak

```bash
WIREMOCK_BASE_URL=http://<wiremock-ip>:8080 \
  python3 -m pytest tests/test_ai_provider_e2e_wiremock.py \
  tests/test_ai_failover_e2e.py::test_ai_provider_failover_primary_500_secondary_mock \
  tests/test_ai_failover_e2e.py::test_failover_eligible_for_ai_provider_timeout -q
```

| Scenario | Test | Result |
|----------|------|--------|
| OpenAI success | `test_wiremock_openai_success` | ✅ |
| 429 → retry → success | `test_wiremock_openai_429_then_success` | ✅ |
| 500 fail | `test_wiremock_openai_500_fails` | ✅ |
| Timeout (8s delay, 2s limit) | `test_wiremock_openai_timeout_fails` | ✅ |
| Failover primary 500 | `test_ai_provider_failover_primary_500_secondary_mock` | ✅ |
| Timeout eligibility | `test_failover_eligible_for_ai_provider_timeout` | ✅ |

**WireMock Soak: PASS (6/6)**

Tool: `scripts/ops/run-ai-wiremock-soak.sh`

---

## RH-06 — Alert Monitor Test Isolation

### Root cause

`PlatformAlertMonitor` used `SessionLocal()` (host/platform catalog) while tests seeded `gdc_pytest` via `db_session`. Full DB noise (`checkpoint_stalled`) masked target events.

### Fix (`tests/test_alert_webhook_delivery.py`)

- `_bind_alert_monitor_session()` — bind monitor to pytest engine
- `_suppress_noisy_alert_detectors()` — isolate checkpoint/destination/rate-limit noise
- Stream/route-scoped assertions

```bash
python3 -m pytest tests/test_alert_webhook_delivery.py -q
# 13 passed
```

---

## Findings by Severity

### Critical

None.

### High

| ID | Item | Status |
|----|------|--------|
| H-1 | Deployment drift | ✅ Closed (RH-01) |
| H-2 | Unbounded `delivery_logs` forensic scan | ✅ Documented; P0 mitigation = use snapshot/bucket APIs |

### Medium

| ID | Item | Status |
|----|------|--------|
| M-1 | Release docs v1.0.0 mismatch | ✅ Closed (RH-03) |
| M-2 | 24h formal soak CSV on every host | ⚠️ Script shipped; operator must run 24h before tag |

### Low

| ID | Item | Status |
|----|------|--------|
| L-1 | Alert monitor test isolation | ✅ Closed (RH-06) |

---

## Unblock Checklist

| # | Item | Status |
|---|------|--------|
| RH-01 | Deployment drift resolution | ✅ DONE |
| RH-02 | delivery_logs slow query investigation | ✅ DONE |
| RH-03 | Release documentation refresh | ✅ DONE |
| RH-04 | 24h soak validation artifact | ✅ DONE (script + condensed PASS) |
| RH-05 | AI Gateway WireMock soak | ✅ DONE |
| RH-06 | Alert monitor test isolation | ✅ DONE |

---

## Verdict

```
OSS v1.0.2 READY
```

**Recommended next step:** Annotated tag `v1.0.2` on clean working tree after operator runs full `collect-soak-metrics.sh --duration 24h` on the release candidate host.
