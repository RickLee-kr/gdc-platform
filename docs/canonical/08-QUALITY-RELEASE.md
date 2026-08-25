# Data Relay Quality & Release

**Document Version:** 2.0  
**Last Updated:** 2026-08-25  
**Status:** CANONICAL

## 1. Quality objective

Data Relay quality verification must prove system behavior without depending on manual GUI observation.

GUI acceptance is valuable for user workflows, but runtime correctness must be verified through APIs, database/runtime evidence, sink observations, checkpoints, and fault injection.

## 2. Test layers

### Unit / focused

Use for:

- parsers
- validators
- adapters
- strategies
- policies
- normalization
- state transitions

### API / contract

Use for:

- OpenAPI contract
- RBAC
- validation/error schemas
- lifecycle APIs
- compatibility

### Runtime integration

Use real runtime components and controlled dependencies such as:

- PostgreSQL
- WireMock
- MinIO where applicable
- SFTP fixture systems
- webhook/syslog sinks
- fault injection

### End-to-end

Validate user-visible workflows plus runtime evidence.

### Human acceptance

Reserve for a small number of workflows where usability and browser behavior matter.

## 3. Failure/recovery verification

A fault scenario is not complete when an error appears.

It must prove:

```text
fault injected
→ expected failure observed
→ unsafe checkpoint movement did not occur
→ configured retry/recovery occurred
→ destination recovered
→ retained/pending data delivered as expected
→ final state healthy
```

## 4. Full Matrix policy

The 32,184-case Full Matrix is a major integration/final acceptance gate, not a test that should run after every isolated change.

Use:

- targeted tests during M29 sub-phases;
- subsystem integration after meaningful boundaries;
- Full Matrix at major integration/final gate.

A historical Full Matrix pass must not be presented as acceptance of later Marketplace changes.

## 5. Marketplace quality gates

Marketplace requires targeted verification for:

- Manifest compatibility
- package validation
- archive safety
- registry roots/collision rules
- install/upgrade/rollback/uninstall
- dependency protection
- registry cache invalidation
- security/signature/secret-scan policy
- offline package flow
- UI install/test workflow (`TARGET` until UI ships)
- running Stream non-mutation on package upgrade

Current focused suites include `tests/test_marketplace_manifest_v2.py`, `tests/test_marketplace_multi_root_registry.py`, `tests/test_marketplace_package_lifecycle.py`, `tests/test_marketplace_registry_invalidation.py`, and `tests/test_marketplace_package_trust.py`.

## 6. Connector verification tiers

Trust and technical evidence must remain distinct.

Suggested test expectations:

| Tier | Minimum technical evidence |
|---|---|
| Local Draft | schema/static validation |
| Imported | schema/license/provenance/static validation |
| Community | fixture/mock contract validation |
| Verified | recorded live vendor/API verification |
| Official | maintained verification plus supported regression expectations |

A signature proves package authenticity/integrity, not that the vendor API works.

## 7. Release evidence

Release artifacts should separate:

### Current release contract

- current known limitations
- install/upgrade guidance
- production checklist
- compatibility

### Historical evidence

- RC audit
- GA checklist snapshot
- historical release notes
- campaign closure
- old performance/implementation reports

Historical release evidence moves to `docs/history/releases/` in Phase 2.

## 8. Documentation gate

Release readiness includes documentation integrity:

- canonical docs consistent;
- status fields accurate;
- current known limitations accurate;
- historical material not indexed as current authority;
- no broken links;
- English-only official docs;
- implementation claims backed by tests/code.

## 9. Marketplace final acceptance

Final Marketplace completion should include:

- targeted M29 regression;
- built-in package normalization/compatibility;
- required connector/stream verification;
- final agreed Full Matrix;
- human acceptance scenarios.

Until that gate is run after Marketplace integration, the historical 32,184 baseline remains historical evidence rather than current final acceptance.
