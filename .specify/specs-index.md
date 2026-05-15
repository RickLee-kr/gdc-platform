# Spec Index

## 001 Core Architecture
Path: `specs/001-core-architecture/spec.md`

Defines:
- Connector / Source / Stream / Destination / Route separation
- Core platform boundaries
- MVP architecture constraints

## 002 Runtime Pipeline
Path: `specs/002-runtime-pipeline/spec.md`

Defines:
- Stream runtime execution
- Polling pipeline
- Mapping / Enrichment / Fan-out / Checkpoint order
- Failure behavior

## 003 DB Model
Path: `specs/003-db-model/spec.md`

Defines:
- Connector, Source, Stream, Mapping, Enrichment, Destination, Route, Checkpoint, Log models
- DB relationship rules

## 004 Delivery Routing
Path: `specs/004-delivery-routing/spec.md`

Defines:
- Multi destination routing
- Syslog/Webhook delivery
- Route failure policy
- Destination rate limit

## 005 WireMock integration tests
Path: `specs/005-wiremock-integration/spec.md`

Defines:
- Docker Compose profile `test` WireMock for connector/stream HTTP integration tests
- Stub validation rules for SER-style `_search` without unsafe pagination query params

## 006 Message prefix (delivery)
Path: `specs/006-message-prefix-delivery/spec.md`

Defines:
- Optional route-level prefix before wire send (`prefix + space + compact JSON`)
- Defaults by destination type (Syslog on, Webhook off) and default template string

## 007 Message prefix variables
Path: `specs/007-message-prefix-variables/spec.md`

Defines:
- Message prefix template variables for delivery previews

## 008 Webhook payload mode
Path: `specs/008-webhook-payload-mode/spec.md`

Defines:
- `payload_mode` on WEBHOOK_POST destination config (`SINGLE_EVENT_OBJECT` vs `BATCH_JSON_ARRAY`)
- Default single-object delivery for SIEM/XDR-friendly JSON

## 009 Session login HTTP
Path: `specs/009-session-login-http/spec.md`

Defines:
- Session login body modes (JSON / form_urlencoded / raw)
- Login redirect and URL failure validation
- Probe-based auth success criteria for HTTP session connectors

## 010 Checkpoint trace
Path: `specs/010-checkpoint-trace/spec.md`

Defines:
- Structured checkpoint tracing in delivery_logs
- Checkpoint trace read APIs
- Correlation with route failures and run_id

## 011 Runtime analytics
Path: `specs/011-runtime-analytics/spec.md`

Defines:
- Read-only route failure and retry analytics over delivery_logs
- Default 24h window and optional filters

## 012 Runtime health scoring
Path: `specs/012-runtime-health-scoring/spec.md`

Defines:
- Deterministic operational health scoring for streams, routes, destinations
- 0-100 score with HEALTHY/DEGRADED/UNHEALTHY/CRITICAL levels
- Read-only health endpoints reusing delivery_logs aggregates
- UI extension for the existing Runtime Analytics page

## 013 Template connector system (Phase 1)
Path: `specs/013-template-connector-system/spec.md`

Defines:
- Filesystem-backed template registry (not runtime entities)
- Template list/detail/instantiate APIs
- Instantiation creates Connector/Source/Stream/Mapping/Enrichment/Checkpoint/optional Route only

## 014 WireMock template E2E
Path: `specs/014-wiremock-template-e2e/spec.md`

Defines:
- Opt-in pytest coverage for template instantiate + run-once against WireMock stubs
- Extended mappings for generic REST, Stellar Malop, Okta System Log, webhook receivers, and failure/retry scenarios
- Assertions for delivery_logs, checkpoints, analytics, and health without UI automation
- Regression markers, shell scripts under `scripts/test-e2e-*.sh`, and operator notes in `docs/testing/e2e-regression.md`

## 018 Continuous test environment (dev infra)
Path: `specs/018-continuous-test-environment/spec.md`

Defines:
- Isolated `docker-compose.test.yml` stack for pytest/CI (PostgreSQL, WireMock, optional echo/syslog listeners, pytest-runner image)
- `scripts/testing/` entry points, `.test-history/` local artifacts, and GitHub Actions split across focused/smoke/regression workflows
- Operator documentation under `docs/testing/continuous-test-environment.md` and `docs/testing/regression-policy.md`

## 036 Source adapter E2E
Path: `specs/036-source-adapter-e2e/spec.md`

Defines:

- Opt-in pytest `source_e2e` coverage for `S3_OBJECT_POLLING`, `DATABASE_QUERY`, and `REMOTE_FILE_POLLING` against MinIO, `postgres-query-test`, and `sftp-test` in `docker-compose.test.yml`
- Seed script `scripts/testing/source-e2e/seed-fixtures.sh` and runner `scripts/test/run-source-e2e-tests.sh`
- Operator notes in `docs/testing/source-adapter-e2e.md`

## 037 Visible dev E2E UI fixtures
Path: `specs/037-visible-dev-e2e-fixtures/spec.md`

Defines:

- Optional idempotent seed for UI-visible `[DEV E2E] ` catalog entities (all supported sources + local destinations)
- Script `scripts/dev-validation/seed-visible-e2e-fixtures.sh` and implementation `app/dev_validation_lab/visible_e2e_seed.py`
- Operator notes in `docs/testing/visible-dev-e2e-fixtures.md`

## 038 Release candidate deployment packaging
Path: `specs/038-release-candidate-deployment/spec.md`

Defines:

- `scripts/release/` install, upgrade, backup, restore, and self-signed TLS helpers
- CI validation workflows (`backend-tests`, `frontend-tests`, `docker-validate`)
- English operator documentation under `docs/deployment/` for RC installs

## 032 Dev validation lab source expansion
Path: `specs/032-dev-validation-lab-source-expansion/spec.md`

Defines:
- Optional `ENABLE_DEV_VALIDATION_*` slices for S3, relational query sources, and remote file polling inside the dev validation lab
- Fixture containers (`minio-test`, `postgres-query-test`, `mysql-query-test`, `mariadb-query-test`, `sftp-test`, `ssh-scp-test`) in `docker-compose.test.yml` (core fixtures also on the `test` profile for `source_e2e`; MySQL/MariaDB remain `dev-validation`-only)
- Seed scripts under `scripts/testing/source-expansion/` and UI/scheduler gates that skip disabled slices

## 016 Continuous validation
Path: `specs/016-continuous-validation/spec.md`

Defines:

- StreamRunner-backed synthetic operational validation
- `continuous_validations` and `validation_runs` persistence
- Independent scheduler and REST control plane
- Operator notes in `docs/testing/continuous-validation.md`

## 017 Validation alerting
Path: `specs/017-validation-alerting/spec.md`

Defines:

- Deduped `validation_alerts` and `validation_recovery_events`
- Async outbound notifications (generic, Slack-compatible, PagerDuty v2)
- Read-only runtime/dashboard integration
- Operator notes in `docs/testing/validation-alerting.md`

## 020 Session/JWT authentication
Path: `specs/020-jwt-session-auth/spec.md`

Defines:

- Real local JWT authentication replacing the temporary `X-GDC-Role` header trust
- Access/refresh token pair, `token_version` invalidation, `Authorization: Bearer`
- `/auth/login`, `/auth/refresh`, `/auth/logout`, `/auth/whoami` APIs
- Frontend session storage, automatic refresh on 401, login redirect on expiry

## 021 HTTPS reverse proxy runtime
Path: `specs/021-https-reverse-proxy/spec.md`

Defines:

- nginx reverse proxy as single browser entrypoint; API remains HTTP-only internally
- Admin Settings drives TLS material, nginx config render, optional reload, HTTP fallback
- Docker Compose `docker-compose.platform.yml`, optional `deploy/docker-compose.https.yml`, and internal reload hook

## 015 Backup, export, import (Phase 1)
Path: `specs/015-backup-export-import/spec.md`

Defines:

- JSON export/import for connectors, streams, and workspace snapshots (masked secrets)
- Import preview with conflict detection; additive and clone apply modes (no destructive merge)
- Clone connector/stream configuration (new IDs, streams disabled by default)

## 024 Syslog TLS destination
Path: `specs/024-syslog-tls-destination/spec.md`

Defines:

- New `SYSLOG_TLS` destination type for runtime delivery (RFC5425-style TCP+TLS)
- Destination configuration fields for TLS material and verification modes
- Sender/probe behavior with optional SNI and mutual auth, retaining existing route retry/checkpoint semantics
- UI/visibility additions; explicitly does not touch the browser HTTPS reverse proxy

## 025 S3 object polling — UI and validation
Path: `specs/025-s3-object-polling-ui/spec.md`

Defines:

- S3_OBJECT_POLLING connector and stream wizard fields (including `max_objects_per_run`)
- S3 connectivity probe semantics (no secret exposure)
- Alignment with checkpoint-after-delivery and English-only product language

## 027 Maintenance Center (admin health)
Path: `specs/027-maintenance-center/spec.md`

Defines:

- Read-only `GET /api/v1/admin/maintenance/health` (Administrator JWT only)
- Aggregated OK/WARN/ERROR notices plus structured panels (DB, Alembic, schedulers, retention, disk, destinations, TLS, failures, support bundle shortcut)
- No checkpoint or data mutations; masked secrets in failure payloads

## 028 Database query source (roadmap)
Path: `specs/028-database-query-source/spec.md`

Defines:

- `DATABASE_QUERY` source type for PostgreSQL, MySQL, and MariaDB
- Connection and stream field contracts, row-to-event conversion, incremental checkpoint payload fields
- SELECT-only and safety constraints; adapter isolation; test strategy

## 029 Remote file polling source (roadmap)
Path: `specs/029-remote-file-polling-source/spec.md`

Defines:

- `REMOTE_FILE_POLLING` over SFTP and SCP
- Connection and stream fields, parser matrix (NDJSON, JSON array/object, CSV, line-delimited text)
- File checkpoint fields, mutation handling, security, test strategy

## 030 Data backfill (roadmap)
Path: `specs/030-data-backfill/spec.md`

Defines:

- Operator **Data Backfill** workflow separate from runtime polling
- Preview, dry run, execute, progress, audit log; route policy reuse; isolated backfill logs
- Checkpoint protection (no overwrite of runtime checkpoint by default; optional admin-confirmed merge)
- Initial targets: `DATABASE_QUERY`, `REMOTE_FILE_POLLING`, `S3_OBJECT_POLLING`

## 033 Data backfill runtime architecture
Path: `specs/033-data-backfill-runtime/spec.md`

Defines:

- **BackfillRuntimeCoordinator** isolation from **StreamRunner** scheduling semantics
- `backfill_jobs` persistence, checkpoint snapshot + ephemeral state rules (`EXPLICIT_ONLY` merge policy placeholder)
- Backfill modes registry (`CHECKPOINT_REWIND`, `TIME_RANGE_REPLAY`, `OBJECT_REPLAY`, `FILE_REPLAY`, `INITIAL_FILL`) and source-strategy placeholders
- REST foundation: `POST/GET /api/v1/backfill/jobs`
- Phase 2 scope notes (worker, backfill logs, stream lock, cancellation, delivery correlation, checkpoint commit policy)
- Complements the operator workflow roadmap in `specs/030-data-backfill/spec.md`

## 034 Operational data retention (PostgreSQL)
Path: `specs/034-data-retention/spec.md`

Defines:

- Lightweight batched cleanup for `delivery_logs`, validation metrics tables, validation perf snapshots, and backfill job/event tables
- `GET/POST /api/v1/retention/*` preview and execution APIs (operator/administrator roles)
- Optional daily supplement scheduler thread (no Celery/Kafka/Redis)
- `platform_retention_policy.operational_retention_meta` JSONB throttle metadata

## 035 RBAC-lite (JWT roles)
Path: `specs/035-rbac-lite/spec.md`

Defines:

- Centralized `evaluate_http_access` rules for Administrator / Operator / Viewer
- Viewer read-only monitoring plus preview-only runtime POST whitelist
- Administrator-only maintenance, support bundle, user admin, policy writes, import apply, snapshot apply
- Capabilities map on login / whoami for SPA alignment

## 039 Default admin bootstrap
Path: `specs/039-default-admin-bootstrap/spec.md`

Defines:

- Deterministic first-install `admin` / `admin` when `GDC_SEED_ADMIN_PASSWORD` is unset
- `must_change_password` persistence and JWT `mcp` gate until self-service password change
- `POST /api/v1/auth/change-password` for the authenticated user

## Database Policy

All database implementations must target PostgreSQL.
SQLite must not be used as a fallback.
All migrations, indexes, and query validation rules are PostgreSQL-based.

---

## Mapping UI UX Policy

MVP Mapping UI must provide a preview-first, non-developer-friendly workflow inspired by WebhookRelay-style payload preview UX.

MVP includes:

- JSON Tree Raw Payload Preview
- click-based JSONPath generation
- Mapping Table
- Raw / Mapped / Enriched Final Preview
- Final Preview matching actual destination payload

Phase 2 includes:

- JSON Tree to Mapping Table Drag & Drop
- duplicate mapping warning
- overwrite / append behavior

Drag & Drop is explicitly not part of MVP.

---

---

## UI/UX Philosophy

The platform UI must follow a modern SaaS observability/security operations dashboard style.

Required UX direction:

- Webhook Relay inspired operational UX
- Datadog / Grafana Cloud / Vercel style spacing and layout
- clean professional SaaS admin portal
- runtime visibility first
- dashboard-centric navigation
- responsive component-based frontend

Preferred frontend stack:

- React
- Tailwind CSS
- shadcn/ui
- lucide-react
- recharts

## Dashboard UX Principles

Dashboard is the operational center of the platform.

The first screen must show:

- runtime health overview
- active/error stream visibility
- delivery success/failure summary
- recent runtime activity
- connector health
- stream execution visibility
- route delivery visibility

Operators should understand platform health within 5 seconds.

## Global Navigation Structure

Primary sidebar navigation order:

1. Dashboard
2. Connectors
3. Sources
4. Streams
5. Mappings
6. Enrichments
7. Destinations
8. Routes
9. Runtime
10. Logs
11. Settings

Sidebar must remain persistent, collapsible, icon-based, and active-highlighted.

# English-Only Product Language Policy

## Language Policy

All project code, UI screens, labels, menus, buttons, placeholders, validation messages, API responses, logs, comments, documentation strings, seed/mock data, and Skill Spec content MUST be written in English only.

Korean or other non-English text is allowed only in external user communication, temporary Cursor prompts, or archived conversation notes. It MUST NOT be committed into product code, runtime UI, API schema, database seed data, tests, screenshots, or official project specifications.

Any new feature, refactor, UI change, or test must verify that user-facing and developer-facing product text remains English-only.

