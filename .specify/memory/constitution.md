# Data Relay Constitution

**Document Version:** 2.0  
**Last Updated:** 2026-08-25  
**Status:** Engineering invariants only

Product, UX, and roadmap authority: [`docs/canonical/`](../../docs/canonical/).  
Reading order: [`docs/README.md`](../../docs/README.md).  
Detailed specs: [`.specify/specs-index.md`](../specs-index.md).

This constitution records **non-negotiable engineering invariants**. It does not duplicate product charter, UX workflows, or Marketplace roadmap narrative.

---

## 1. Authority

1. Product intent: `docs/canonical/01-PRODUCT-CHARTER.md`
2. Architecture contract: `docs/canonical/02-SYSTEM-ARCHITECTURE.md` and domain canonical docs
3. Implementation truth: runtime code, migrations, APIs, and tests
4. Detailed engineering reference: `specs/*` (full path is identity; see specs index)
5. Historical docs never override canonical docs or verified runtime behavior

When architecture and implementation differ: record the conflict; do not silently rewrite either.

---

## 2. Entity and topology invariants

1. Connector ≠ Stream.
2. Source ≠ Destination.
3. Stream is the runtime execution unit.
4. Stream and Destination connect only through Route.
5. Multi-destination fan-out must be preserved (`One Stream → Many Routes → Many Destinations`).
6. Mapping ≠ Enrichment internally (even when UX presents Transform).
7. Do not collapse Connector, Source, Stream, Destination, and Route into one object.
8. Do not make Connector the runtime unit.
9. Do not bypass Route for Destination delivery.

---

## 3. Route processing order

Destination-specific processing order:

```text
Transform → Protection → Classification → Policy → Delivery
```

Shared Stream-scoped observation may occur before route processing. Do not create a parallel runtime for route stages.

---

## 4. Checkpoint invariant

Checkpoint advances only after required delivery success (or explicitly defined absorbed-success semantics).

Forbidden:

- advancing checkpoint after fetch/parse/mapping alone;
- advancing checkpoint because a Marketplace package was installed or upgraded;
- advancing checkpoint because a configuration was previewed.

---

## 5. Reliability invariants

1. Remain lightweight by default (`DIRECT` remains valid).
2. Persistent buffering must never be globally mandatory.
3. Reliability mode is selectable per Stream / supported path.
4. Source rate limit and Destination rate limit both exist as separate concerns.
5. HTTP resilience, circuit breaker, adaptive concurrency, backpressure, durable queue, and checkpoint are separate layers — do not merge them.
6. Destination failure must not automatically imply Source failure.
7. Persistent delivery semantics are at-least-once where applicable; do not promise exactly-once.
8. Do not introduce Kafka-scale distributed stream processing as the default runtime.

Authoritative product/runtime summary: `docs/canonical/03-RUNTIME-RELIABILITY.md`.  
Detailed policy reference: `specs/048-runtime-reliability/spec.md`.

---

## 6. Runtime pipeline ownership

StreamRunner is the sole transaction owner for runtime DB writes.

- Runtime services stage DB changes only; they must not independently commit runtime DB writes.
- No commit is allowed after StreamRunner rollback.
- Destination network I/O must not hold inappropriate long-lived caller DB transactions.
- Delivery failure evidence for route-level failures must be structured and persisted where the runtime design requires it.

---

## 7. Database policy

- PostgreSQL only (production, development, and tests).
- SQLite is not supported as a fallback, local shortcut, or compatibility layer.

---

## 8. Plugin / adapter isolation

Runtime core orchestrates execution. Vendor/source/auth/destination differences belong in adapters, strategies, or declarative package definitions.

Mandatory:

1. No large vendor/source/auth/destination `if/elif` chains in StreamRunner.
2. New types are additive via registry registration.
3. Existing working adapters are not modified unless the task explicitly requires a fix there.
4. No parallel authentication, HTTP retry, delivery, or checkpoint engines.

Conceptual dispatch:

```text
StreamRunner
  → SourceAdapterRegistry
  → shared processing / route stages
  → DestinationAdapterRegistry
  → Checkpoint decision
```

---

## 9. Marketplace package invariants

Marketplace/Source Pack work must obey:

1. Marketplace package / Source Pack is **not** a runtime execution entity.
2. Built-in and installed integrations share one package contract and the existing runtime.
3. Package files contain **no** credentials/secrets.
4. Marketplace V1 is **declarative-only** (no arbitrary package Python/JavaScript/shell/native code in-process).
5. Package origin cannot bypass Credential, HTTP resilience, rate-limit, queue, route, governance, or checkpoint rules.
6. Package install/upgrade does not silently enable Streams or advance checkpoints.
7. Runtime remains implementation truth for shipped behavior.

Product detail: `docs/canonical/04-CONNECTORS-MARKETPLACE.md`.

---

## 10. Bootstrap admin credential contract

Fresh-install administrator bootstrap:

- default username `admin`
- default password `admin`
- persist `must_change_password=true`
- `GDC_SEED_ADMIN_PASSWORD` is an optional explicit override only
- randomly generated administrator passwords are forbidden
- repeated bootstrap must never overwrite an existing `admin` password hash
- password reset for an existing `admin` is an explicit operator recovery action

---

## 11. English-only official artifacts

Official project documentation, committed product text, APIs, code comments, tests, schemas, seed data, and specifications are English-only.

Korean (or other languages) may appear in external discussion, temporary prompts, or non-committed notes — not in committed official artifacts.

---

## 12. Forbidden product expansions (engineering)

Do not implement, inside this repository’s current OSS product scope:

- a second connector execution runtime;
- Marketplace-specific governance/OAuth/token engines;
- AI Gateway / AI Proxy as product scope (existing AI specs are `OUT_OF_SCOPE`);
- enterprise IAM / SSO federation platform behavior as a substitute for platform RBAC.
