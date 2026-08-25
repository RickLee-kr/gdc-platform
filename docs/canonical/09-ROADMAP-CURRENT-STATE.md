# Data Relay Current State & Roadmap

**Document Version:** 2.0  
**Last Updated:** 2026-08-25  
**Status:** CANONICAL  
**Implementation baseline:** `qa-wave2-integration` @ `1aa1e12af406f9e3dc9a09d2b979535268cd5b33`  
**Prior audit baseline:** `922ea928f79057c331f567e68c4c8264b2081700` (M29.4); continued by marketplace package trust (M29.5A)

## 1. Status policy

Do not invent overall completion percentages.

Historical OSS v1 milestone completion remains historical.

Current work uses explicit feature status:

- `IMPLEMENTED`
- `PARTIAL`
- `TARGET`
- `BACKLOG`
- `OUT_OF_SCOPE`
- `HISTORICAL`

## 2. Established product foundation

Current product architecture includes:

- Connector / Source / Stream / Route / Destination separation
- One Stream → Many Routes → Many Destinations
- Destination-first 5-step Stream Wizard
- Route Processing (`Transform → Protection → Classification → Policy → Delivery`)
- Data-control engines
- runtime observability
- RBAC
- multiple source/destination adapters
- runtime reliability improvements (durable queue for selected paths, circuit breaker, adaptive concurrency, backpressure, source rate limiter)
- Connected Credential and OAuth/encryption architecture
- package/Marketplace foundation through M29.5 (trust + acquisition security policy)

Detailed current support must be verified against current capability matrices and code.

## 3. Marketplace workstream

### M29.0 — Marketplace / Source Pack consolidation

**Status: `IMPLEMENTED`** (documentation/architecture baseline)

The Source Pack model remains the integration content foundation. Marketplace extends it with package distribution/lifecycle/trust.

### M29.0a — License & provenance

**Status: `IMPLEMENTED`** (policy gate)

Platform-derived license/provenance decisions and provenance field preservation
are implemented. Connector Harvester / import pipeline consumption remains M29.6.

### M29.0b — External connector import specification

**Status: `TARGET`**

Architecture direction exists. Harvester implementation belongs to M29.6.

### M29.1 — Manifest v2

**Status: `IMPLEMENTED`**

### M29.2 — Unified Registry

**Status: `IMPLEMENTED`**

### M29.3 — Package lifecycle

**Status: `IMPLEMENTED`**

Local `.tar.gz` install/upgrade/rollback/uninstall with safe staging and lifecycle persistence.

### M29.4 — Validator & registry invalidation

**Status: `PARTIAL`**

Common package validator plus database generation based cross-process cache invalidation are implemented. Deep content validators remain.

### M29.5 — Marketplace Security

**Status: `IMPLEMENTED`**

| Slice | Status |
|---|---|
| M29.5A secret scan, digest, Ed25519, trusted keys, marketplace RBAC | `IMPLEMENTED` |
| M29.5B license/provenance policy + acquisition URL/SSRF security policy | `IMPLEMENTED` |

Actual remote/Git/registry downloading remains M29.6 / M29.9. M29.5B provides
shared policy primitives only.

### M29.6 — Connector Harvester

**Status: `TARGET`**

### M29.7 — AI Connector Translator / Builder

**Status: `TARGET`**

Output starts as Local Draft and must pass standard validation.

### M29.8 — Marketplace UI

**Status: `TARGET`**

### M29.9 — Remote / Private Registry

**Status: `TARGET`**

Endpoint model (target):

- `market.datarelay.run` — human-facing Marketplace
- `registry.datarelay.run` — machine Registry API
- `app.datarelay.run` — hosted product
- private registry for enterprise/offline environments

Self-hosted remote public registry remains administrator-controlled/default off.

## 4. Product experience priorities after Marketplace foundation

These should be treated as explicit product requirements, not incidental UX polish.

### P0 — Data Flow Troubleshooter

**Status: `TARGET`**

### P0 — Safe Change Management

**Status: `TARGET`**

### P0 — Connector/API Health

**Status: `TARGET` / foundation `PARTIAL`**

### P0 — Replay Center expansion

**Status: `TARGET` expansion**

### P0 — Environment Promotion / GitOps

**Status: `TARGET`**

## 5. Final Marketplace integration gate

Before calling the integrated Marketplace work complete:

1. Marketplace security gates pass (M29.5A/B policy foundations; remote acquire consumers when M29.6/M29.9 ship).
2. built-in package normalization/compatibility is complete.
3. missing/unverified connector content is classified with evidence.
4. Marketplace UI and distribution paths are tested.
5. targeted integration regression passes.
6. final Full Matrix runs on the integrated baseline.
7. human acceptance scenarios pass.

## 6. Backlog / out-of-scope boundary

### Backlog, not current core priority

Examples may include:

- advanced enterprise reporting
- multi-node deployment
- additional enterprise-only operational features
- `MEMORY_BUFFER` / `EXTERNAL_BUFFER` reliability modes
- inbound `SYSLOG_RECEIVER`

### Out of current OSS product scope

- enterprise IAM / SSO federation platform
- AI Gateway / AI Proxy product
- SIEM/SOAR/case management
- generic data platform
