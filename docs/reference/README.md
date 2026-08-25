# Detailed Reference Index

**Role:** Current detailed engineering contracts subordinate to [`docs/canonical/`](../canonical/).  
**Rule:** Canonical docs own product/architecture authority. This tree (plus `specs/*`) owns depth.

Use this index instead of scanning the full inventory.

---

## Architecture

| Document | Why reference (not canonical) |
|---|---|
| [`architecture/credential-encryption-at-rest.md`](./architecture/credential-encryption-at-rest.md) | AES-GCM envelope, fail-closed key rules, and field-level crypto contract |
| [`architecture/route-processing-persist-roadmap.md`](./architecture/route-processing-persist-roadmap.md) | Wizard deploy persist kinds / gap matrix beyond canonical Route Processing summary |

Architecture explanation authority: [`docs/canonical/02-SYSTEM-ARCHITECTURE.md`](../canonical/02-SYSTEM-ARCHITECTURE.md).

---

## Runtime

| Document | Why reference (not canonical) |
|---|---|
| [`docs/runtime/runtime-capability-matrix.md`](../runtime/runtime-capability-matrix.md) | Per-adapter capability truth table |
| [`docs/runtime/postgresql-partitioning.md`](../runtime/postgresql-partitioning.md) | Partitioning / retention implementation detail |
| [`docs/runtime/advanced-enrichment-rules.md`](../runtime/advanced-enrichment-rules.md) | Enrichment rule DSL / behavior detail |
| [`docs/sources/s3-object-polling.md`](../sources/s3-object-polling.md) | S3 source operator/engineering contract |
| [`docs/sources/remote-file-polling.md`](../sources/remote-file-polling.md) | Remote file source contract |
| [`docs/destinations/syslog-tls.md`](../destinations/syslog-tls.md) | Syslog TLS destination contract |
| [`docs/metrics/metric-ontology.md`](../metrics/metric-ontology.md) | Metric naming / ontology contract |

Canonical summary: [`docs/canonical/03-RUNTIME-RELIABILITY.md`](../canonical/03-RUNTIME-RELIABILITY.md).

---

## Marketplace / Connectors

Detailed Marketplace and connector contracts remain in numbered `specs/*` (paths unchanged), especially template registry / connector system specs. Canonical status and product rules: [`docs/canonical/04-CONNECTORS-MARKETPLACE.md`](../canonical/04-CONNECTORS-MARKETPLACE.md).

---

## Governance / Security

| Document | Why reference (not canonical) |
|---|---|
| [`governance/DATA-RELAY-GOVERNANCE-WORKSPACE-v1.1-FINAL.txt`](./governance/DATA-RELAY-GOVERNANCE-WORKSPACE-v1.1-FINAL.txt) | Workspace surface / entity contract detail |
| [`governance/DATA-RELAY-GOVERNANCE-AND-TRANSFORM-POLICY-DRAFT-v1.1-FINAL.txt`](./governance/DATA-RELAY-GOVERNANCE-AND-TRANSFORM-POLICY-DRAFT-v1.1-FINAL.txt) | Transform/governance policy draft still used by Route Processing work |
| [`docs/ux/DATA-RELAY-SCHEMA-DRIFT-POLICY-RUNTIME-SPEC.md`](../ux/DATA-RELAY-SCHEMA-DRIFT-POLICY-RUNTIME-SPEC.md) | Schema Drift runtime policy contract |

Canonical summary: [`docs/canonical/05-GOVERNANCE-SECURITY.md`](../canonical/05-GOVERNANCE-SECURITY.md).

---

## UX

| Document | Why reference (not canonical) |
|---|---|
| [`ux/DATA-RELAY-UNION-SCHEMA-UX-SPEC-v1.1-FINAL.txt`](./ux/DATA-RELAY-UNION-SCHEMA-UX-SPEC-v1.1-FINAL.txt) | Union Schema UX rules too detailed for canonical |
| [`docs/ux/DATA-RELAY-ROUTE-PROCESSING-UX-SPEC.md`](../ux/DATA-RELAY-ROUTE-PROCESSING-UX-SPEC.md) | Route Processing UX / deploy projection contract |
| [`docs/ux/dashboard-operational-monitoring.md`](../ux/dashboard-operational-monitoring.md) | Dashboard monitoring contract |
| [`docs/ux/streams-operations.md`](../ux/streams-operations.md) | Streams operations UX contract |

Canonical UX authority: [`docs/canonical/06-USER-EXPERIENCE.md`](../canonical/06-USER-EXPERIENCE.md) (5-step Wizard; Route Processing order).

---

## Specs hub

Status-aware catalog: [`.specify/specs-index.md`](../../.specify/specs-index.md).  
Engineering invariants: [`.specify/memory/constitution.md`](../../.specify/memory/constitution.md).

Core/runtime/RBAC/Route Processing/Marketplace specs remain under `specs/*` with stable paths.

---

## Operator / QA runbooks (not duplicated here)

| Tree | Role |
|---|---|
| [`docs/operations/`](../operations/) | Install, deploy, admin, troubleshooting, data management |
| [`docs/testing/`](../testing/) | Current executable QA procedures |
| [`docs/development/`](../development/) | Developer workflow / local platform |
| [`docs/release/`](../release/) | Known limitations + production / install validation checklists |
| [`docs/getting-started/GETTING-STARTED.md`](../getting-started/GETTING-STARTED.md) | First-run walkthrough |

Canonical ops/quality summaries: [`07`](../canonical/07-OPERATIONS-OBSERVABILITY.md), [`08`](../canonical/08-QUALITY-RELEASE.md).

---

## Historical / out of scope

| Tree | Role |
|---|---|
| [`docs/history/`](../history/) | Audits, completion reports, superseded SoT, campaign drafts |
| [`docs/history/out-of-scope/`](../history/out-of-scope/) | AI Gateway and other excluded product scope |
