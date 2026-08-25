# Specs Index

**Last Updated:** 2026-08-25
**Rule:** Full directory path is the identity. Numeric prefixes are not unique.

Canonical authority: [`docs/canonical/`](../docs/canonical/).
Constitution (invariants only): [`memory/constitution.md`](./memory/constitution.md).

Spec status values: `CURRENT` · `PARTIAL` · `TARGET` · `HISTORICAL` · `OUT_OF_SCOPE`

Marketplace M29 implementation status lives in `docs/canonical/04-CONNECTORS-MARKETPLACE.md` and `09-ROADMAP-CURRENT-STATE.md` (not “implementation pending”).

| Path | Domain | Status | Canonical Parent | Notes |
|---|---|---|---|---|
| `specs/001-core-architecture/spec.md` | Core Architecture | CURRENT | 02-SYSTEM-ARCHITECTURE | Runtime entity invariants |
| `specs/002-runtime-pipeline/spec.md` | Runtime / Reliability | CURRENT | 03-RUNTIME-RELIABILITY | Pipeline stages |
| `specs/003-db-model/spec.md` | Core Architecture | CURRENT | 02-SYSTEM-ARCHITECTURE | PostgreSQL model |
| `specs/004-delivery-routing/spec.md` | Runtime / Reliability | CURRENT | 03-RUNTIME-RELIABILITY | Route fan-out / delivery |
| `specs/005-generic-http-connector-stream-workflow/spec.md` | Connectors / Templates | CURRENT | 04-CONNECTORS-MARKETPLACE | Duplicate numeric prefix; full path is identity |
| `specs/005-runtime-metrics/spec.md` | Runtime / Reliability | CURRENT | 03-RUNTIME-RELIABILITY | Duplicate numeric prefix; full path is identity |
| `specs/005-wiremock-integration/spec.md` | Testing / Quality | CURRENT | 08-QUALITY-RELEASE | Duplicate numeric prefix; full path is identity |
| `specs/006-admin-settings-ui/spec.md` | UX / Operations UI | CURRENT | 06 / 07 | Duplicate numeric prefix |
| `specs/006-message-prefix-delivery/spec.md` | Runtime / Reliability | CURRENT | 03-RUNTIME-RELIABILITY | Duplicate numeric prefix |
| `specs/006-route-runtime-observability/spec.md` | Runtime / Reliability | CURRENT | 03-RUNTIME-RELIABILITY | Duplicate numeric prefix |
| `specs/007-admin-operations-ui/spec.md` | UX / Operations UI | CURRENT | 06 / 07 | Duplicate numeric prefix |
| `specs/007-message-prefix-variables/spec.md` | Sources / Destinations | CURRENT | 03-RUNTIME-RELIABILITY | Duplicate numeric prefix |
| `specs/008-webhook-payload-mode/spec.md` | Sources / Destinations | CURRENT | 03-RUNTIME-RELIABILITY |  |
| `specs/009-session-login-http/spec.md` | Sources / Destinations | CURRENT | 03-RUNTIME-RELIABILITY |  |
| `specs/010-checkpoint-trace/spec.md` | Runtime / Reliability | CURRENT | 03-RUNTIME-RELIABILITY | Duplicate numeric prefix |
| `specs/010-session-login-preflight-extraction/spec.md` | Sources / Destinations | CURRENT | 03-RUNTIME-RELIABILITY | Duplicate numeric prefix |
| `specs/011-runtime-analytics/spec.md` | Runtime / Reliability | CURRENT | 03-RUNTIME-RELIABILITY |  |
| `specs/012-runtime-health-scoring/spec.md` | Runtime / Reliability | CURRENT | 03-RUNTIME-RELIABILITY |  |
| `specs/013-template-connector-system/spec.md` | Connectors / Templates | CURRENT | 04-CONNECTORS-MARKETPLACE |  |
| `specs/014-wiremock-template-e2e/spec.md` | Connectors / Templates | CURRENT | 04-CONNECTORS-MARKETPLACE |  |
| `specs/015-backup-export-import/spec.md` | Operations | CURRENT | 07-OPERATIONS-OBSERVABILITY |  |
| `specs/016-continuous-validation/spec.md` | Testing / Quality | CURRENT | 08-QUALITY-RELEASE |  |
| `specs/017-validation-alerting/spec.md` | Testing / Quality | CURRENT | 08-QUALITY-RELEASE |  |
| `specs/018-continuous-test-environment/spec.md` | Testing / Quality | CURRENT | 08-QUALITY-RELEASE |  |
| `specs/019-retention-viewer-webhook-alerts/spec.md` | Operations | CURRENT | 07-OPERATIONS-OBSERVABILITY |  |
| `specs/020-jwt-session-auth/spec.md` | Security / Access | CURRENT | 05-GOVERNANCE-SECURITY |  |
| `specs/021-https-reverse-proxy/spec.md` | Security / Access | CURRENT | 05-GOVERNANCE-SECURITY |  |
| `specs/022-runtime-operations-console/spec.md` | Runtime / Reliability | CURRENT | 03-RUNTIME-RELIABILITY |  |
| `specs/023-config-diff-rollback/spec.md` | Platform | CURRENT | 02-SYSTEM-ARCHITECTURE |  |
| `specs/024-syslog-tls-destination/spec.md` | Sources / Destinations | CURRENT | 03-RUNTIME-RELIABILITY |  |
| `specs/025-s3-object-polling-ui/spec.md` | Sources / Destinations | CURRENT | 03-RUNTIME-RELIABILITY |  |
| `specs/026-support-bundle/spec.md` | Operations | CURRENT | 07-OPERATIONS-OBSERVABILITY |  |
| `specs/027-maintenance-center/spec.md` | Operations | CURRENT | 07-OPERATIONS-OBSERVABILITY |  |
| `specs/028-database-query-source/spec.md` | Sources / Destinations | PARTIAL | 03-RUNTIME-RELIABILITY | PostgreSQL-centric production path |
| `specs/029-remote-file-polling-source/spec.md` | Sources / Destinations | CURRENT | 03-RUNTIME-RELIABILITY |  |
| `specs/030-data-backfill/spec.md` | Platform | TARGET | 02-SYSTEM-ARCHITECTURE |  |
| `specs/031-source-expansion-test-environment/spec.md` | Sources / Destinations | CURRENT | 03-RUNTIME-RELIABILITY |  |
| `specs/032-dev-validation-lab-source-expansion/spec.md` | Sources / Destinations | CURRENT | 03-RUNTIME-RELIABILITY |  |
| `specs/033-data-backfill-runtime/spec.md` | Runtime / Reliability | CURRENT | 03-RUNTIME-RELIABILITY |  |
| `specs/034-data-retention/spec.md` | Operations | CURRENT | 07-OPERATIONS-OBSERVABILITY |  |
| `specs/035-rbac-lite/spec.md` | Security / Access | CURRENT | 05-GOVERNANCE-SECURITY | Platform RBAC foundation |
| `specs/036-source-adapter-e2e/spec.md` | Sources / Destinations | CURRENT | 03-RUNTIME-RELIABILITY |  |
| `specs/037-visible-dev-e2e-fixtures/spec.md` | Testing / Quality | CURRENT | 08-QUALITY-RELEASE |  |
| `specs/038-release-candidate-deployment/spec.md` | Release / Sprint | CURRENT | 08 / 09 |  |
| `specs/039-default-admin-bootstrap/spec.md` | Security / Access | CURRENT | 05-GOVERNANCE-SECURITY | Bootstrap credential invariant |
| `specs/040-admin-dev-validation-diagnostics/spec.md` | Testing / Quality | CURRENT | 08-QUALITY-RELEASE |  |
| `specs/041-metric-ontology-contract/spec.md` | Platform | CURRENT | 02-SYSTEM-ARCHITECTURE |  |
| `specs/042-visualization-ontology-contract/spec.md` | Platform | CURRENT | 02-SYSTEM-ARCHITECTURE |  |
| `specs/043-observability-scale-foundation/spec.md` | Runtime / Reliability | CURRENT | 03-RUNTIME-RELIABILITY |  |
| `specs/044-external-runtime-e2e/spec.md` | Runtime / Reliability | CURRENT | 03-RUNTIME-RELIABILITY |  |
| `specs/045-postgresql-partitioning-retention/spec.md` | Operations | CURRENT | 07-OPERATIONS-OBSERVABILITY |  |
| `specs/046-runtime-topology-view/spec.md` | Runtime / Reliability | CURRENT | 03-RUNTIME-RELIABILITY |  |
| `specs/047-pipeline-debugger/spec.md` | Runtime / Reliability | CURRENT | 03-RUNTIME-RELIABILITY |  |
| `specs/048-runtime-reliability/spec.md` | Runtime / Reliability | CURRENT | 03-RUNTIME-RELIABILITY | Policy; PERSISTENT_QUEUE now partially implemented — verify code |
| `specs/049-template-registry/spec.md` | Connectors / Templates | PARTIAL | 04-CONNECTORS-MARKETPLACE | Source Pack content foundation; not a third registry authority |
| `specs/065-protection-engine/spec.md` | Governance | PARTIAL | 05-GOVERNANCE-SECURITY |  |
| `specs/066-classification-engine/spec.md` | Governance | PARTIAL | 05-GOVERNANCE-SECURITY | Duplicate numeric prefix with identity-vault |
| `specs/066-identity-vault/spec.md` | Governance | CURRENT | 05-GOVERNANCE-SECURITY | Number collision with classification-engine |
| `specs/067-failover-routing/spec.md` | Runtime / Reliability | CURRENT | 03-RUNTIME-RELIABILITY |  |
| `specs/068-replay-engine/spec.md` | Runtime / Reliability | PARTIAL | 03-RUNTIME-RELIABILITY |  |
| `specs/069-quarantine-mvp/spec.md` | Governance | PARTIAL | 05-GOVERNANCE-SECURITY |  |
| `specs/070-ai-gateway-mvp/spec.md` | AI Gateway | OUT_OF_SCOPE | — (OSS OUT_OF_SCOPE) | AI Gateway not current OSS product scope |
| `specs/071-governance-control-plane-mvp/spec.md` | Governance | CURRENT | 05-GOVERNANCE-SECURITY |  |
| `specs/072-governance-hardening/spec.md` | Governance | CURRENT | 05-GOVERNANCE-SECURITY |  |
| `specs/073-operational-ux-cleanup/spec.md` | UX / Operations UI | CURRENT | 06 / 07 |  |
| `specs/074-governance-policy-builder/spec.md` | Governance | CURRENT | 05-GOVERNANCE-SECURITY |  |
| `specs/075-governance-policy-impact/spec.md` | Governance | CURRENT | 05-GOVERNANCE-SECURITY |  |
| `specs/076-governance-policy-simulation/spec.md` | Governance | CURRENT | 05-GOVERNANCE-SECURITY |  |
| `specs/077-governance-policy-lifecycle/spec.md` | Governance | CURRENT | 05-GOVERNANCE-SECURITY |  |
| `specs/078-governance-dashboard/spec.md` | Governance | CURRENT | 05-GOVERNANCE-SECURITY |  |
| `specs/079-governance-violation-center/spec.md` | Governance | CURRENT | 05-GOVERNANCE-SECURITY |  |
| `specs/080-governance-rbac/spec.md` | Governance | HISTORICAL | 05-GOVERNANCE-SECURITY |  |
| `specs/081-ai-policy-enforcement/spec.md` | AI Gateway | OUT_OF_SCOPE | — (OSS OUT_OF_SCOPE) | AI Gateway related |
| `specs/082-ai-audit-inspection/spec.md` | AI Gateway | OUT_OF_SCOPE | — (OSS OUT_OF_SCOPE) | AI Gateway related |
| `specs/083-oss-v101-sprint5-performance/spec.md` | Release / Sprint | HISTORICAL | 08 / 09 |  |
| `specs/084-oss-v101-sprint6-observability/spec.md` | Runtime / Reliability | HISTORICAL | 03-RUNTIME-RELIABILITY |  |
| `specs/085-oss-v101-sprint7-sensitive-detection-batch/spec.md` | Release / Sprint | HISTORICAL | 08 / 09 |  |
| `specs/086-oss-v101-sprint8-replay-optimization/spec.md` | Runtime / Reliability | HISTORICAL | 03-RUNTIME-RELIABILITY |  |
| `specs/087-oss-v101-sprint9-operational-hardening/spec.md` | Release / Sprint | HISTORICAL | 08 / 09 |  |
| `specs/088-m30-1-operations-streams-ux/spec.md` | UX / Operations UI | HISTORICAL | 06 / 07 |  |
| `specs/089-m31-1-product-group-metadata/spec.md` | UX / Operations UI | HISTORICAL | 06 / 07 |  |
| `specs/090-m31-2-ai-stream-ux/spec.md` | AI Gateway | OUT_OF_SCOPE | — (OSS OUT_OF_SCOPE) | AI Stream UX / AI Gateway |
| `specs/091-route-processing-architecture/spec.md` | Route Processing | CURRENT | 02 / 06 | Route processing foundation |
| `specs/092-per-route-transform/spec.md` | Route Processing | CURRENT | 02 / 06 |  |
| `specs/093-per-route-protection/spec.md` | Route Processing | CURRENT | 02 / 06 |  |
| `specs/094-per-route-classification/spec.md` | Route Processing | CURRENT | 02 / 06 |  |
| `specs/095-per-route-policy/spec.md` | Route Processing | CURRENT | 02 / 06 |  |
| `specs/096-route-runtime-delivery/spec.md` | Route Processing | CURRENT | 02 / 06 |  |
| `specs/097-route-processing-ux/spec.md` | Route Processing | CURRENT | 02 / 06 | Wizard Route Processing UX |

## Notes

- Do not renumber existing specs to fix duplicate prefixes.
- AI Gateway-related specs are explicitly `OUT_OF_SCOPE` for current Data Relay OSS.
- Ignore Marketplace addendum footers pasted into older `spec.md` files when classifying feature status; use this index and canonical docs.
- There is no `specs/050-*` directory on disk even if older indexes mentioned it.

