# Data Relay Connectors & Marketplace

**Document Version:** 2.0  
**Last Updated:** 2026-08-25  
**Status:** CANONICAL  
**Implementation baseline:** `qa-wave2-integration` @ `1aa1e12af406f9e3dc9a09d2b979535268cd5b33`

## 1. Objective

The Data Relay Marketplace makes integrations discoverable, installable, verifiable, upgradeable, reversible, reusable, and shareable without adding vendor-specific runtime logic to the core.

Marketplace is an integration **distribution and lifecycle control plane**, not a connector runtime.

## 2. Canonical terminology

### Source Pack

The canonical source-integration content model.

It may define:

- vendor/product identity
- auth requirement shape
- endpoint/request contracts
- streams
- pagination/cursor behavior
- mappings
- enrichments
- schema/sample evidence
- validation fixtures
- runtime/rate-limit hints
- documentation

### Connector Pack

UX synonym for a Source Pack. It is not a new runtime entity.

### Stream Extension Pack

Adds streams and related declarative artifacts to an existing Source Pack/connector family.

It declares a dependency on the base package.

### Marketplace Package

The installable distribution envelope around Source Pack or Stream Extension content.

### Destination Pack

Future optional declarative package kind (**Status: `TARGET`**). It must reuse the existing Destination/Route runtime if introduced.

## 3. Package rule

Marketplace V1 packages are declarative.

Allowed:

- YAML
- JSON
- metadata
- request definitions
- mappings
- enrichments
- schemas
- fixtures
- documentation

Not allowed in V1:

- arbitrary Python
- arbitrary JavaScript
- shell scripts
- native executable plugins loaded into the Data Relay process

## 4. Manifest ownership

### Package-declared

Examples:

- `schema_version`
- `package_id`
- `package_kind`
- `pack_version`
- `api_version`
- `vendor`
- `product`
- `source_type`
- `requires`
- source evidence
- license/provenance

### Platform-derived

Packages must not self-authoritatively assign:

- install origin
- installed version/state
- signature result
- validation result
- trust tier
- publisher approval
- rollback state

## 5. Current implementation status

Older Marketplace charter language (`Implementation Pending` / `Implementation Not Started`) is **stale**. M29.1–M29.5 are present on the current branch.

### IMPLEMENTED — M29.1 Manifest v2

- backward-compatible Manifest v2 parsing
- legacy `version` support
- `pack_version` support
- conflict reject when `version != pack_version`
- `package_id` normalization
- `source` / `stream_extension`
- optional API/evidence/dependency/license/provenance metadata shape

### IMPLEMENTED — M29.2 Unified Registry

Unified registry roots:

```text
Built-in:   connectors/
Installed:  data/plugins
Config:     GDC_PLUGINS_DIR
```

Properties:

- built-in + installed discovery
- no silent package shadowing
- platform-derived package origin
- stream-extension discovery
- process-local cache/reload support

### IMPLEMENTED — M29.3 Package lifecycle

Local package lifecycle:

```text
.tar.gz
→ staging
→ validate
→ atomic install
→ upgrade
→ rollback
→ uninstall
```

Includes:

- path traversal protection
- symlink escape protection
- no partial catalog publication
- lifecycle persistence
- dependency-aware Stream Extension install
- built-in uninstall/shadow protection
- materialization provenance for dependency protection

Remote URL/Git acquisition remains `TARGET`.

### PARTIAL — M29.4 Validator & registry invalidation

**Implemented:**

- common package validator entrypoint
- database-backed Connector Registry generation
- generation bump after successful lifecycle change
- cross-process stale-cache detection/reload
- short generation-check throttle
- controlled cached serving if generation DB check temporarily fails

**Still `TARGET`:**

- deep auth/pagination/cursor/checkpoint content checks
- fixture/mapping/expected-output validation suites beyond current static checks

### IMPLEMENTED — M29.5 Marketplace Security

#### M29.5A — IMPLEMENTED (local package trust)

- package secret scanning
- canonical package digest (SHA-256; excludes signature files)
- Ed25519 signature verification
- trusted signing keys administration
- Marketplace capability RBAC for lifecycle and key administration
- unsigned package install restricted (administrator-only path)

#### M29.5B — IMPLEMENTED (license/provenance + acquisition security policy)

Shared policy primitives for future acquisition consumers (M29.6 / M29.9).
These modules do **not** download packages, clone Git repositories, or contact
remote registries.

**License / provenance policy**

- platform-derived decisions: `ALLOW` / `REVIEW` / `REFERENCE_ONLY` / `DENY`
- declared license/provenance is metadata only (not legal approval)
- MIT / Apache-2.0 → `ALLOW` candidates (attribution still required)
- MPL / reciprocal → `REVIEW`
- ELv2 / source-available / proprietary / unclear / missing → `REFERENCE_ONLY`
- `DENY` only via explicit administrator policy configuration
- packages cannot self-declare `license_decision` (spoofed fields stripped)
- license approval does **not** promote trust tier (`Verified` / `Official`)

**Network acquisition URL security policy**

- HTTPS-only by default (HTTP rejected unless explicitly permitted)
- reject userinfo, unsupported schemes, malformed hosts/ports
- block loopback, private, link-local, multicast, unspecified, reserved, and
  cloud metadata targets (IPv4 and IPv6)
- injectable DNS resolution validation; mixed public+private DNS answers blocked
- redirect targets revalidated from scratch
- optional host/domain/port allowlist hooks (no hardcoded vendor domains)
- DNS rebinding is **not** solved by URL preflight alone — future downloaders
  must resolve → validate → connect only to approved addresses → revalidate redirects

Package validation may inspect declared absolute evidence/upstream URLs against
the acquisition policy **without fetching them**.

Optional publisher registry entity remains `TARGET` (optional publisher string
exists on trusted signing keys).

### IMPLEMENTED — M29.6 Connector Harvester / External Import Pipeline

Deterministic V1 harvester under `app/connectors_registry/harvester/`.

Pipeline:

```text
External Source (local / snapshot / structured fixture)
  → License / Provenance Policy (M29.5B)
  → Harvested Connector Knowledge
  → Normalize / source-type mapping gate
  → Data Relay Source Pack Draft
  → Marketplace Package Validator (+ secret scan)
  → Imported / Local Draft candidate
```

Properties:

- harvests integration **knowledge** only (no upstream code execution)
- registry-dispatched source adapters (Singer/Meltano, OpenTelemetry; Fluent Bit / Telegraf fixture-backed skeletons)
- V1 input modes: local extracted directory, local repository snapshot, structured metadata fixture
- remote HTTPS acquisition is **not** implemented in V1 (shared M29.5B acquisition policy is reused for URL metadata checks only; no independent network policy)
- license gate: `ALLOW` → draft package; `REVIEW` → knowledge + review required; `REFERENCE_ONLY` → metadata only (no restricted content copy); `DENY` → block
- only evidence-supported fields become package content (no fabricated pagination / checkpoint / event_array_path / scopes)
- generated packages start as **Imported** or **Local Draft** only — never auto-promoted to Verified / Official
- no automatic install, stream enable, or AI translation (M29.7)

### TARGET — M29.7+

- AI Connector Translator / Builder
- Marketplace UI
- remote/private registry

## 6. Distribution and endpoint model

**Status:** `TARGET` for hosted/public endpoints; local install path is `IMPLEMENTED`.

### Public product presence

```text
datarelay.run
→ official product website
```

### Data Relay Cloud / hosted product

```text
app.datarelay.run
→ Data Relay hosted product experience
```

### Human-facing Marketplace

```text
market.datarelay.run
→ browse/search
→ integration detail
→ streams
→ versions
→ trust/verification
→ documentation
→ changelog
→ offline download
```

### Machine-facing Registry

```text
registry.datarelay.run
→ search API
→ package metadata
→ version/compatibility
→ package download
→ signature/digest metadata
```

The product should depend on the Registry API, not scrape the human-facing Marketplace site.

## 7. Installation models

### Connected (local upload today)

```text
Data Sources
→ Connectors
→ Upload / Install Package
→ Validate
→ Select/Create Credential
→ Test
→ Continue Stream Wizard
```

Full Marketplace browse/search UI remains `TARGET`.

### Air-gapped

```text
market.datarelay.run
→ download signed offline package/bundle
→ controlled transfer
→ Data Relay Upload Package
→ Validate
→ Install
```

Local upload/validate/install is `IMPLEMENTED`. Hosted download/bundle UX remains `TARGET`.

### Enterprise private registry

```text
Data Relay
→ organization/private registry
→ Validate/Install using the same package contract
```

**Status:** `TARGET`

For self-hosted deployments, remote public registry access remains administrator-controlled and should default off.

## 8. Marketplace UX requirements

**Status:** `TARGET`

Marketplace should show:

- vendor/product
- package and vendor API version
- available streams
- origin
- trust/support tier
- verification evidence/date
- license/provenance
- compatibility
- update/deprecation state

Trust/support tiers:

- Local Draft
- Private
- Imported
- Community
- Verified
- Official

`Verified` and `Official` are platform/review outcomes, not manifest claims.

## 9. High-value product workflows

### Test Before Apply — `TARGET`

```text
Install Package
→ Select Credential
→ Test Connection
→ Fetch Real Sample
→ Validate event root / pagination / checkpoint / schema / mapping
→ Operator Confirms
→ Create or Update Stream
```

### Update Impact Preview — `TARGET`

Before applying a package update, show:

- API/auth changes
- stream additions/removals
- schema/field changes
- mappings affected
- routes/streams potentially affected
- required operator action

Package upgrade must not silently mutate running Stream configuration.

### Verification Evidence — `TARGET` (foundation PARTIAL)

Signature/digest/trust evidence exists for local packages. Broader live verification evidence remains target.

### Connector Request — `TARGET`

### Create with AI — `TARGET`

AI output must:

- remain untrusted initially;
- pass the standard validator;
- never auto-promote itself to Verified/Official.

## 10. Offline bundle target

**Status:** `TARGET`

Air-gapped operation should support dependency-complete offline bundles:

```text
bundle
├ source package
├ stream extensions
├ dependency metadata
├ signatures
├ provenance
└ bundle manifest
```

## 11. Marketplace non-goals

Marketplace does not:

- store live credentials in packages;
- create a second Stream runtime;
- bypass route/checkpoint rules;
- auto-enable a Stream on install;
- silently reconcile running Stream configuration on upgrade;
- auto-install dependencies without explicit policy;
- grant trust based solely on a package claim.
