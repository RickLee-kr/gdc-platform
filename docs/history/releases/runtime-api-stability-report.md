# Runtime API Stability Report

**Date:** 2026-06-22  
**Branch:** `feature/sensitive-detection-m5-clean`  
**Scope:** Runtime API memory pressure, `delivery_logs` aggregation hardening, Streams Console read-path stabilization

---

## Executive Summary

| Item | Before | After |
|------|--------|-------|
| Streams Console load | Infinite spinner → API saturation | Stable load; bulk stats-health path |
| API timeout / OOM | Frequent under navigation | **0** in 12m 36s soak |
| `slow_sql_critical` | 9s+ on `_fetch_last_outcomes` | **0** in soak |
| uvicorn RSS | ~17 GiB (OOM kill) | **max 222 MiB** in soak |
| Swap | Growing under load | **Stable** (989 MiB start/end) |

**Verdict:** Runtime API and aggregation paths are operationally stable under repeated Dashboard ↔ Streams ↔ Runtime ↔ Connectors navigation.

---

## 1. 장애 증상

1. **무한 로딩** — Streams Console 및 Dashboard 진입 시 UI가 스피너 상태로 고정.
2. **API 포화** — 동일 페이지에서 수십~수백 건의 runtime read API가 동시·중복 호출.
3. **Timeout** — 느린 `delivery_logs` 집계가 worker를 점유하며 후속 요청이 타임아웃.
4. **메모리 폭증** — uvicorn 프로세스 RSS가 수 GB까지 증가, 최대 **~17 GiB** 관측 후 OOM kill.
5. **`slow_sql_critical`** — `operational_snapshot` / scheduler 경로의 `_fetch_last_outcomes`가 **9초+** 소요 (470만+ `delivery_logs` row 스캔).

---

## 2. 근본 원인

### 2.1 Frontend read fan-out

| 원인 | 영향 |
|------|------|
| Streams Console이 stream마다 개별 `stats-health` 호출 (N+1) | 초기 로드 시 `4 + C + 2N` HTTP (50 streams ≈ 114 calls) |
| 페이지 이탈 후에도 in-flight HTTP 미취소 | 누적 요청이 API worker·DB connection pool 압박 |
| 공유 캐시 없이 동일 snapshot API 반복 호출 | Dashboard auto-refresh마다 heavy aggregate 재실행 |

### 2.2 Backend `delivery_logs` heavy aggregation

| 경로 | 문제 |
|------|------|
| Per-stream `stats-health` | stream 수에 비례한 `delivery_logs` GROUP BY |
| `_fetch_last_outcomes` (operational snapshot / scheduler) | **시간 조건 없는** scoped CTE → 파티션 전체 seq scan |
| `health_repository` aggregates | 24h 상한 없이 long-window scan 가능 |
| `validation_runs` trend (`dashboard/summary`) | `validation_id` 필터 없이 historical scan → ~1s `slow_sql_warning` |

### 2.3 메모리 악화 메커니즘

```text
UI navigation (Streams / Dashboard refresh)
  → N× stats-health + health/overview + operational-snapshot
  → delivery_logs full/wide scans (seconds each)
  → concurrent SQLAlchemy sessions + large result materialization
  → uvicorn RSS growth → swap pressure → OOM
```

AbortController만으로는 **이미 시작된 heavy SQL**을 중단하지 못함. 백엔드 집계 범위·bulk 경로·캐시가 핵심 수정 대상이었다.

---

## 3. 수정 요약

### Backend

| 영역 | 조치 |
|------|------|
| **Bulk stats-health** | `GET /api/v1/runtime/streams/stats-health/bulk` — 단일 IN/GROUP BY 경로, soft/hard TTL 캐시, in-flight coalescing |
| **Health aggregates** | `clamp_health_aggregate_window` — `delivery_logs` health 집계 최대 **24h** |
| **Last outcomes** | `_fetch_last_outcomes` — 24h 윈도우, entity ID 필수, `DISTINCT ON`, statement timeout, degraded fallback |
| **Dashboard validation trend** | `validation_outcome_trend_buckets` — scoped `validation_id` + 24h, 800ms timeout, degraded |
| **Connectors reads** | Process-local TTL cache (`read_cache.py`), operations summary 격리 |
| **Log aggregates** | Bounded window helpers, incremental aggregate 우선 경로 |

### Frontend

| 영역 | 조치 |
|------|------|
| **Request coalescing** | `requestCache.ts` — 15s TTL, shared promise, abort 시 in-flight evict |
| **Mount abort** | `use-mount-abort-signal.ts`, `request-abort.ts` — 페이지 이탈 시 consumer unlink |
| **Streams Console** | Per-stream stats-health → **bulk** endpoint; mapping-ui lazy load |
| **API clients** | `gdcRuntime.ts`, `gdcConnectors.ts` 등 runtime read 경로 캐시·signal 전파 |

### Tests & ops

- `tests/test_runtime_stats_health_bulk.py`, `test_health_repository_aggregates.py`, `test_operational_last_outcomes.py`, `test_validation_ops_read.py`, `test_connectors_read_cache.py` 등 회귀 테스트 추가.
- API 컨테이너 재빌드·재배포 후 실사용 시나리오 soak 검증.

---

## 4. 주요 수정 파일

### Backend (runtime / aggregation)

| File | Role |
|------|------|
| `app/runtime/stats_health_bulk_service.py` | Bulk stats-health SQL (신규) |
| `app/runtime/stats_health_bulk_cache.py` | TTL + in-flight coalescing (신규) |
| `app/runtime/router.py` | Bulk endpoint 등록 |
| `app/runtime/health_repository.py` | 24h aggregate window clamp |
| `app/runtime/operational_snapshot_repository.py` | `_fetch_last_outcomes` hardening |
| `app/runtime/runtime_snapshot_repository.py` | 공유 last-outcomes loader |
| `app/runtime/read_service.py` | Dashboard / runtime read orchestration |
| `app/logs/aggregates.py` | Bounded delivery_logs aggregation |
| `app/validation/ops_read.py` | Scoped validation_runs trend |
| `app/connectors/read_cache.py` | Connectors list / ops summary cache (신규) |
| `app/connectors/operations_service.py` | Operations summary read path (신규) |

### Frontend (read path)

| File | Role |
|------|------|
| `frontend/src/api/requestCache.ts` | Shared request cache + abort eviction |
| `frontend/src/lib/request-abort.ts` | AbortError helpers (신규) |
| `frontend/src/hooks/use-mount-abort-signal.ts` | Mount-scoped signal (신규) |
| `frontend/src/api/gdcRuntime.ts` | Bulk stats-health client |
| `frontend/src/components/streams/streams-console.tsx` | Bulk enrichment, lazy mapping |

---

## 5. API별 성능 개선 결과

측정 환경: dev platform (`docker-compose.platform.yml`), `delivery_logs` 470만+ rows, 20라운드 × 30s 간격 (2026-06-22).

| Endpoint | Before (symptom) | After (soak avg / max) | Notes |
|----------|------------------|------------------------|-------|
| `GET /runtime/streams/stats-health/bulk` | N× per-stream calls; pool exhaustion | **931ms / 1.16s** | Single bulk path replaces N calls |
| `GET /runtime/streams/{id}/stats-health` | Seconds-level under load | **87ms / 112ms** | 24h-bounded aggregates |
| `GET /runtime/operational-snapshot` | 9s+ `slow_sql_critical` | **47ms / 103ms** | `_fetch_last_outcomes` 24h + scoped |
| `GET /runtime/dashboard/summary` | Timeout under fan-out | **547ms / 674ms** | validation_runs trend scoped |
| `GET /runtime/health/overview` | Multi-second, pool contention | **1.13s / 1.72s** | 24h clamp; still heaviest read |
| `GET /runtime/streams/{id}/metrics` | Variable | **304ms / 474ms** | Bounded window reads |
| `GET /connectors/operations-summary` | Repeated full scans | **450ms / 682ms** | TTL cache (20s) |

Post-redeploy spot check (5 min UI loop): `operational-snapshot` 38–484ms (typical 40–70ms), bulk stats-health **250ms**.

---

## 6. 운영 안정성 검증 결과

| Item | Value |
|------|-------|
| **시작** | 2026-06-22 02:01:36 UTC |
| **종료** | 2026-06-22 02:14:12 UTC |
| **지속** | **12분 36초** |
| **라운드** | **20** (30s interval) |
| **시나리오** | Dashboard ↔ Streams ↔ Runtime detail ↔ Route Processing ↔ Connectors (auto-refresh 포함) |

### Resource metrics

| Metric | Start | Avg | Max | End |
|--------|-------|-----|-----|-----|
| API RSS | 210.9 MiB | 215.4 MiB | **222.4 MiB** | 220.2 MiB |
| Postgres RSS | 256.1 MiB | 259.0 MiB | 260.5 MiB | 260.2 MiB |
| Swap | 989 MiB | — | — | **989 MiB** (no increase) |

### UI pages (all HTTP 200)

| Page | avg | max |
|------|-----|-----|
| `/monitoring` (Dashboard) | 3ms | 5ms |
| `/streams` | 4ms | 31ms |
| `/streams/1/runtime` | 3ms | 3ms |
| `/streams/1/edit` (Route Processing) | 3ms | 5ms |
| `/connectors` | 4ms | 23ms |

---

## 7. timeout / OOM / slow_sql_critical 결과

| Check | Count | Pass |
|-------|------:|------|
| `timeout` (API logs) | **0** | ✅ |
| OOM / out-of-memory | **0** | ✅ |
| `slow_sql_critical` | **0** | ✅ |
| `slow_sql_warning` (soak window) | **0** | ✅ |
| API RSS ≤ 1 GiB | max **222 MiB** | ✅ |
| Swap increase | **none** | ✅ |

---

## 8. 테스트 결과 (automated)

Commit-time focused pytest (stability-related modules): **35 passed** in 43.56s.

```bash
TEST_DATABASE_URL=postgresql://gdc:gdc@127.0.0.1:55441/gdc_pytest \
  python3 -m pytest \
  tests/test_runtime_stats_health_bulk.py \
  tests/test_health_repository_aggregates.py \
  tests/test_operational_last_outcomes.py \
  tests/test_validation_ops_read.py \
  tests/test_connectors_read_cache.py \
  tests/test_connector_operations_summary.py \
  tests/test_runtime_metrics.py \
  -q
```

Frontend `requestCache.test.ts`: **4 passed** in 6.09s.

Soak measurement artifacts (not committed): `/tmp/gdc-stability-verify.log`, `/tmp/gdc-stability-timing.csv`, `/tmp/gdc-stability-metrics.csv`.

---

## 9. 남은 병목 또는 후속 작업

| Priority | Item | Notes |
|----------|------|-------|
| P2 | `health/overview` latency | Soak p95 **1.53s** — acceptable but heaviest dashboard read; further snapshot offload candidate |
| P2 | `stats-health/bulk` p95 **1.12s** | Stable; tune cache TTL or SQL if stream count >> 200 |
| P3 | Long-window analytics charts | Phase 6 bucket tables (`runtime_analytics_bucket_*`) — see `docs/performance/high-scale-runtime-analytics-phase-6.md` |
| P3 | Formal 24h soak | Run `scripts/ops/collect-soak-metrics.sh --duration 24h` on release host |
| P3 | Frontend container redeploy | Host `frontend/` changes require `scripts/frontend-redeploy.sh` for live UI bundle |

---

## 10. Related documentation

- `docs/performance/high-scale-runtime-analytics-phase-6.md`
- `docs/performance/runtime-legacy-aggregate-migration-phase-5.md`
- `docs/release/oss-v102-release-hardening-report.md` (prior `slow_sql_critical` on `_fetch_last_outcomes`)
- `docs/performance/performance-p1-optimization-report.md` (Streams Console fan-out)

---

## Final Verdict

```
RUNTIME API STABILITY — PASS (dev platform, 12m 36s operational soak)
```

Timeout, OOM, and `slow_sql_critical` did not recur under repeated operational navigation. API memory remained bounded (max 222 MiB RSS).
