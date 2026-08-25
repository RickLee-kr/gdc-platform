# Data Relay System Architecture

**Document Version:** 2.0  
**Last Updated:** 2026-08-25  
**Status:** CANONICAL

## 1. Architecture model

```text
Connector
   ↓
Source
   ↓
Stream  ← execution unit
   ↓
Shared observation / extraction
   ↓
Route A ── Transform → Protection → Classification → Policy → Delivery → Destination A
Route B ── Transform → Protection → Classification → Policy → Delivery → Destination B
Route C ── Transform → Protection → Classification → Policy → Delivery → Destination C
   ↓
Checkpoint decision
```

## 2. Core entities

| Entity | Responsibility |
|---|---|
| Connector | Connection family/configuration and auth capability boundary. |
| Credential | Secret-bearing runtime authentication material, managed separately from package content. |
| Source | Concrete source configuration consumed by a Stream. |
| Stream | Runtime execution and source/checkpoint ownership unit. |
| Mapping | Field transformation configuration. |
| Enrichment | Additional/derived data configuration; remains distinct from Mapping internally. |
| Route | Destination-specific processing and delivery unit. |
| Destination | Concrete delivery target. |
| Checkpoint | Source progress state advanced only under delivery-success rules. |
| Source Pack | Declarative integration content used to create/configure normal entities; not a runtime entity. |

## 3. Non-negotiable invariants

1. Connector and Stream remain separate.
2. Source and Destination remain separate.
3. Stream is the runtime execution unit.
4. Route is the only Stream-to-Destination relationship.
5. Multi-destination fan-out is preserved.
6. Mapping and Enrichment remain separate persisted/internal stages even when UX presents a unified Transform experience.
7. Checkpoint advances only after required delivery success or explicitly defined absorbed-success semantics.
8. Runtime core remains vendor-agnostic.
9. Vendor/source/auth/destination differences are handled through adapters, strategies, registry content, or declarative package definitions.
10. PostgreSQL is the platform database.
11. Runtime DB transaction ownership rules must not be weakened by control-plane features.

## 4. Processing scopes

### Stream scope

Typical Stream-owned/shared concerns include:

- source fetch
- event extraction
- Union Schema / schema observation
- source checkpoint
- shared sample context
- common source metadata

### Route scope

Destination-specific concerns include:

```text
Transform
Protection
Classification
Policy
Delivery
```

Route processing may inherit shared/default configuration, but destination-specific differences must remain Route-based.

## 5. Adapter architecture

Runtime orchestration delegates source/auth/destination behavior through registries and strategies.

Conceptually:

```text
StreamRunner
  → Source Adapter
  → Shared Processing
  → Route Runtime Context
      → Transform
      → Protection
      → Classification
      → Policy
      → Destination Adapter
  → Checkpoint Decision
```

Large vendor-specific `if/elif` logic in StreamRunner is prohibited.

## 6. Control plane vs data plane

### Control plane

- configuration CRUD
- Marketplace package lifecycle
- package validation
- credentials management
- policy configuration
- operator actions
- deployment readiness
- audit

### Data plane / runtime

- fetch
- transform
- control
- deliver
- retry/recovery
- checkpoint
- runtime evidence

Marketplace and package administration are control-plane features. They must not create a second data plane.

## 7. Source Pack / Marketplace relationship

The Source Pack captures declarative integration knowledge.

Marketplace adds:

- distribution
- installation
- version lifecycle
- trust
- signature/security
- provenance
- remote/private registry

The package is never the execution unit.

Ownership model:

```text
Source Pack = canonical integration content contract
Connector Registry = operational package discovery/catalog authority
Marketplace = distribution/lifecycle/trust layer
Legacy Template Registry = migration/reference path, not a third future authority
```

## 8. Current implementation status

**Implementation baseline:** `qa-wave2-integration` @ `1aa1e12` (continuation of audited `922ea928`).

| Capability | Status |
|---|---|
| Route-based processing architecture | `IMPLEMENTED` (feature-flagged; default enabled) |
| One Stream → Many Routes → Many Destinations | `IMPLEMENTED` |
| Built-in connector manifests via Connector Registry | `IMPLEMENTED` |
| Marketplace Manifest v2 compatibility (M29.1) | `IMPLEMENTED` |
| Multi-root Connector Registry (M29.2) | `IMPLEMENTED` |
| Local package lifecycle (M29.3) | `IMPLEMENTED` |
| Package validator + registry generation invalidation (M29.4) | `PARTIAL` (core shipped; deep content validators remain) |
| Marketplace package trust / secret scan / signatures (M29.5A) | `IMPLEMENTED` |
| Marketplace license/provenance + acquisition URL policy (M29.5B) | `IMPLEMENTED` (policy only; no remote acquire) |
| Marketplace UI / remote registry / harvester / AI builder | `TARGET` |

Detailed implementation status belongs in [09-ROADMAP-CURRENT-STATE.md](./09-ROADMAP-CURRENT-STATE.md).

## 9. Architecture non-goals

Do not introduce:

- parallel connector execution runtimes;
- package-supplied arbitrary executable code in Marketplace V1;
- duplicate authentication engines;
- duplicate HTTP retry systems;
- duplicate delivery/checkpoint systems;
- Marketplace-specific governance engine;
- mandatory distributed infrastructure for basic single-node operation.
