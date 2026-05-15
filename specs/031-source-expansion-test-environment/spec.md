# 031 Source expansion test environment

## Purpose

Define **isolated Docker-backed test infrastructure** and **fixture contracts** for automated validation of **DATABASE_QUERY**, **REMOTE_FILE_POLLING**, and **Data Backfill** behavior (`specs/028-database-query-source/spec.md`, `specs/029-remote-file-polling-source/spec.md`, `specs/030-data-backfill/spec.md`). This spec is **infrastructure and test-matrix authority only**: it does not change runtime semantics, StreamRunner transaction ownership, or checkpoint-after-delivery rules (`specs/002-runtime-pipeline/spec.md`, `.specify/memory/constitution.md`).

## Non-goals

- Replacing or merging with `specs/018-continuous-test-environment/spec.md` WireMock/pytest stack (orthogonal; may share patterns only).
- Defining product APIs, UI copy, or Alembic migrations for backfill persistence.
- Using SQLite or any non-PostgreSQL engine for the **GDC platform application database** (constitution: PostgreSQL only for platform).

## Architecture alignment

- **Connector ≠ Stream ≠ Source ≠ Destination**; tests configure sources/streams against **isolated fake customer systems** (MySQL/MariaDB/Postgres query targets, SFTP/SCP hosts), not the platform catalog as a data plane unless explicitly a control-plane test.
- **Checkpoint updates only after successful destination delivery** remains the product rule; tests assert observable outcomes (including negative cases where checkpoint must **not** advance).
- **Mapping before enrichment** in the pipeline under test; test harness may use stub destinations or webhook sinks consistent with `specs/004-delivery-routing/spec.md`.

---

## A. DATABASE_QUERY tests

### A.1 Docker services (isolated)

| Service name (compose) | Role |
| --- | --- |
| `postgres-query-test` | PostgreSQL wire target for `db_type: POSTGRESQL` adapter tests. |
| `mysql-query-test` | MySQL wire target for `db_type: MYSQL` adapter tests. |
| `mariadb-query-test` | MariaDB wire target for `db_type: MARIADB` adapter tests. |

Each service must use a **dedicated image**, **non-default host ports** (avoid clashing with developer `5432` / `3306`), **named volumes scoped to this compose project**, and credentials **distinct from any production or platform database**. These containers simulate **customer databases** read by DATABASE_QUERY sources; they are **not** the GDC platform PostgreSQL.

### A.2 Seed data (relational)

Idempotent seed scripts (see **D. Scripts**) must create and populate at minimum:

| Table | Purpose |
| --- | --- |
| `security_events` | Primary fact table for incremental checkpoints (timestamp and numeric ID columns), normal rows, and boundary values. |
| `audit_logs` | Secondary table for cross-table query or join scenarios if needed by implementation. |
| `waf_events` | WAF-shaped rows for parser/type coercion and malformed cell injection. |

Seeds must be **repeatable** (`CREATE IF NOT EXISTS` / `INSERT … ON CONFLICT` or truncate of **fixture schema only** inside the test DB, never platform DB).

### A.3 Required test cases (DATABASE_QUERY)

| Case | Expectation (normative) |
| --- | --- |
| **Timestamp checkpoint** | Watermark advances on monotonic timestamp column; no duplicate delivery across runs when `max_rows_per_run` respected. |
| **Numeric ID checkpoint** | Same as above for monotonic integer/bigint key column. |
| **Empty result** | Run completes; no events; checkpoint unchanged unless product explicitly documents otherwise for `NONE` mode (align with 028). |
| **Malformed row values** | Row skipped or error surfaced per strict/lenient policy; structured failure; checkpoint obeys delivery rule. |
| **`max_rows_per_run` rollover** | Multiple runs drain backlog; each run capped; eventual consistency without overrun. |
| **Connection failure** | Transient disconnect or refused port yields retriable/structured error; no partial checkpoint advance on undelivered work. |
| **Invalid credentials** | Auth failure; clear error; no data read. |
| **Query timeout** | Statement exceeds bound; run fails safely; no checkpoint advance for undelivered batch. |
| **Non-SELECT rejection** | Mutating or multi-statement SQL rejected at validation or execution guard per 028 safety rules. |

---

## B. REMOTE_FILE_POLLING tests

### B.1 Docker services (isolated)

| Service name (compose) | Role |
| --- | --- |
| `sftp-test` | OpenSSH (or equivalent) with SFTP subsystem enabled; seeded home or chroot with `/data` tree. |
| `ssh-scp-test` | SSH with SCP enabled; may share image with SFTP if documented; distinct hostname/keys from `sftp-test` for host-key isolation cases. |

Host keys, user accounts, and data roots must be **fixture-only**. No trust-on-first-use against real operator keys unless documented as lab-only.

### B.2 Seed files (remote layout)

Under a consistent root (e.g. `/data` in container):

| Path | Content |
| --- | --- |
| `/data/security/events-001.ndjson` | Valid NDJSON lines for `parser_type: NDJSON`. |
| `/data/security/events-002.json` | JSON array document for `parser_type: JSON_ARRAY`. |
| `/data/waf/waf-sample.csv` | CSV with header row for `parser_type: CSV`. |
| `/data/raw/app.log` | Plain line-delimited text for `parser_type: LINE_DELIMITED_TEXT`. |
| **Malformed files** | Intentionally broken JSON lines, bad CSV quoting, invalid UTF-8 blob (document expected behavior: skip vs fail). |
| **Empty files** | Zero-byte or whitespace-only files; no events; stable checkpoint behavior. |
| **Rotated files** | Same logical stream with suffix rotation (`app.log`, `app.log.1`) or timestamped names; tests cover discovery order and idempotency. |

### B.3 Required test cases (REMOTE_FILE_POLLING)

| Case | Expectation (normative) |
| --- | --- |
| **SFTP list/fetch** | List + stat + read path exercised; partial reads if implementation supports ranged reads. |
| **SCP fetch** | Full-file copy path validated per 029 constraints (document if listing requires SFTP fallback). |
| **File pattern matching** | Glob include/exclude semantics match stream `file_pattern`. |
| **Recursive directory scan** | `recursive: true` discovers nested paths; false limits to root. |
| **NDJSON parsing** | One object per line; empty lines ignored; strict vs lenient aligns with product policy. |
| **JSON array parsing** | Array expansion to events. |
| **CSV parsing** | Header map and row objects. |
| **Line text parsing** | Raw line as payload or wrapped event per adapter contract. |
| **Checkpoint by file/mtime/offset/hash** | All supported checkpoint dimensions from 029 have at least one deterministic test (which dimensions are MVP must be listed in adapter README when implementation lands). |
| **Deleted-before-fetch handling** | File disappears after list; structured error; no silent skip of delivered obligation. |
| **Overwrite detection** | Same path, changed mtime/size/hash; behavior matches spec (re-ingest vs ignore). |
| **Host key failure** | Strict known_hosts mismatch fails closed; no credential leak in logs. |
| **Invalid credentials** | Auth failure; no partial file reads counted as success. |

---

## C. Backfill tests

### C.1 Seed scenarios

| Scenario | Description |
| --- | --- |
| **Historical DB rows** | Pre-seeded ranges in `postgres-query-test` / `mysql-query-test` / `mariadb-query-test` older than “runtime” watermark. |
| **Old remote files** | Files with mtimes outside default runtime window; under `/data/...` on SFTP/SCP fixtures. |
| **Old S3 objects** | Optional when MinIO or compatible bucket is added to this stack: objects with last-modified outside window (align `specs/025-s3-object-polling-ui/spec.md` / `docs/sources/s3-object-polling.md`). |
| **Active runtime checkpoint already exists** | Stream has non-trivial production checkpoint in **test catalog DB** (isolated); backfill must not clobber it by default (`specs/030-data-backfill/spec.md`). |

### C.2 Required test cases (backfill)

| Case | Expectation (normative) |
| --- | --- |
| **Dry run** | Fetch + map + enrich + format **without** destination side effects and **without** runtime checkpoint mutation. |
| **Preview count** | Read-only estimate returned; execute blocked or confirmation required when zero events per 030. |
| **Execute backfill** | Full delivery path; **separate** backfill cursor; correlates with `backfill_run_id` in logs. |
| **Cancel backfill** | Cooperative cancel between batches; status `CANCELLED`; partial work auditability. |
| **Checkpoint not overwritten by default** | After backfill, stream runtime checkpoint equals pre-backfill watermark when merge disabled. |
| **Explicit checkpoint update requires admin confirmation** | Merge path only with Administrator + typed confirmation + audit entry (030). |
| **Backfill logs separated from runtime logs** | No mixing into runtime `delivery_logs`; backfill persistence or channel is distinct. |

---

## D. Scripts (planned)

All paths are **normative targets** for implementation; scripts must be executable, idempotent where stated, and callable from CI and local dev.

| Script | Responsibility |
| --- | --- |
| `scripts/testing/source-expansion/start-source-test-stack.sh` | `docker compose` up for query + remote fixtures; wait-for-healthy; print connection parameters (host ports, users) for test env only. |
| `scripts/testing/source-expansion/stop-source-test-stack.sh` | Compose down; optional `--volumes` gated by **E. Safety**. |
| `scripts/testing/source-expansion/seed-database-fixtures.sh` | Apply SQL seeds to **query-test** databases only; idempotent. |
| `scripts/testing/source-expansion/seed-remote-file-fixtures.sh` | Copy or generate fixture tree into SFTP/SCP volumes; idempotent. |
| `scripts/testing/source-expansion/run-source-expansion-e2e.sh` | Run pytest or equivalent E2E suite against the stack; non-zero exit on failure. |

Compose file name and location (e.g. `docker-compose.source-expansion-test.yml` at repo root) are **implementation choices** but must be referenced from the start/stop scripts once added.

---

## E. Safety

| Rule | Detail |
| --- | --- |
| **Isolated containers and databases** | All services in this spec run under a dedicated compose project name and network; no host filesystem mounts to production data directories. |
| **Must not touch production/platform DB** | GDC application PostgreSQL (`DATABASE_URL` for the app) must never be targeted by seed scripts. Test catalog for stream definitions may use a **separate** test-only Postgres instance or documented test profile—never operator production. |
| **Must not reuse `gdc` or `gdc_test` unless explicitly documented** | Default database names, users, and compose project names must differ (e.g. `gdc_source_expansion_*`). Any exception requires a bold **EXCEPTION** subsection with owner approval and CI guardrails. |
| **Destructive reset requires explicit confirmation** | `stop-source-test-stack.sh --volumes` or similar must prompt or require `CONFIRM=1`; document in script `--help`. |
| **Idempotent seeds** | Re-running seed scripts on a healthy stack leaves fixture state consistent without duplicate key explosions or unbounded growth (use fixed surrogate keys or TRUNCATE only fixture tables). |

---

## References

- `specs/028-database-query-source/spec.md`
- `specs/029-remote-file-polling-source/spec.md`
- `specs/030-data-backfill/spec.md`
- `specs/018-continuous-test-environment/spec.md` (parallel continuous test stack)
- `specs/002-runtime-pipeline/spec.md`
- `specs/004-delivery-routing/spec.md`
- `.specify/memory/constitution.md`
