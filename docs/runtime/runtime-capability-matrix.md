# Runtime capability vs seed / validation dataset

This document separates **what the runtime can execute today** (StreamRunner + source/destination adapters) from **where rows in the database came from** (bundled demo seed vs development validation lab). It is an operational clarity guide only — it does not add new adapters or change runner semantics.

**Authority:** Subordinate to [`docs/canonical/03-RUNTIME-RELIABILITY.md`](../canonical/03-RUNTIME-RELIABILITY.md). If this matrix disagrees with canonical, canonical wins.

**Related**

- `app/sources/adapters/registry.py` — source dispatch by `source_type`
- `app/destinations/adapters/registry.py` — destination dispatch by `destination_type`
- `app/runners/webhook_receiver.py` — inbound webhook HTTP ingest → StreamRunner
- `app/db/seed.py` — bundled **create-only** demo graph (`Sample API Connector`, …)
- `app/dev_validation_lab/seeder.py`, `templates.py` — lab fixtures (`[DEV VALIDATION] …` prefix)

---

## Runtime-supported source types

All of the following are registered in `SourceAdapterRegistry` and invoked from `StreamRunner` via the linked source row’s **`source_type`** (not the stream name).

| `source_type` | Status | Notes |
|---------------|--------|--------|
| `HTTP_API_POLLING` | **IMPLEMENTED** (primary path) | Default UI and lab HTTP fixtures; uses `HttpApiSourceAdapter`. |
| `S3_OBJECT_POLLING` | **IMPLEMENTED** (extended) | Uses `S3ObjectPollingAdapter` (e.g. AWS S3, MinIO). Requires valid object-store config and network reachability. |
| `DATABASE_QUERY` | **PARTIAL** (extended) | Uses `DatabaseQuerySourceAdapter` / SELECT safeguards. Production path is PostgreSQL-centric; requires DB connectivity and correct SQL + checkpoint fields. |
| `REMOTE_FILE_POLLING` | **IMPLEMENTED** (extended) | Uses `RemoteFilePollingAdapter` (SFTP-based SSH access; optional SFTP-compatible SCP byte transfer). Requires SSH reachability and path/pattern config. |
| `WEBHOOK_RECEIVER` | **IMPLEMENTED** | Registered as `WEBHOOK_RECEIVER` (aliases `WEBHOOK`, `WEBHOOK_PUSH`). Inbound HTTP is handled by `app/runners/webhook_receiver.py` (auth, size limits, payload attach); `WebhookReceiverSourceAdapter` returns the already-validated payload into the normal StreamRunner pipeline. Not a polling source. |
| `AI_PROXY_RECEIVER` | **OUT_OF_SCOPE** | May appear in legacy code paths; not current OSS product scope. |

Inbound **SYSLOG_RECEIVER** as a first-class source adapter remains **TARGET** (see canonical 03).

---

## Runtime-supported destination types

| `destination_type` | Status | Notes |
|--------------------|--------|--------|
| `WEBHOOK_POST` | **IMPLEMENTED** | Supports `PERSISTENT_QUEUE` when stream reliability mode enables it. |
| `SYSLOG_UDP` | **IMPLEMENTED** | |
| `SYSLOG_TCP` | **IMPLEMENTED** | Supports `PERSISTENT_QUEUE` when stream reliability mode enables it. |
| `SYSLOG_TLS` | **IMPLEMENTED** | |
| `AI_PROVIDER_POST` | **OUT_OF_SCOPE** | Code may exist; not current OSS product scope. |

---

## Reliability capability (do not over-claim)

Aligned with [`docs/canonical/03-RUNTIME-RELIABILITY.md`](../canonical/03-RUNTIME-RELIABILITY.md):

| Capability | Status | Notes |
|---|---|---|
| `DIRECT` | **IMPLEMENTED** (default) | Lightweight immediate processing/delivery path. |
| `PERSISTENT_QUEUE` | **IMPLEMENTED** only for supported delivery paths | Platform durable delivery for **`WEBHOOK_POST` + `SYSLOG_TCP`** when configured (`reliability_mode == PERSISTENT_QUEUE`). Do not generalize to all sources/destinations. |
| `MEMORY_BUFFER` | **TARGET** | In-memory burst buffering; not durable across restart. |
| `EXTERNAL_BUFFER` | **TARGET** | Durability owned by an external buffering system. |
| Circuit Breaker | **IMPLEMENTED** | Process-local destination circuit breaker (`app/delivery/circuit_breaker.py`). |
| Adaptive Concurrency | **IMPLEMENTED** | Opt-in destination adaptive concurrency (`app/delivery/adaptive_concurrency.py`). |
| Backpressure | **IMPLEMENTED** | Queue operational protection for durable-queue paths (`app/delivery_queue/backpressure.py`). |
| Source Rate Limiter | **IMPLEMENTED** | Source request admission over time (`app/rate_limit/source_limiter.py`). |

Delivery where persistent queue applies remains **at-least-once**. Exactly-once must not be promised.

---

## Bundled demo seed (database provenance)

**Created by:** `python -m app.db.seed` (default mode, not `--platform-admin-only`).

**Intent:** Create-only sample rows so a fresh catalog has one end-to-end HTTP → mapping → enrichment → webhook route → checkpoint example.

| Entity | Typical name / pattern | Runtime? |
|--------|-------------------------|----------|
| Connector | `Sample API Connector` | Rows are normal DB rows; **runtime executes** if upstream URL and auth work. |
| Stream | `Sample Alerts Stream` | **HTTP_API_POLLING** — same as any user-defined HTTP stream. |
| Destination | `Sample Webhook Destination` | **WEBHOOK_POST** — requires reachable webhook URL. |

These are **“demo seed”** in **origin** only — they are not a separate execution engine.

---

## Development validation lab dataset (database provenance)

**Created when:** `ENABLE_DEV_VALIDATION_LAB` is enabled (non-production `APP_ENV`), lab seeder runs.

**Naming:** Most lab entities use the prefix **`[DEV VALIDATION] `** (`app/dev_validation_lab/templates.py` — `LAB_NAME_PREFIX`). The visible E2E fixture seed uses **`[DEV E2E] `** (`app/dev_validation_lab/visible_e2e_seed.py`); the UI treats both prefixes as lab/fixture provenance (see `frontend/src/utils/devValidationLab.ts`).

**Intent:** Synthetic traffic against WireMock, test webhooks/syslog receivers, optional MinIO/S3, optional DB-query and remote-file paths when feature flags and credentials allow.

| Lab area | Typical `source_type` | Runtime? |
|----------|----------------------|----------|
| HTTP WireMock streams | `HTTP_API_POLLING` | Supported; depends on lab network (e.g. WireMock container). |
| S3 / MinIO (if enabled) | `S3_OBJECT_POLLING` | Supported when `ENABLE_DEV_VALIDATION_S3` + credentials; extended adapter. |
| DB query (if enabled) | `DATABASE_QUERY` | Supported when `ENABLE_DEV_VALIDATION_DATABASE_QUERY` + DB config; extended adapter. |
| Remote file (if enabled) | `REMOTE_FILE_POLLING` | Supported when `ENABLE_DEV_VALIDATION_REMOTE_FILE` + SSH; extended adapter. |

Lab rows are **fixtures**, not “fake” streams — if prerequisites are missing, runs fail at fetch time like any misconfigured stream.

---

## UI labels (operational)

The Operations UI shows small **capability / provenance** badges derived from stream name and configured source type:

- **Runtime supported** — HTTP API polling (primary path).
- **Runtime supported · extended** — S3 / database / remote file (same pipeline, extra operational prerequisites).
- **Demo seed** — stream name matches the bundled demo stream from `app/db/seed.py`.
- **Lab fixture** — stream name starts with `[DEV VALIDATION] ` or `[DEV E2E] `.

These labels clarify **dataset origin** and **adapter tier**; they do not turn off the real runtime.

---

## Dev validation lab — runtime validation depth (by stream)

Seeded when `ENABLE_DEV_VALIDATION_LAB` is on (see `app/dev_validation_lab/seeder.py`). Full semantics for OAuth2 vs JWT refresh: **`docs/testing/dev-validation-oauth2-runtime.md`**.

| Stream name (after `[DEV VALIDATION] ` prefix) | `source_type` | Real `StreamRunner`? | OAuth2 / token notes |
|------------------------------------------------|---------------|----------------------|----------------------|
| `Stream OAuth2 client-credentials` | `HTTP_API_POLLING` | Yes — full | Client-credentials **token POST every poll**; not static bearer. |
| `Stream OAuth2 refresh-cycle (JWT token URL)` | `HTTP_API_POLLING` | Yes — full | **`jwt_refresh_token`** token URL + `access_token` JSON — **not** OAuth2 refresh_token grant. |
| `Stream OAuth2 token-exchange-failure` | `HTTP_API_POLLING` | Yes — fetch fails | Token URL returns 401; mapping/delivery not reached. |
| `Stream s3-basic` | `S3_OBJECT_POLLING` | Yes — when `ENABLE_DEV_VALIDATION_S3` + MinIO | Static access keys in fixture config (not OAuth2). |
| `Stream db-query-basic` | `DATABASE_QUERY` | Yes — when DB flag + PostgreSQL fixture DB is up | DB user/password auth. |
| `Stream remote-file-basic` / `Stream remote-file-scp-json` | `REMOTE_FILE_POLLING` | Yes — when remote flag + SSH/SFTP fixture is up | Password auth to fixture containers. |

**OAuth2 RFC `refresh_token` rotation:** Authorization-code credentials
(`OAUTH2_AUTHORIZATION_CODE`) support access/refresh lifecycle with rotation and
row-locked concurrent refresh — see `app/credentials/oauth2_auth_code.py`. Lab
HTTP streams above still use client-credentials / JWT-refresh strategies only.

---

## Remaining gaps (no new work in this task)

- **MEMORY_BUFFER** / **EXTERNAL_BUFFER** reliability modes — still **TARGET**.
- **Inbound SYSLOG_RECEIVER** as a first-class source type — **TARGET**.
- Deeper Marketplace content validators (M29.4 remainder) and remote/Git acquisition SSRF policy (M29.5B) — see canonical 04; not part of this matrix.
- Any **future** destination or auth modes must be added to registries and documented here when shipped.
