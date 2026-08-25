# Data Relay Governance & Security

**Document Version:** 2.0  
**Last Updated:** 2026-08-25  
**Status:** CANONICAL

## 1. Governance product boundary

Data Relay Governance is a **Data Control capability**, not a separate compliance product.

Users define handling intent. They should not need to understand internal engine names.

The user asks:

```text
Is the data sensitive?
How should it be protected?
May it be delivered?
What happens if a rule is violated?
```

## 2. Configuration vs execution scope

```text
Execution unit: Stream
Processing unit: Route
```

A shared/default governance intent may belong to the Stream configuration while effective destination-specific behavior is Route-aware.

Destination-specific governance differences must use Route processing rather than duplicate Streams.

## 3. Route governance order

Within Route Processing:

```text
Transform
→ Protection
→ Classification
→ Policy
→ Delivery
```

Schema observation and shared sensitive suggestions may be computed at Stream scope and consumed by routes.

## 4. Schema and sensitive-data behavior

Union Schema remains Stream-scoped.

Unknown field default behavior remains pass-through unless configured otherwise.

Schema Drift policy must distinguish:

- unknown normal field
- unknown sensitive field

and reuse existing protection/quarantine/runtime components rather than inventing a parallel policy engine.

Detailed engineering reference: `docs/ux/DATA-RELAY-SCHEMA-DRIFT-POLICY-RUNTIME-SPEC.md`.

## 5. Quarantine and replay

Quarantine is a data-control outcome.

Replay/release must preserve:

- auditability
- route/destination semantics
- checkpoint safety

Marketplace rollback must never be confused with data replay or checkpoint rollback.

## 6. Credential security

Credentials are platform-managed runtime objects.

| Principle | Status |
|---|---|
| Secrets are not stored in Source Packs | `IMPLEMENTED` (validated; secret scan on install) |
| Secrets are encrypted at rest | `IMPLEMENTED` |
| Package content contains only auth requirements/placeholders | `IMPLEMENTED` |
| Runtime secret resolution occurs only at controlled runtime boundaries | `IMPLEMENTED` |
| OAuth lifecycle remains in the Credential subsystem | `IMPLEMENTED` |
| Marketplace must not implement a second OAuth/token store | `IMPLEMENTED` (invariant) |

## 7. Platform RBAC

Existing platform RBAC is the authority.

Marketplace adds permissions to the existing model rather than creating separate authentication.

| Direction | Status |
|---|---|
| Viewer: read-only operational/catalog access | `PARTIAL` / expands with UI |
| Operator: approved operational/package lifecycle actions | `PARTIAL` (API capabilities present) |
| Administrator: trusted key/publisher and security-sensitive administration | `IMPLEMENTED` for trusted signing keys |

Exact route permissions must be implemented through the centralized RBAC evaluator.

## 8. Marketplace security boundary

Package governance is an Administration concern.

It includes:

- install origin policy
- package validation
- package signature result
- trusted signing keys
- publisher approval
- license/provenance decision (platform-derived `ALLOW` / `REVIEW` /
  `REFERENCE_ONLY` / `DENY`; never self-declared)
- acquisition URL / SSRF policy for future remote/Git/registry consumers
- package lifecycle audit

It is not part of Stream Data Governance UI.

## 9. Package security status

| Capability | Status |
|---|---|
| No embedded secrets (scan + reject) | `IMPLEMENTED` |
| Canonical digest | `IMPLEMENTED` |
| Signature verification (Ed25519) | `IMPLEMENTED` |
| Trusted key management | `IMPLEMENTED` |
| Unsafe archive/file rejection | `IMPLEMENTED` |
| Declarative-only V1 enforcement | `IMPLEMENTED` |
| Acquisition network/SSRF controls | `IMPLEMENTED` (policy primitives; no remote acquire yet) |
| License/provenance policy enforcement | `IMPLEMENTED` (platform-derived gate; import consumers in M29.6+) |

A package with an invalid signature must not be installable merely because the operator is an Administrator.

License/provenance `ALLOW` does not imply legal approval, technical verification,
or `Verified` / `Official` trust.

Acquisition URL policy validates candidate targets only. It does not fetch
content. Future downloaders must pin validated resolved addresses and revalidate
redirects to limit DNS rebinding risk.

## 10. Security non-goals

Data Relay does not become:

- enterprise IAM;
- identity federation;
- SCIM provisioning system;
- generic secret manager;
- arbitrary executable plugin sandbox in Marketplace V1;
- AI Gateway / AI Proxy product.
