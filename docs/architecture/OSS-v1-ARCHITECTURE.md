# Data Relay OSS v1 — Architecture Overview

**Audience:** Operators, integrators, and contributors  
**Authority:** [`PRODUCT-CHARTER`](../source-of-truth/PRODUCT-CHARTER-Version-1.2.1-FINAL.txt), [`master-design.md`](../master-design.md)  
**Scope:** OSS v1.0 GA — stream-scoped runtime default (`GDC_ROUTE_PROCESSING_ENABLED=false`)

---

## Data Relay Mental Model

Data Relay is a **Data Delivery Gateway** with **optional data protection**.

Operators think in terms of:

1. Data **comes in** (source)
2. Data is **transformed** (mapping, enrichment)
3. Data **goes out** (destinations)
4. **Problems** are visible on Dashboard and Streams
5. **Protection** is applied when rules require it

Operators do **not** need to understand internal engine names (Schema Drift Engine, Policy Engine, etc.) for day-to-day use.

---

## Configuration Hierarchy

```
Connector
   ↓
Stream  (execution unit)
   ↓
Shared Processing  (stream-scoped mapping, enrichment, governance defaults)
   ↓
Route  (destination-specific processing unit)
   ↓
Destination  (delivery endpoint)
```

### Entity roles

| Entity | Role |
|--------|------|
| **Connector** | Source product connection (credentials, base URL, product group) |
| **Stream** | Pipeline execution unit — one source, one checkpoint, many routes |
| **Shared Processing** | Default transform and governance applied before route fan-out |
| **Route** | Links stream to destination; may override processing per concern |
| **Destination** | Reusable delivery target (webhook, syslog, etc.) |

### Charter rule

> One Stream → Many Routes → Many Destinations  
> Do **not** duplicate streams for per-destination processing differences — use **routes**.

---

## Optional Governance

Governance layers sit on the core pipeline. All are **optional** — streams deliver without governance rules configured.

| Layer | Purpose | Operator surface |
|-------|---------|------------------|
| **Schema Drift** | Detect structural changes in source data | Stream config, runtime logs |
| **Sensitive Detection** | Find PII/secrets in payloads | Protection wizard, runtime |
| **Protection** | Mask, hash, or block sensitive fields | Data protection intents, Route Edit |
| **Classification** | Label data sensitivity | Classification rules, Route Edit |
| **Policy** | Gate delivery (audit, quarantine) | Policy rules, Violations, Quarantine |
| **Quarantine** | Hold events that fail policy | Quarantine Center |
| **Replay** | Re-deliver stored protected payloads | Replay Center |
| **Audit & Notifications** | Immutable trail, alerts | Audit, Notifications |

Governance nav appears only when RBAC grants `governance_read`.

---

## Runtime Architecture (OSS v1 Default)

**Execution path:** Stream-scoped batch pipeline → multi-route fan-out

```
Source Adapter (HTTP / Webhook / DB Query)
        ↓
   Mapping
        ↓
   Enrichment
        ↓
   Sensitive Detection
        ↓
   Classification
        ↓
   Protection
        ↓
   Policy (+ Quarantine gate)
        ↓
   Dynamic Routing (optional)
        ↓
   Fan-out → Route 1..N → Destination delivery
        ↓
   Checkpoint update (on successful delivery only)
```

**Code entry:** `app/runners/stream_runner.py`  
**Spec:** `specs/002-runtime-pipeline/spec.md`, `specs/004-delivery-routing/spec.md`

### Experimental path

When `GDC_ROUTE_PROCESSING_ENABLED=true`:

- Per-route pipeline loop (`process_route_pipeline`)
- Stream-level mapping/enrichment skipped in favor of route-scoped transform
- Failover and Replay **not** wired on per-route delivery path
- **Not recommended for production** in OSS v1.0 GA

---

## Checkpoint

| Rule | Behavior |
|------|----------|
| **When updated** | Only after **successful destination delivery** |
| **On failure** | Checkpoint not advanced (retry on next poll/run) |
| **Partial success** | Depends on route `failure_policy` (e.g. LOG_AND_CONTINUE) |
| **Quarantine** | Event skipped for delivery; checkpoint not updated for quarantined events |

Checkpoint stores source position (HTTP offset, DB cursor, file mtime, S3 key, etc.) per stream.

---

## Replay

**Purpose:** Re-deliver a previously recorded **protected payload** without re-running mapping/enrichment/policy.

| Aspect | Detail |
|--------|--------|
| **Recording** | On successful delivery path (legacy fan-out) |
| **Storage** | `stream_replay_events` table |
| **Re-execution** | Protected payload only — not full pipeline re-run |
| **Operator UI** | Governance → Replay Center |
| **Spec** | `specs/068-replay-engine/spec.md` |

**Limitation:** Replay recording not connected when `GDC_ROUTE_PROCESSING_ENABLED=true`.

---

## Quarantine

**Purpose:** Hold events that match a **quarantine** policy action instead of delivering to destination.

| Aspect | Detail |
|--------|--------|
| **Trigger** | Policy engine `action_type=quarantine` |
| **Effect** | Destination skip; checkpoint not updated |
| **Release** | Operator releases from Quarantine Center — stored protected payload re-sent |
| **Auto-release** | Not in MVP scope |
| **Spec** | `specs/069-quarantine-mvp/spec.md` |

---

## Failover

**Purpose:** Active/standby destination pairs — if primary delivery fails, attempt secondary.

| Aspect | Detail |
|--------|--------|
| **Model** | Active/standby routes per stream |
| **Eligibility** | HTTP errors (not 429) on primary |
| **Checkpoint** | Success on secondary counts as delivery success |
| **Configuration** | `stream_failover_routes` DB records |
| **Spec** | `specs/067-failover-routing/spec.md` |

**Limitation:** Failover runs on legacy `_fan_out` path only; not on per-route pipeline when flag ON.

---

## Route Processing Model

```
Shared Processing (stream)
├── Transform: StreamMapping + StreamEnrichment
├── Protection: StreamProtectionRule
├── Classification: StreamClassificationRule
└── Policy: StreamPolicyRule

Route (per destination)
├── Transform override (Route Edit / wizard intent)
├── Protection override (governance field + route bundle)
├── Classification override (floor + route bundle)
├── Policy override (delivery behavior)
└── Delivery metadata (enabled, rate limit, formatter)
```

**Effective Status:** Each route exposes Inherited / Overridden / Mixed via Effective API — used in Route Edit and Governance Workspace.

**Persist gap (OSS v1.0):** Wizard route **bundles** (`inherit=false`) may deploy as **Intent only**. Post-deploy Route Edit persists full bundles. See [Known Limitations](../release/KNOWN-LIMITATIONS.md).

---

## Frontend Architecture (Operator UI)

| Surface | Path | Purpose |
|---------|------|---------|
| Dashboard | `/monitoring` | Operational health, drill-down |
| Streams | `/streams` | Group-based stream operations |
| Stream Runtime | `/streams/:id/runtime` | Per-stream monitoring and control |
| Routes | `/routes` | Route list and edit |
| Governance | `/governance/*` | Optional control plane |

**OSS release mode:** Internal surfaces (validation lab, connector catalog, templates) hidden via `VITE_OSS_RELEASE_MODE` and route guards.

---

## Data Flow Diagram

```
┌─────────────┐     ┌──────────────┐     ┌─────────────────┐
│  Connector  │────▶│    Stream    │────▶│ Shared Processing│
│  (source)   │     │  (execution) │     │ Map · Enrich · Gov│
└─────────────┘     └──────────────┘     └────────┬────────┘
                                                   │
                     ┌─────────────────────────────┼─────────────────────────────┐
                     ▼                             ▼                             ▼
              ┌────────────┐               ┌────────────┐               ┌────────────┐
              │  Route A   │               │  Route B   │               │  Route C   │
              │  + override│               │  inherited │               │  + override│
              └─────┬──────┘               └─────┬──────┘               └─────┬──────┘
                    ▼                             ▼                             ▼
              ┌────────────┐               ┌────────────┐               ┌────────────┐
              │ Destination│               │ Destination│               │ Destination│
              │     1      │               │     2      │               │     3      │
              └────────────┘               └────────────┘               └────────────┘
```

---

## Related documentation

| Document | Topic |
|----------|-------|
| [master-design.md](../master-design.md) | Full design reference |
| [Route Processing UX Spec](../ux/DATA-RELAY-ROUTE-PROCESSING-UX-SPEC.md) | Inherit/override UX |
| [Route Persist Roadmap](./route-processing-persist-roadmap.md) | v1.x bundle persist backlog |
| [Runtime Capability Matrix](../runtime/runtime-capability-matrix.md) | Feature matrix |
| [Getting Started](../getting-started/GETTING-STARTED.md) | First pipeline walkthrough |

---

*Data Relay OSS v1.0 — Architecture overview for GA.*
