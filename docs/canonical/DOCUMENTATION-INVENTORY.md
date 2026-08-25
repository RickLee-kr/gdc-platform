# Documentation Inventory (Phase 3)

**Document Version:** 3.0  
**Last Updated:** 2026-08-25  
**Status:** CANONICAL (Phase 3 reference surface reduction)  
**Scope:** `docs/`, `.specify/`, `specs/`  
**Rule:** Full path is identity. Specs paths unchanged. Phase 3 dispositions applied 2026-08-25.

## Category vocabulary

| Category | Meaning |
|---|---|
| `CANONICAL` | Top-level Documentation v2 authority under `docs/canonical/` |
| `REFERENCE_CURRENT` | Current detailed engineering reference **or** operator/QA runbook; subordinate to canonical |
| `HISTORICAL` | Point-in-time evidence/design snapshot; must not override canonical |
| `OUT_OF_SCOPE` | Outside current Data Relay OSS product scope |

Phase 3 disposition tags appear in `purpose` as `KEEP_REFERENCE`, `KEEP_RUNBOOK`, or fold/history notes.

## Summary counts

| Category | Count |
|---|---|
| `CANONICAL` | 12 |
| `REFERENCE_CURRENT` | 143 |
| — KEEP_REFERENCE (incl. hubs/pointers/specs) | 101 |
| — KEEP_RUNBOOK | 42 |
| `HISTORICAL` | 100 |
| `OUT_OF_SCOPE` | 6 |
| **Total inventoried** | **261** |

## Inventory table

| path | classification | canonical_parent | purpose |
|---|---|---|---|
| `docs/canonical/00-DOCUMENTATION-GOVERNANCE.md` | `CANONICAL` | docs/canonical/00-DOCUMENTATION-GOVERNANCE.md | Documentation v2 top-level authority |
| `docs/canonical/01-PRODUCT-CHARTER.md` | `CANONICAL` | docs/canonical/01-PRODUCT-CHARTER.md | Documentation v2 top-level authority |
| `docs/canonical/02-SYSTEM-ARCHITECTURE.md` | `CANONICAL` | docs/canonical/02-SYSTEM-ARCHITECTURE.md | Documentation v2 top-level authority |
| `docs/canonical/03-RUNTIME-RELIABILITY.md` | `CANONICAL` | docs/canonical/03-RUNTIME-RELIABILITY.md | Documentation v2 top-level authority |
| `docs/canonical/04-CONNECTORS-MARKETPLACE.md` | `CANONICAL` | docs/canonical/04-CONNECTORS-MARKETPLACE.md | Documentation v2 top-level authority |
| `docs/canonical/05-GOVERNANCE-SECURITY.md` | `CANONICAL` | docs/canonical/05-GOVERNANCE-SECURITY.md | Documentation v2 top-level authority |
| `docs/canonical/06-USER-EXPERIENCE.md` | `CANONICAL` | docs/canonical/06-USER-EXPERIENCE.md | Documentation v2 top-level authority |
| `docs/canonical/07-OPERATIONS-OBSERVABILITY.md` | `CANONICAL` | docs/canonical/07-OPERATIONS-OBSERVABILITY.md | Documentation v2 top-level authority |
| `docs/canonical/08-QUALITY-RELEASE.md` | `CANONICAL` | docs/canonical/08-QUALITY-RELEASE.md | Documentation v2 top-level authority |
| `docs/canonical/09-ROADMAP-CURRENT-STATE.md` | `CANONICAL` | docs/canonical/09-ROADMAP-CURRENT-STATE.md | Documentation v2 top-level authority |
| `docs/canonical/DOCUMENTATION-INVENTORY.md` | `CANONICAL` | docs/canonical/00-DOCUMENTATION-GOVERNANCE.md | Phase 2A inventory / classification authority map |
| `docs/canonical/DOCUMENTATION-MIGRATION-MAP.md` | `CANONICAL` | docs/canonical/00-DOCUMENTATION-GOVERNANCE.md | Phase 2A inventory / classification authority map |
| `docs/README.md` | `REFERENCE_CURRENT` | docs/canonical/00-DOCUMENTATION-GOVERNANCE.md | KEEP_REFERENCE (hub/pointer): Documentation entry point; not a parallel product authority |
| `docs/source-of-truth/README.md` | `REFERENCE_CURRENT` | docs/canonical/00-DOCUMENTATION-GOVERNANCE.md | KEEP_REFERENCE (hub/pointer): Compatibility pointer after SoT relocation |
| `docs/architecture/source-of-truth-index.md` | `REFERENCE_CURRENT` | docs/canonical/00-DOCUMENTATION-GOVERNANCE.md | KEEP_REFERENCE (hub/pointer): Compatibility pointer to canonical/README (folded authority) |
| `docs/architecture/OSS-v1-ARCHITECTURE.md` | `REFERENCE_CURRENT` | docs/canonical/02-SYSTEM-ARCHITECTURE.md | KEEP_REFERENCE (hub/pointer): Compatibility stub after Phase 3 fold; body in history |
| `docs/reference/README.md` | `REFERENCE_CURRENT` | docs/canonical/00-DOCUMENTATION-GOVERNANCE.md | KEEP_REFERENCE (hub/pointer): Phase 3 detailed reference index |
| `docs/reference/governance/DATA-RELAY-GOVERNANCE-WORKSPACE-v1.1-FINAL.txt` | `REFERENCE_CURRENT` | docs/canonical/05-GOVERNANCE-SECURITY.md | KEEP_REFERENCE: Detailed workspace contract |
| `docs/reference/governance/DATA-RELAY-GOVERNANCE-AND-TRANSFORM-POLICY-DRAFT-v1.1-FINAL.txt` | `REFERENCE_CURRENT` | docs/canonical/05-GOVERNANCE-SECURITY.md | KEEP_REFERENCE: Detailed policy draft for route/governance work |
| `docs/reference/ux/DATA-RELAY-UNION-SCHEMA-UX-SPEC-v1.1-FINAL.txt` | `REFERENCE_CURRENT` | docs/canonical/02-SYSTEM-ARCHITECTURE.md + docs/canonical/06-USER-EXPERIENCE.md | KEEP_REFERENCE: Detailed Union Schema UX rules |
| `docs/reference/architecture/credential-encryption-at-rest.md` | `REFERENCE_CURRENT` | docs/canonical/05-GOVERNANCE-SECURITY.md | KEEP_REFERENCE: Credential encryption-at-rest implementation contract |
| `docs/reference/architecture/route-processing-persist-roadmap.md` | `REFERENCE_CURRENT` | docs/canonical/02-SYSTEM-ARCHITECTURE.md | KEEP_REFERENCE: Current persist gap/roadmap contract |
| `docs/release/KNOWN-LIMITATIONS.md` | `REFERENCE_CURRENT` | docs/canonical/08-QUALITY-RELEASE.md | KEEP_REFERENCE: Current known-limitations contract |
| `docs/ux/DATA-RELAY-ROUTE-PROCESSING-UX-SPEC.md` | `REFERENCE_CURRENT` | docs/canonical/06-USER-EXPERIENCE.md | KEEP_REFERENCE: Current Route Processing UX contract |
| `docs/ux/DATA-RELAY-SCHEMA-DRIFT-POLICY-RUNTIME-SPEC.md` | `REFERENCE_CURRENT` | docs/canonical/05-GOVERNANCE-SECURITY.md | KEEP_REFERENCE: Schema Drift runtime policy contract |
| `docs/ux/dashboard-operational-monitoring.md` | `REFERENCE_CURRENT` | docs/canonical/07-OPERATIONS-OBSERVABILITY.md | KEEP_REFERENCE: Dashboard monitoring contract |
| `docs/ux/streams-operations.md` | `REFERENCE_CURRENT` | docs/canonical/06-USER-EXPERIENCE.md | KEEP_REFERENCE: Streams operations UX contract |
| `docs/runtime/runtime-capability-matrix.md` | `REFERENCE_CURRENT` | docs/canonical/03-RUNTIME-RELIABILITY.md | KEEP_REFERENCE: Per-adapter capability matrix |
| `docs/runtime/postgresql-partitioning.md` | `REFERENCE_CURRENT` | docs/canonical/07-OPERATIONS-OBSERVABILITY.md | KEEP_REFERENCE: Partitioning reference |
| `docs/runtime/advanced-enrichment-rules.md` | `REFERENCE_CURRENT` | docs/canonical/02-SYSTEM-ARCHITECTURE.md | KEEP_REFERENCE: Enrichment rules reference |
| `docs/sources/s3-object-polling.md` | `REFERENCE_CURRENT` | docs/canonical/03-RUNTIME-RELIABILITY.md | KEEP_REFERENCE: S3 source reference |
| `docs/sources/remote-file-polling.md` | `REFERENCE_CURRENT` | docs/canonical/03-RUNTIME-RELIABILITY.md | KEEP_REFERENCE: Remote file source reference |
| `docs/destinations/syslog-tls.md` | `REFERENCE_CURRENT` | docs/canonical/03-RUNTIME-RELIABILITY.md | KEEP_REFERENCE: Syslog TLS destination reference |
| `docs/metrics/metric-ontology.md` | `REFERENCE_CURRENT` | docs/canonical/07-OPERATIONS-OBSERVABILITY.md | KEEP_REFERENCE: Metric ontology contract |
| `.specify/memory/constitution.md` | `REFERENCE_CURRENT` | docs/canonical/00-DOCUMENTATION-GOVERNANCE.md | KEEP_REFERENCE: Engineering constitution/invariants |
| `.specify/specs-index.md` | `REFERENCE_CURRENT` | docs/canonical/00-DOCUMENTATION-GOVERNANCE.md | KEEP_REFERENCE: Status-aware specs index |
| `docs/release/production-checklist.md` | `REFERENCE_CURRENT` | docs/canonical/08-QUALITY-RELEASE.md | KEEP_RUNBOOK: Production go-live checklist |
| `docs/release/installation-validation.md` | `REFERENCE_CURRENT` | docs/canonical/08-QUALITY-RELEASE.md | KEEP_RUNBOOK: Install validation procedure |
| `docs/getting-started/GETTING-STARTED.md` | `REFERENCE_CURRENT` | docs/canonical/01-PRODUCT-CHARTER.md | KEEP_RUNBOOK: Getting started walkthrough |
| `docs/testing/backend-full-test.md` | `REFERENCE_CURRENT` | docs/canonical/08-QUALITY-RELEASE.md | KEEP_RUNBOOK: Backend full test procedure |
| `docs/testing/backfill-phase2-pytest.md` | `REFERENCE_CURRENT` | docs/canonical/08-QUALITY-RELEASE.md | KEEP_RUNBOOK: Backfill pytest procedure |
| `docs/testing/continuous-test-environment.md` | `REFERENCE_CURRENT` | docs/canonical/08-QUALITY-RELEASE.md | KEEP_RUNBOOK: Continuous test environment |
| `docs/testing/continuous-validation.md` | `REFERENCE_CURRENT` | docs/canonical/08-QUALITY-RELEASE.md | KEEP_RUNBOOK: Continuous validation procedure |
| `docs/testing/cursor-development-workflow.md` | `REFERENCE_CURRENT` | docs/canonical/08-QUALITY-RELEASE.md | KEEP_RUNBOOK: Cursor development workflow |
| `docs/testing/dev-validation-lab.md` | `REFERENCE_CURRENT` | docs/canonical/08-QUALITY-RELEASE.md | KEEP_RUNBOOK: Dev validation lab |
| `docs/testing/dev-validation-oauth2-runtime.md` | `REFERENCE_CURRENT` | docs/canonical/08-QUALITY-RELEASE.md | KEEP_RUNBOOK: OAuth2 runtime validation |
| `docs/testing/e2e-functional-regression-matrix.md` | `REFERENCE_CURRENT` | docs/canonical/08-QUALITY-RELEASE.md | KEEP_RUNBOOK: E2E functional regression matrix |
| `docs/testing/e2e-regression.md` | `REFERENCE_CURRENT` | docs/canonical/08-QUALITY-RELEASE.md | KEEP_RUNBOOK: E2E regression procedure |
| `docs/testing/external-runtime-e2e.md` | `REFERENCE_CURRENT` | docs/canonical/08-QUALITY-RELEASE.md | KEEP_RUNBOOK: External runtime e2e |
| `docs/testing/full-e2e-dev-validation.md` | `REFERENCE_CURRENT` | docs/canonical/08-QUALITY-RELEASE.md | KEEP_RUNBOOK: Full e2e dev validation |
| `docs/testing/openapi-contract-schemathesis.md` | `REFERENCE_CURRENT` | docs/canonical/08-QUALITY-RELEASE.md | KEEP_RUNBOOK: OpenAPI contract testing |
| `docs/testing/regression-policy.md` | `REFERENCE_CURRENT` | docs/canonical/08-QUALITY-RELEASE.md | KEEP_RUNBOOK: Regression policy |
| `docs/testing/source-adapter-e2e.md` | `REFERENCE_CURRENT` | docs/canonical/08-QUALITY-RELEASE.md | KEEP_RUNBOOK: Source adapter e2e |
| `docs/testing/validation-alerting.md` | `REFERENCE_CURRENT` | docs/canonical/08-QUALITY-RELEASE.md | KEEP_RUNBOOK: Validation alerting |
| `docs/testing/visible-dev-e2e-fixtures.md` | `REFERENCE_CURRENT` | docs/canonical/08-QUALITY-RELEASE.md | KEEP_RUNBOOK: Visible dev e2e fixtures |
| `docs/operations/data-management/backup-restore.md` | `REFERENCE_CURRENT` | docs/canonical/07-OPERATIONS-OBSERVABILITY.md | KEEP_RUNBOOK: Backup/restore authority |
| `docs/operations/troubleshooting/support-bundle.md` | `REFERENCE_CURRENT` | docs/canonical/07-OPERATIONS-OBSERVABILITY.md | KEEP_RUNBOOK: Support bundle API/contents contract |
| `docs/operations/troubleshooting/support-diagnostics.md` | `REFERENCE_CURRENT` | docs/canonical/07-OPERATIONS-OBSERVABILITY.md | KEEP_RUNBOOK: Operator diagnostics flow |
| `docs/operations/administration/maintenance-center.md` | `REFERENCE_CURRENT` | docs/canonical/07-OPERATIONS-OBSERVABILITY.md | KEEP_RUNBOOK: Maintenance Center admin contract |
| `docs/operations/administration/admin-password-reset.md` | `REFERENCE_CURRENT` | docs/canonical/07-OPERATIONS-OBSERVABILITY.md | KEEP_RUNBOOK: Admin password reset procedure |
| `docs/operations/administration/auth-session-operations.md` | `REFERENCE_CURRENT` | docs/canonical/05-GOVERNANCE-SECURITY.md | KEEP_RUNBOOK: Auth/session ops |
| `docs/operations/data-management/historical-materialization.md` | `REFERENCE_CURRENT` | docs/canonical/07-OPERATIONS-OBSERVABILITY.md | KEEP_RUNBOOK: Historical materialization ops |
| `docs/operations/deployment/migration-integrity-validation.md` | `REFERENCE_CURRENT` | docs/canonical/07-OPERATIONS-OBSERVABILITY.md | KEEP_RUNBOOK: Migration integrity procedure |
| `docs/operations/deployment/migration-recovery-runbook.md` | `REFERENCE_CURRENT` | docs/canonical/07-OPERATIONS-OBSERVABILITY.md | KEEP_RUNBOOK: Migration recovery runbook |
| `docs/operations/data-management/retention-policies.md` | `REFERENCE_CURRENT` | docs/canonical/07-OPERATIONS-OBSERVABILITY.md | KEEP_RUNBOOK: Retention policies |
| `docs/operations/deployment/release-checklist.md` | `REFERENCE_CURRENT` | docs/canonical/08-QUALITY-RELEASE.md | KEEP_RUNBOOK: Release/upgrade ops checklist |
| `docs/operations/deployment/https-reverse-proxy.md` | `REFERENCE_CURRENT` | docs/canonical/07-OPERATIONS-OBSERVABILITY.md | KEEP_RUNBOOK: HTTPS reverse proxy deploy guide |
| `docs/operations/deployment/install-guide.md` | `REFERENCE_CURRENT` | docs/canonical/07-OPERATIONS-OBSERVABILITY.md | KEEP_RUNBOOK: Install guide |
| `docs/operations/deployment/offline-install.md` | `REFERENCE_CURRENT` | docs/canonical/07-OPERATIONS-OBSERVABILITY.md | KEEP_RUNBOOK: Offline install guide |
| `docs/operations/deployment/offline-install-validation.md` | `REFERENCE_CURRENT` | docs/canonical/07-OPERATIONS-OBSERVABILITY.md | KEEP_RUNBOOK: Offline install validation |
| `docs/operations/deployment/upgrade-guide.md` | `REFERENCE_CURRENT` | docs/canonical/07-OPERATIONS-OBSERVABILITY.md | KEEP_RUNBOOK: Upgrade guide |
| `docs/operations/deployment/uvicorn-gunicorn-production.md` | `REFERENCE_CURRENT` | docs/canonical/07-OPERATIONS-OBSERVABILITY.md | KEEP_RUNBOOK: Production process guide |
| `docs/operations/deployment/docker-platform.md` | `REFERENCE_CURRENT` | docs/canonical/07-OPERATIONS-OBSERVABILITY.md | KEEP_RUNBOOK: Docker platform reference |
| `docs/operations/operator-runbook.md` | `REFERENCE_CURRENT` | docs/canonical/07-OPERATIONS-OBSERVABILITY.md | KEEP_RUNBOOK: Operator runbook |
| `docs/development/database-url-resolution.md` | `REFERENCE_CURRENT` | docs/canonical/07-OPERATIONS-OBSERVABILITY.md | KEEP_RUNBOOK: Database URL resolution |
| `docs/development/dev-platform-environment-contract.md` | `REFERENCE_CURRENT` | docs/canonical/07-OPERATIONS-OBSERVABILITY.md | KEEP_RUNBOOK: Dev platform environment contract |
| `docs/development/github-backup-strategy.md` | `REFERENCE_CURRENT` | docs/canonical/07-OPERATIONS-OBSERVABILITY.md | KEEP_RUNBOOK: GitHub backup/hygiene strategy |
| `docs/development/local-docker-workflow.md` | `REFERENCE_CURRENT` | docs/canonical/07-OPERATIONS-OBSERVABILITY.md | KEEP_RUNBOOK: Local docker workflow |
| `specs/001-core-architecture/spec.md` | `REFERENCE_CURRENT` | docs/canonical/02-SYSTEM-ARCHITECTURE.md | KEEP_REFERENCE: engineering contract subordinate to canonical (specs path unchanged) |
| `specs/002-runtime-pipeline/spec.md` | `REFERENCE_CURRENT` | docs/canonical/03-RUNTIME-RELIABILITY.md | KEEP_REFERENCE: engineering contract subordinate to canonical (specs path unchanged) |
| `specs/003-db-model/spec.md` | `REFERENCE_CURRENT` | docs/canonical/02-SYSTEM-ARCHITECTURE.md | KEEP_REFERENCE: engineering contract subordinate to canonical (specs path unchanged) |
| `specs/004-delivery-routing/spec.md` | `REFERENCE_CURRENT` | docs/canonical/03-RUNTIME-RELIABILITY.md | KEEP_REFERENCE: engineering contract subordinate to canonical (specs path unchanged) |
| `specs/005-generic-http-connector-stream-workflow/spec.md` | `REFERENCE_CURRENT` | docs/canonical/04-CONNECTORS-MARKETPLACE.md | KEEP_REFERENCE: engineering contract subordinate to canonical (specs path unchanged) |
| `specs/005-runtime-metrics/spec.md` | `REFERENCE_CURRENT` | docs/canonical/03-RUNTIME-RELIABILITY.md | KEEP_REFERENCE: engineering contract subordinate to canonical (specs path unchanged) |
| `specs/005-wiremock-integration/spec.md` | `REFERENCE_CURRENT` | docs/canonical/08-QUALITY-RELEASE.md | KEEP_REFERENCE: engineering contract subordinate to canonical (specs path unchanged) |
| `specs/006-admin-settings-ui/spec.md` | `REFERENCE_CURRENT` | docs/canonical/06-USER-EXPERIENCE.md + docs/canonical/07-OPERATIONS-OBSERVABILITY.md | KEEP_REFERENCE: engineering contract subordinate to canonical (specs path unchanged) |
| `specs/006-message-prefix-delivery/spec.md` | `REFERENCE_CURRENT` | docs/canonical/03-RUNTIME-RELIABILITY.md | KEEP_REFERENCE: engineering contract subordinate to canonical (specs path unchanged) |
| `specs/006-route-runtime-observability/spec.md` | `REFERENCE_CURRENT` | docs/canonical/03-RUNTIME-RELIABILITY.md | KEEP_REFERENCE: engineering contract subordinate to canonical (specs path unchanged) |
| `specs/007-admin-operations-ui/spec.md` | `REFERENCE_CURRENT` | docs/canonical/06-USER-EXPERIENCE.md + docs/canonical/07-OPERATIONS-OBSERVABILITY.md | KEEP_REFERENCE: engineering contract subordinate to canonical (specs path unchanged) |
| `specs/007-message-prefix-variables/spec.md` | `REFERENCE_CURRENT` | docs/canonical/03-RUNTIME-RELIABILITY.md | KEEP_REFERENCE: engineering contract subordinate to canonical (specs path unchanged) |
| `specs/008-webhook-payload-mode/spec.md` | `REFERENCE_CURRENT` | docs/canonical/03-RUNTIME-RELIABILITY.md | KEEP_REFERENCE: engineering contract subordinate to canonical (specs path unchanged) |
| `specs/009-session-login-http/spec.md` | `REFERENCE_CURRENT` | docs/canonical/03-RUNTIME-RELIABILITY.md | KEEP_REFERENCE: engineering contract subordinate to canonical (specs path unchanged) |
| `specs/010-checkpoint-trace/spec.md` | `REFERENCE_CURRENT` | docs/canonical/03-RUNTIME-RELIABILITY.md | KEEP_REFERENCE: engineering contract subordinate to canonical (specs path unchanged) |
| `specs/010-session-login-preflight-extraction/spec.md` | `REFERENCE_CURRENT` | docs/canonical/03-RUNTIME-RELIABILITY.md | KEEP_REFERENCE: engineering contract subordinate to canonical (specs path unchanged) |
| `specs/011-runtime-analytics/spec.md` | `REFERENCE_CURRENT` | docs/canonical/03-RUNTIME-RELIABILITY.md | KEEP_REFERENCE: engineering contract subordinate to canonical (specs path unchanged) |
| `specs/012-runtime-health-scoring/spec.md` | `REFERENCE_CURRENT` | docs/canonical/03-RUNTIME-RELIABILITY.md | KEEP_REFERENCE: engineering contract subordinate to canonical (specs path unchanged) |
| `specs/013-template-connector-system/spec.md` | `REFERENCE_CURRENT` | docs/canonical/04-CONNECTORS-MARKETPLACE.md | KEEP_REFERENCE: engineering contract subordinate to canonical (specs path unchanged) |
| `specs/014-wiremock-template-e2e/spec.md` | `REFERENCE_CURRENT` | docs/canonical/04-CONNECTORS-MARKETPLACE.md | KEEP_REFERENCE: engineering contract subordinate to canonical (specs path unchanged) |
| `specs/015-backup-export-import/spec.md` | `REFERENCE_CURRENT` | docs/canonical/07-OPERATIONS-OBSERVABILITY.md | KEEP_REFERENCE: engineering contract subordinate to canonical (specs path unchanged) |
| `specs/016-continuous-validation/spec.md` | `REFERENCE_CURRENT` | docs/canonical/08-QUALITY-RELEASE.md | KEEP_REFERENCE: engineering contract subordinate to canonical (specs path unchanged) |
| `specs/017-validation-alerting/spec.md` | `REFERENCE_CURRENT` | docs/canonical/08-QUALITY-RELEASE.md | KEEP_REFERENCE: engineering contract subordinate to canonical (specs path unchanged) |
| `specs/018-continuous-test-environment/spec.md` | `REFERENCE_CURRENT` | docs/canonical/08-QUALITY-RELEASE.md | KEEP_REFERENCE: engineering contract subordinate to canonical (specs path unchanged) |
| `specs/019-retention-viewer-webhook-alerts/spec.md` | `REFERENCE_CURRENT` | docs/canonical/03-RUNTIME-RELIABILITY.md | KEEP_REFERENCE: engineering contract subordinate to canonical (specs path unchanged) |
| `specs/020-jwt-session-auth/spec.md` | `REFERENCE_CURRENT` | docs/canonical/05-GOVERNANCE-SECURITY.md | KEEP_REFERENCE: engineering contract subordinate to canonical (specs path unchanged) |
| `specs/021-https-reverse-proxy/spec.md` | `REFERENCE_CURRENT` | docs/canonical/05-GOVERNANCE-SECURITY.md | KEEP_REFERENCE: engineering contract subordinate to canonical (specs path unchanged) |
| `specs/022-runtime-operations-console/spec.md` | `REFERENCE_CURRENT` | docs/canonical/03-RUNTIME-RELIABILITY.md | KEEP_REFERENCE: engineering contract subordinate to canonical (specs path unchanged) |
| `specs/023-config-diff-rollback/spec.md` | `REFERENCE_CURRENT` | docs/canonical/02-SYSTEM-ARCHITECTURE.md | KEEP_REFERENCE: engineering contract subordinate to canonical (specs path unchanged) |
| `specs/024-syslog-tls-destination/spec.md` | `REFERENCE_CURRENT` | docs/canonical/03-RUNTIME-RELIABILITY.md | KEEP_REFERENCE: engineering contract subordinate to canonical (specs path unchanged) |
| `specs/025-s3-object-polling-ui/spec.md` | `REFERENCE_CURRENT` | docs/canonical/03-RUNTIME-RELIABILITY.md | KEEP_REFERENCE: engineering contract subordinate to canonical (specs path unchanged) |
| `specs/026-support-bundle/spec.md` | `REFERENCE_CURRENT` | docs/canonical/07-OPERATIONS-OBSERVABILITY.md | KEEP_REFERENCE: engineering contract subordinate to canonical (specs path unchanged) |
| `specs/027-maintenance-center/spec.md` | `REFERENCE_CURRENT` | docs/canonical/07-OPERATIONS-OBSERVABILITY.md | KEEP_REFERENCE: engineering contract subordinate to canonical (specs path unchanged) |
| `specs/028-database-query-source/spec.md` | `REFERENCE_CURRENT` | docs/canonical/03-RUNTIME-RELIABILITY.md | KEEP_REFERENCE: engineering contract subordinate to canonical (specs path unchanged) |
| `specs/029-remote-file-polling-source/spec.md` | `REFERENCE_CURRENT` | docs/canonical/03-RUNTIME-RELIABILITY.md | KEEP_REFERENCE: engineering contract subordinate to canonical (specs path unchanged) |
| `specs/030-data-backfill/spec.md` | `REFERENCE_CURRENT` | docs/canonical/02-SYSTEM-ARCHITECTURE.md | KEEP_REFERENCE: engineering contract subordinate to canonical (specs path unchanged) |
| `specs/031-source-expansion-test-environment/spec.md` | `REFERENCE_CURRENT` | docs/canonical/08-QUALITY-RELEASE.md | KEEP_REFERENCE: engineering contract subordinate to canonical (specs path unchanged) |
| `specs/032-dev-validation-lab-source-expansion/spec.md` | `REFERENCE_CURRENT` | docs/canonical/08-QUALITY-RELEASE.md | KEEP_REFERENCE: engineering contract subordinate to canonical (specs path unchanged) |
| `specs/033-data-backfill-runtime/spec.md` | `REFERENCE_CURRENT` | docs/canonical/03-RUNTIME-RELIABILITY.md | KEEP_REFERENCE: engineering contract subordinate to canonical (specs path unchanged) |
| `specs/034-data-retention/spec.md` | `REFERENCE_CURRENT` | docs/canonical/07-OPERATIONS-OBSERVABILITY.md | KEEP_REFERENCE: engineering contract subordinate to canonical (specs path unchanged) |
| `specs/035-rbac-lite/spec.md` | `REFERENCE_CURRENT` | docs/canonical/05-GOVERNANCE-SECURITY.md | KEEP_REFERENCE: engineering contract subordinate to canonical (specs path unchanged) |
| `specs/036-source-adapter-e2e/spec.md` | `REFERENCE_CURRENT` | docs/canonical/08-QUALITY-RELEASE.md | KEEP_REFERENCE: engineering contract subordinate to canonical (specs path unchanged) |
| `specs/037-visible-dev-e2e-fixtures/spec.md` | `REFERENCE_CURRENT` | docs/canonical/08-QUALITY-RELEASE.md | KEEP_REFERENCE: engineering contract subordinate to canonical (specs path unchanged) |
| `specs/038-release-candidate-deployment/spec.md` | `REFERENCE_CURRENT` | docs/canonical/08-QUALITY-RELEASE.md + docs/canonical/09-ROADMAP-CURRENT-STATE.md | KEEP_REFERENCE: engineering contract subordinate to canonical (specs path unchanged) |
| `specs/039-default-admin-bootstrap/spec.md` | `REFERENCE_CURRENT` | docs/canonical/05-GOVERNANCE-SECURITY.md | KEEP_REFERENCE: engineering contract subordinate to canonical (specs path unchanged) |
| `specs/040-admin-dev-validation-diagnostics/spec.md` | `REFERENCE_CURRENT` | docs/canonical/08-QUALITY-RELEASE.md | KEEP_REFERENCE: engineering contract subordinate to canonical (specs path unchanged) |
| `specs/041-metric-ontology-contract/spec.md` | `REFERENCE_CURRENT` | docs/canonical/02-SYSTEM-ARCHITECTURE.md | KEEP_REFERENCE: engineering contract subordinate to canonical (specs path unchanged) |
| `specs/042-visualization-ontology-contract/spec.md` | `REFERENCE_CURRENT` | docs/canonical/02-SYSTEM-ARCHITECTURE.md | KEEP_REFERENCE: engineering contract subordinate to canonical (specs path unchanged) |
| `specs/043-observability-scale-foundation/spec.md` | `REFERENCE_CURRENT` | docs/canonical/03-RUNTIME-RELIABILITY.md | KEEP_REFERENCE: engineering contract subordinate to canonical (specs path unchanged) |
| `specs/044-external-runtime-e2e/spec.md` | `REFERENCE_CURRENT` | docs/canonical/03-RUNTIME-RELIABILITY.md | KEEP_REFERENCE: engineering contract subordinate to canonical (specs path unchanged) |
| `specs/045-postgresql-partitioning-retention/spec.md` | `REFERENCE_CURRENT` | docs/canonical/07-OPERATIONS-OBSERVABILITY.md | KEEP_REFERENCE: engineering contract subordinate to canonical (specs path unchanged) |
| `specs/046-runtime-topology-view/spec.md` | `REFERENCE_CURRENT` | docs/canonical/03-RUNTIME-RELIABILITY.md | KEEP_REFERENCE: engineering contract subordinate to canonical (specs path unchanged) |
| `specs/047-pipeline-debugger/spec.md` | `REFERENCE_CURRENT` | docs/canonical/03-RUNTIME-RELIABILITY.md | KEEP_REFERENCE: engineering contract subordinate to canonical (specs path unchanged) |
| `specs/048-runtime-reliability/spec.md` | `REFERENCE_CURRENT` | docs/canonical/03-RUNTIME-RELIABILITY.md | KEEP_REFERENCE: engineering contract subordinate to canonical (specs path unchanged) |
| `specs/049-template-registry/spec.md` | `REFERENCE_CURRENT` | docs/canonical/04-CONNECTORS-MARKETPLACE.md | KEEP_REFERENCE: engineering contract subordinate to canonical (specs path unchanged) |
| `specs/065-protection-engine/spec.md` | `REFERENCE_CURRENT` | docs/canonical/05-GOVERNANCE-SECURITY.md | KEEP_REFERENCE: engineering contract subordinate to canonical (specs path unchanged) |
| `specs/066-classification-engine/spec.md` | `REFERENCE_CURRENT` | docs/canonical/05-GOVERNANCE-SECURITY.md | KEEP_REFERENCE: engineering contract subordinate to canonical (specs path unchanged) |
| `specs/066-identity-vault/spec.md` | `REFERENCE_CURRENT` | docs/canonical/05-GOVERNANCE-SECURITY.md | KEEP_REFERENCE: engineering contract subordinate to canonical (specs path unchanged) |
| `specs/067-failover-routing/spec.md` | `REFERENCE_CURRENT` | docs/canonical/03-RUNTIME-RELIABILITY.md | KEEP_REFERENCE: engineering contract subordinate to canonical (specs path unchanged) |
| `specs/068-replay-engine/spec.md` | `REFERENCE_CURRENT` | docs/canonical/03-RUNTIME-RELIABILITY.md | KEEP_REFERENCE: engineering contract subordinate to canonical (specs path unchanged) |
| `specs/069-quarantine-mvp/spec.md` | `REFERENCE_CURRENT` | docs/canonical/05-GOVERNANCE-SECURITY.md | KEEP_REFERENCE: engineering contract subordinate to canonical (specs path unchanged) |
| `specs/071-governance-control-plane-mvp/spec.md` | `REFERENCE_CURRENT` | docs/canonical/05-GOVERNANCE-SECURITY.md | KEEP_REFERENCE: engineering contract subordinate to canonical (specs path unchanged) |
| `specs/072-governance-hardening/spec.md` | `REFERENCE_CURRENT` | docs/canonical/05-GOVERNANCE-SECURITY.md | KEEP_REFERENCE: engineering contract subordinate to canonical (specs path unchanged) |
| `specs/073-operational-ux-cleanup/spec.md` | `REFERENCE_CURRENT` | docs/canonical/06-USER-EXPERIENCE.md + docs/canonical/07-OPERATIONS-OBSERVABILITY.md | KEEP_REFERENCE: engineering contract subordinate to canonical (specs path unchanged) |
| `specs/074-governance-policy-builder/spec.md` | `REFERENCE_CURRENT` | docs/canonical/05-GOVERNANCE-SECURITY.md | KEEP_REFERENCE: engineering contract subordinate to canonical (specs path unchanged) |
| `specs/075-governance-policy-impact/spec.md` | `REFERENCE_CURRENT` | docs/canonical/05-GOVERNANCE-SECURITY.md | KEEP_REFERENCE: engineering contract subordinate to canonical (specs path unchanged) |
| `specs/076-governance-policy-simulation/spec.md` | `REFERENCE_CURRENT` | docs/canonical/05-GOVERNANCE-SECURITY.md | KEEP_REFERENCE: engineering contract subordinate to canonical (specs path unchanged) |
| `specs/077-governance-policy-lifecycle/spec.md` | `REFERENCE_CURRENT` | docs/canonical/05-GOVERNANCE-SECURITY.md | KEEP_REFERENCE: engineering contract subordinate to canonical (specs path unchanged) |
| `specs/078-governance-dashboard/spec.md` | `REFERENCE_CURRENT` | docs/canonical/05-GOVERNANCE-SECURITY.md | KEEP_REFERENCE: engineering contract subordinate to canonical (specs path unchanged) |
| `specs/079-governance-violation-center/spec.md` | `REFERENCE_CURRENT` | docs/canonical/05-GOVERNANCE-SECURITY.md | KEEP_REFERENCE: engineering contract subordinate to canonical (specs path unchanged) |
| `specs/091-route-processing-architecture/spec.md` | `REFERENCE_CURRENT` | docs/canonical/02-SYSTEM-ARCHITECTURE.md + docs/canonical/06-USER-EXPERIENCE.md | KEEP_REFERENCE: engineering contract subordinate to canonical (specs path unchanged) |
| `specs/092-per-route-transform/spec.md` | `REFERENCE_CURRENT` | docs/canonical/02-SYSTEM-ARCHITECTURE.md + docs/canonical/06-USER-EXPERIENCE.md | KEEP_REFERENCE: engineering contract subordinate to canonical (specs path unchanged) |
| `specs/093-per-route-protection/spec.md` | `REFERENCE_CURRENT` | docs/canonical/02-SYSTEM-ARCHITECTURE.md + docs/canonical/06-USER-EXPERIENCE.md | KEEP_REFERENCE: engineering contract subordinate to canonical (specs path unchanged) |
| `specs/094-per-route-classification/spec.md` | `REFERENCE_CURRENT` | docs/canonical/02-SYSTEM-ARCHITECTURE.md + docs/canonical/06-USER-EXPERIENCE.md | KEEP_REFERENCE: engineering contract subordinate to canonical (specs path unchanged) |
| `specs/095-per-route-policy/spec.md` | `REFERENCE_CURRENT` | docs/canonical/02-SYSTEM-ARCHITECTURE.md + docs/canonical/06-USER-EXPERIENCE.md | KEEP_REFERENCE: engineering contract subordinate to canonical (specs path unchanged) |
| `specs/096-route-runtime-delivery/spec.md` | `REFERENCE_CURRENT` | docs/canonical/02-SYSTEM-ARCHITECTURE.md + docs/canonical/06-USER-EXPERIENCE.md | KEEP_REFERENCE: engineering contract subordinate to canonical (specs path unchanged) |
| `specs/097-route-processing-ux/spec.md` | `REFERENCE_CURRENT` | docs/canonical/02-SYSTEM-ARCHITECTURE.md + docs/canonical/06-USER-EXPERIENCE.md | KEEP_REFERENCE: engineering contract subordinate to canonical (specs path unchanged) |
| `docs/archive/historical-audits/README.md` | `HISTORICAL` | docs/canonical/00-DOCUMENTATION-GOVERNANCE.md | Already under docs/archive; historical evidence |
| `docs/archive/historical-audits/m13-commit-readiness-report.md` | `HISTORICAL` | docs/canonical/00-DOCUMENTATION-GOVERNANCE.md | Already under docs/archive; historical evidence |
| `docs/archive/historical-audits/m13-destination-first-full-audit.md` | `HISTORICAL` | docs/canonical/00-DOCUMENTATION-GOVERNANCE.md | Already under docs/archive; historical evidence |
| `docs/archive/historical-audits/m13-pre-commit-validation.md` | `HISTORICAL` | docs/canonical/00-DOCUMENTATION-GOVERNANCE.md | Already under docs/archive; historical evidence |
| `docs/archive/historical-audits/m13-push-readiness-report.md` | `HISTORICAL` | docs/canonical/00-DOCUMENTATION-GOVERNANCE.md | Already under docs/archive; historical evidence |
| `docs/archive/historical-audits/m13-route-architecture-completion-audit.md` | `HISTORICAL` | docs/canonical/00-DOCUMENTATION-GOVERNANCE.md | Already under docs/archive; historical evidence |
| `docs/archive/historical-audits/m13-route-processing-ui-deferral.md` | `HISTORICAL` | docs/canonical/00-DOCUMENTATION-GOVERNANCE.md | Already under docs/archive; historical evidence |
| `docs/archive/historical-audits/post-m13-worktree-audit.md` | `HISTORICAL` | docs/canonical/00-DOCUMENTATION-GOVERNANCE.md | Already under docs/archive; historical evidence |
| `docs/archive/historical-audits/route-architecture-gap-analysis.md` | `HISTORICAL` | docs/canonical/00-DOCUMENTATION-GOVERNANCE.md | Already under docs/archive; historical evidence |
| `docs/archive/historical-audits/route-processing-foundation-implementation-spec.md` | `HISTORICAL` | docs/canonical/00-DOCUMENTATION-GOVERNANCE.md | Already under docs/archive; historical evidence |
| `docs/archive/legacy-design/README.md` | `HISTORICAL` | docs/canonical/00-DOCUMENTATION-GOVERNANCE.md | Already under docs/archive; historical evidence |
| `docs/history/architecture/FANOUT_PARALLELIZATION_REVIEW.md` | `HISTORICAL` | docs/canonical/03-RUNTIME-RELIABILITY.md | Point-in-time design review |
| `docs/history/architecture/OSS-v1-ARCHITECTURE.md` | `HISTORICAL` | docs/canonical/02-SYSTEM-ARCHITECTURE.md | Former OSS architecture overview folded into canonical; body preserved |
| `docs/history/architecture/durable-delivery-queue-audit-design.md` | `HISTORICAL` | docs/canonical/03-RUNTIME-RELIABILITY.md | Design/audit snapshot for durable queue |
| `docs/history/architecture/frontend-schema-drift-observability-audit.md` | `HISTORICAL` | docs/canonical/07-OPERATIONS-OBSERVABILITY.md | Point-in-time audit |
| `docs/history/architecture/frontend-schema-drift-observability-readiness.md` | `HISTORICAL` | docs/canonical/07-OPERATIONS-OBSERVABILITY.md | Point-in-time readiness |
| `docs/history/architecture/governance-humanization-b2-audit.md` | `HISTORICAL` | docs/canonical/05-GOVERNANCE-SECURITY.md | Point-in-time audit |
| `docs/history/architecture/m13/m13-3-protection-design-review.md` | `HISTORICAL` | docs/canonical/02-SYSTEM-ARCHITECTURE.md | M13 point-in-time audit/review/validation |
| `docs/history/architecture/m13/m13-4-classification-design-review.md` | `HISTORICAL` | docs/canonical/02-SYSTEM-ARCHITECTURE.md | M13 point-in-time audit/review/validation |
| `docs/history/architecture/m13/m13-5-policy-design-review.md` | `HISTORICAL` | docs/canonical/02-SYSTEM-ARCHITECTURE.md | M13 point-in-time audit/review/validation |
| `docs/history/architecture/m13/m13-6-delivery-design-review.md` | `HISTORICAL` | docs/canonical/02-SYSTEM-ARCHITECTURE.md | M13 point-in-time audit/review/validation |
| `docs/history/architecture/m13/m13-circular-import-root-cause.md` | `HISTORICAL` | docs/canonical/02-SYSTEM-ARCHITECTURE.md | M13 point-in-time audit/review/validation |
| `docs/history/architecture/m13/m13-commit-readiness-report.md` | `HISTORICAL` | docs/canonical/02-SYSTEM-ARCHITECTURE.md | M13 point-in-time audit/review/validation |
| `docs/history/architecture/m13/m13-destination-first-full-audit.md` | `HISTORICAL` | docs/canonical/02-SYSTEM-ARCHITECTURE.md | M13 point-in-time audit/review/validation |
| `docs/history/architecture/m13/m13-flag-off-parity-report.md` | `HISTORICAL` | docs/canonical/02-SYSTEM-ARCHITECTURE.md | M13 point-in-time audit/review/validation |
| `docs/history/architecture/m13/m13-flag-on-runtime-validation.md` | `HISTORICAL` | docs/canonical/02-SYSTEM-ARCHITECTURE.md | M13 point-in-time audit/review/validation |
| `docs/history/architecture/m13/m13-migration-audit.md` | `HISTORICAL` | docs/canonical/02-SYSTEM-ARCHITECTURE.md | M13 point-in-time audit/review/validation |
| `docs/history/architecture/m13/m13-pre-commit-validation.md` | `HISTORICAL` | docs/canonical/02-SYSTEM-ARCHITECTURE.md | M13 point-in-time audit/review/validation |
| `docs/history/architecture/m13/m13-push-readiness-report.md` | `HISTORICAL` | docs/canonical/02-SYSTEM-ARCHITECTURE.md | M13 point-in-time audit/review/validation |
| `docs/history/architecture/m13/m13-route-architecture-completion-audit.md` | `HISTORICAL` | docs/canonical/02-SYSTEM-ARCHITECTURE.md | M13 point-in-time audit/review/validation |
| `docs/history/architecture/m13/m13-route-architecture-design-review.md` | `HISTORICAL` | docs/canonical/02-SYSTEM-ARCHITECTURE.md | M13 point-in-time audit/review/validation |
| `docs/history/architecture/m13/m13-route-processing-ui-deferral.md` | `HISTORICAL` | docs/canonical/02-SYSTEM-ARCHITECTURE.md | M13 point-in-time audit/review/validation |
| `docs/history/architecture/m13/post-m13-worktree-audit.md` | `HISTORICAL` | docs/canonical/02-SYSTEM-ARCHITECTURE.md | Post-M13 worktree audit snapshot |
| `docs/history/architecture/marketplace/DATA-RELAY-CONNECTOR-MARKETPLACE-ARCHITECTURE-CHARTER-v1.0-DRAFT.md` | `HISTORICAL` | docs/canonical/04-CONNECTORS-MARKETPLACE.md | Superseded Marketplace design baseline; status corrected in Phase 2A |
| `docs/history/architecture/master-design.md` | `HISTORICAL` | docs/canonical/02-SYSTEM-ARCHITECTURE.md | Superseded master design snapshot |
| `docs/history/architecture/route-architecture-gap-analysis.md` | `HISTORICAL` | docs/canonical/02-SYSTEM-ARCHITECTURE.md | Point-in-time gap analysis |
| `docs/history/architecture/route-data-model-review.md` | `HISTORICAL` | docs/canonical/02-SYSTEM-ARCHITECTURE.md | Point-in-time review |
| `docs/history/architecture/route-processing-foundation-implementation-spec.md` | `HISTORICAL` | docs/canonical/02-SYSTEM-ARCHITECTURE.md | Superseded/implementation snapshot; also archived copy exists |
| `docs/history/architecture/schema-drift-observability-workstream-audit.md` | `HISTORICAL` | docs/canonical/07-OPERATIONS-OBSERVABILITY.md | Point-in-time audit |
| `docs/history/architecture/schema-drift-test-readiness-audit.md` | `HISTORICAL` | docs/canonical/08-QUALITY-RELEASE.md | Point-in-time audit |
| `docs/history/documentation-v2-campaign/AUDIT-REPORT.md` | `HISTORICAL` | docs/canonical/00-DOCUMENTATION-GOVERNANCE.md | Phase 1 docs-v2 audit evidence |
| `docs/history/documentation-v2-campaign/MARKETPLACE-ADDENDA-BY-DOCUMENT-v1.0.md` | `HISTORICAL` | docs/canonical/00-DOCUMENTATION-GOVERNANCE.md | Historical Marketplace addenda blocks |
| `docs/history/documentation-v2-campaign/MARKETPLACE-DOCUMENT-UPDATE-MANIFEST-v1.0.md` | `HISTORICAL` | docs/canonical/00-DOCUMENTATION-GOVERNANCE.md | Historical Marketplace update manifest |
| `docs/history/documentation-v2-campaign/MIGRATION-MAP-DRAFT.md` | `HISTORICAL` | docs/canonical/00-DOCUMENTATION-GOVERNANCE.md | Phase 1 migration map draft |
| `docs/history/documentation-v2-campaign/README-DRAFT.md` | `HISTORICAL` | docs/canonical/00-DOCUMENTATION-GOVERNANCE.md | Phase 1 campaign README draft |
| `docs/history/documentation-v2-campaign/README.md` | `HISTORICAL` | docs/canonical/00-DOCUMENTATION-GOVERNANCE.md | Campaign archive index |
| `docs/history/documentation-v2-campaign/apply_marketplace_document_updates.py` | `HISTORICAL` | docs/canonical/00-DOCUMENTATION-GOVERNANCE.md | Historical Marketplace addenda apply script |
| `docs/history/documentation-v2-campaign/draft-manifest.json` | `HISTORICAL` | docs/canonical/00-DOCUMENTATION-GOVERNANCE.md | Phase 1 draft file manifest |
| `docs/history/implementation-reports/deployment-backup-restore-compose.md` | `HISTORICAL` | docs/canonical/07-OPERATIONS-OBSERVABILITY.md | Overlaps docs/operations/data-management/backup-restore.md; different script surface |
| `docs/history/performance/high-scale-runtime-analytics-phase-6.md` | `HISTORICAL` | docs/canonical/03-RUNTIME-RELIABILITY.md | Point-in-time performance phase report/inventory |
| `docs/history/performance/legacy_runtime_aggregate_inventory.md` | `HISTORICAL` | docs/canonical/03-RUNTIME-RELIABILITY.md | Point-in-time performance phase report/inventory |
| `docs/history/performance/operational-snapshot-phase-1.md` | `HISTORICAL` | docs/canonical/03-RUNTIME-RELIABILITY.md | Point-in-time performance phase report/inventory |
| `docs/history/performance/performance-p0-optimization-report.md` | `HISTORICAL` | docs/canonical/03-RUNTIME-RELIABILITY.md | Point-in-time performance phase report/inventory |
| `docs/history/performance/performance-p1-optimization-report.md` | `HISTORICAL` | docs/canonical/03-RUNTIME-RELIABILITY.md | Point-in-time performance phase report/inventory |
| `docs/history/performance/routes-page-snapshot-migration.md` | `HISTORICAL` | docs/canonical/03-RUNTIME-RELIABILITY.md | Point-in-time performance phase report/inventory |
| `docs/history/performance/runtime-command-center-phase-3.md` | `HISTORICAL` | docs/canonical/03-RUNTIME-RELIABILITY.md | Point-in-time performance phase report/inventory |
| `docs/history/performance/runtime-legacy-aggregate-migration-phase-5.md` | `HISTORICAL` | docs/canonical/03-RUNTIME-RELIABILITY.md | Point-in-time performance phase report/inventory |
| `docs/history/performance/runtime-observability-performance.md` | `HISTORICAL` | docs/canonical/03-RUNTIME-RELIABILITY.md | Point-in-time performance phase report/inventory |
| `docs/history/performance/runtime-snapshot-read-model-phase-4.md` | `HISTORICAL` | docs/canonical/03-RUNTIME-RELIABILITY.md | Point-in-time performance phase report/inventory |
| `docs/history/performance/runtime-snapshot-validation-phase-3_5.md` | `HISTORICAL` | docs/canonical/03-RUNTIME-RELIABILITY.md | Point-in-time performance phase report/inventory |
| `docs/history/performance/runtime-ui-virtualization-phase-6_5.md` | `HISTORICAL` | docs/canonical/03-RUNTIME-RELIABILITY.md | Point-in-time performance phase report/inventory |
| `docs/history/releases/OSS-v1-RC-RELEASE-NOTES.md` | `HISTORICAL` | docs/canonical/08-QUALITY-RELEASE.md | Old RC release notes snapshot |
| `docs/history/releases/OSS-v1.0-GA-CHECKLIST.md` | `HISTORICAL` | docs/canonical/08-QUALITY-RELEASE.md | Old GA checklist snapshot |
| `docs/history/releases/OSS-v1.0-GA-RELEASE-NOTES.md` | `HISTORICAL` | docs/canonical/08-QUALITY-RELEASE.md | OSS v1 GA snapshot notes |
| `docs/history/releases/deployment-readiness.md` | `HISTORICAL` | docs/canonical/08-QUALITY-RELEASE.md | Point-in-time deployment readiness notes |
| `docs/history/releases/deployment-release-checklist-rc.md` | `HISTORICAL` | docs/canonical/08-QUALITY-RELEASE.md | Overlaps operations release-readiness-checklist |
| `docs/history/releases/oss-v1-rc-validation-report.md` | `HISTORICAL` | docs/canonical/08-QUALITY-RELEASE.md | Point-in-time RC validation report |
| `docs/history/releases/oss-v102-release-hardening-report.md` | `HISTORICAL` | docs/canonical/08-QUALITY-RELEASE.md | Old hardening report |
| `docs/history/releases/release-readiness-audit.md` | `HISTORICAL` | docs/canonical/08-QUALITY-RELEASE.md | Old readiness audit |
| `docs/history/releases/runtime-api-stability-report.md` | `HISTORICAL` | docs/canonical/03-RUNTIME-RELIABILITY.md | Point-in-time API stability report |
| `docs/history/releases/v1-readiness-checklist.md` | `HISTORICAL` | docs/canonical/08-QUALITY-RELEASE.md | Old v1 readiness checklist |
| `docs/history/session-recovery/README.md` | `HISTORICAL` | docs/canonical/00-DOCUMENTATION-GOVERNANCE.md | Session recovery working notes |
| `docs/history/session-recovery/git-branch-cleanup-plan.md` | `HISTORICAL` | docs/canonical/00-DOCUMENTATION-GOVERNANCE.md | Branch cleanup plan snapshot |
| `docs/history/session-recovery/recent-commits.txt` | `HISTORICAL` | docs/canonical/00-DOCUMENTATION-GOVERNANCE.md | Point-in-time commit dump for session recovery |
| `docs/history/session-recovery/session-recovery-20260521-1501.md` | `HISTORICAL` | docs/canonical/00-DOCUMENTATION-GOVERNANCE.md | Point-in-time session recovery log |
| `docs/history/session-recovery/untracked-files.txt` | `HISTORICAL` | docs/canonical/00-DOCUMENTATION-GOVERNANCE.md | Point-in-time untracked files dump |
| `docs/history/source-of-truth/CHATGPT-DATA-RELAY-GUARDRAIL.txt` | `HISTORICAL` | docs/canonical/00-DOCUMENTATION-GOVERNANCE.md | Historical assistant guardrail; not product authority |
| `docs/history/source-of-truth/DATA-RELAY-GOVERNANCE-WORKSPACE-UX-CHARTER-v1.1-FINAL.txt` | `HISTORICAL` | docs/canonical/05-GOVERNANCE-SECURITY.md + docs/canonical/06-USER-EXPERIENCE.md | Superseded workspace UX charter; detail may inform reference specs |
| `docs/history/source-of-truth/DATA-RELAY-STREAM-WIZARD-UX-CHARTER-v5.2-FINAL.txt` | `HISTORICAL` | docs/canonical/06-USER-EXPERIENCE.md | Superseded wizard UX charter |
| `docs/history/source-of-truth/DATA-RELAY-UX-CHARTER-v1.2.1-FINAL.txt` | `HISTORICAL` | docs/canonical/06-USER-EXPERIENCE.md | Superseded UX charter |
| `docs/history/source-of-truth/GOVERNANCE-UX-CHARTER-v1.1-FINAL.txt` | `HISTORICAL` | docs/canonical/05-GOVERNANCE-SECURITY.md + docs/canonical/06-USER-EXPERIENCE.md | Superseded governance UX charter |
| `docs/history/source-of-truth/MASTER-WBS-Version-1.2.1-FINAL.txt` | `HISTORICAL` | docs/canonical/09-ROADMAP-CURRENT-STATE.md | Superseded WBS; roadmap authority is canonical 09 |
| `docs/history/source-of-truth/PRODUCT-CHARTER-Version-1.2.1-FINAL.txt` | `HISTORICAL` | docs/canonical/01-PRODUCT-CHARTER.md | Superseded product charter; no longer top-level authority |
| `docs/history/source-of-truth/_incoming/README.md` | `HISTORICAL` | docs/canonical/00-DOCUMENTATION-GOVERNANCE.md | Staging duplicates of old SoT; not authority |
| `docs/history/source-roadmap.md` | `HISTORICAL` | docs/canonical/09-ROADMAP-CURRENT-STATE.md | Superseded source roadmap notes |
| `docs/history/testing/e2e-recovery-campaign-closure-20260805.md` | `HISTORICAL` | docs/canonical/08-QUALITY-RELEASE.md | Campaign closure evidence |
| `docs/history/testing/qa-automation-architecture-audit.md` | `HISTORICAL` | docs/canonical/08-QUALITY-RELEASE.md | Point-in-time QA automation architecture audit + matrix evidence (2026-08-20), not live architecture contract |
| `docs/history/ux/M30.1-implementation-report.md` | `HISTORICAL` | docs/canonical/06-USER-EXPERIENCE.md | M30.1 implementation closure report |
| `docs/history/ux/M30.1-vocabulary-audit.md` | `HISTORICAL` | docs/canonical/06-USER-EXPERIENCE.md | Vocabulary audit snapshot |
| `docs/history/ux/M30.2-implementation-report.md` | `HISTORICAL` | docs/canonical/06-USER-EXPERIENCE.md | M30.2 implementation closure report |
| `docs/history/ux/M30.3-implementation-report.md` | `HISTORICAL` | docs/canonical/06-USER-EXPERIENCE.md | M30.3 implementation closure report |
| `docs/history/ux/M30.4-implementation-report.md` | `HISTORICAL` | docs/canonical/06-USER-EXPERIENCE.md | M30.4 implementation closure report |
| `specs/080-governance-rbac/spec.md` | `HISTORICAL` | docs/canonical/05-GOVERNANCE-SECURITY.md | Point-in-time / superseded engineering spec (specs-index: HISTORICAL) |
| `specs/083-oss-v101-sprint5-performance/spec.md` | `HISTORICAL` | docs/canonical/08-QUALITY-RELEASE.md + docs/canonical/09-ROADMAP-CURRENT-STATE.md | Point-in-time / superseded engineering spec (specs-index: HISTORICAL) |
| `specs/084-oss-v101-sprint6-observability/spec.md` | `HISTORICAL` | docs/canonical/03-RUNTIME-RELIABILITY.md | Point-in-time / superseded engineering spec (specs-index: HISTORICAL) |
| `specs/085-oss-v101-sprint7-sensitive-detection-batch/spec.md` | `HISTORICAL` | docs/canonical/08-QUALITY-RELEASE.md + docs/canonical/09-ROADMAP-CURRENT-STATE.md | Point-in-time / superseded engineering spec (specs-index: HISTORICAL) |
| `specs/086-oss-v101-sprint8-replay-optimization/spec.md` | `HISTORICAL` | docs/canonical/03-RUNTIME-RELIABILITY.md | Point-in-time / superseded engineering spec (specs-index: HISTORICAL) |
| `specs/087-oss-v101-sprint9-operational-hardening/spec.md` | `HISTORICAL` | docs/canonical/08-QUALITY-RELEASE.md + docs/canonical/09-ROADMAP-CURRENT-STATE.md | Point-in-time / superseded engineering spec (specs-index: HISTORICAL) |
| `specs/088-m30-1-operations-streams-ux/spec.md` | `HISTORICAL` | docs/canonical/06-USER-EXPERIENCE.md + docs/canonical/07-OPERATIONS-OBSERVABILITY.md | Point-in-time / superseded engineering spec (specs-index: HISTORICAL) |
| `specs/089-m31-1-product-group-metadata/spec.md` | `HISTORICAL` | docs/canonical/06-USER-EXPERIENCE.md + docs/canonical/07-OPERATIONS-OBSERVABILITY.md | Point-in-time / superseded engineering spec (specs-index: HISTORICAL) |
| `docs/history/out-of-scope/ai-gateway/AI_GATEWAY_FOUNDATION_SPEC.md` | `OUT_OF_SCOPE` | — | Outside current Data Relay OSS product scope |
| `docs/history/out-of-scope/ai-gateway/AI_GATEWAY_IMPLEMENTATION_SPEC.md` | `OUT_OF_SCOPE` | — | Outside current Data Relay OSS product scope |
| `specs/070-ai-gateway-mvp/spec.md` | `OUT_OF_SCOPE` | — (OUT_OF_SCOPE) | AI Gateway / outside current OSS product scope |
| `specs/081-ai-policy-enforcement/spec.md` | `OUT_OF_SCOPE` | — (OUT_OF_SCOPE) | AI Gateway / outside current OSS product scope |
| `specs/082-ai-audit-inspection/spec.md` | `OUT_OF_SCOPE` | — (OUT_OF_SCOPE) | AI Gateway / outside current OSS product scope |
| `specs/090-m31-2-ai-stream-ux/spec.md` | `OUT_OF_SCOPE` | — (OUT_OF_SCOPE) | AI Gateway / outside current OSS product scope |

## Phase 3 notes

- Architecture explanation authority is `docs/canonical/`; detailed contracts under `docs/reference/` + `specs/*`.
- `docs/architecture/OSS-v1-ARCHITECTURE.md` is a compatibility stub; full body moved to `docs/history/architecture/OSS-v1-ARCHITECTURE.md`.
- `docs/reference/README.md` indexes current detailed references by domain.
- Verified `docs/tmp/**` duplicates deleted; campaign drafts archived under `docs/history/documentation-v2-campaign/`.
- Verified `_incoming/` staging txt duplicates deleted (corrected history/reference copies retained).
- Specs paths unchanged (`SPECS_MOVED=NO`).

