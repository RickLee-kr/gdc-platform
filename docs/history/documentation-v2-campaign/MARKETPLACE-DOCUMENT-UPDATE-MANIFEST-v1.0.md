# DATA RELAY MARKETPLACE DOCUMENT UPDATE MANIFEST
Version 1.0 Draft
Baseline: `wave2-marketplace-baseline` @ `362a57dec43d321138fa8aafc848fbfc80303807`
## Survey Rule
The repository `docs/architecture/source-of-truth-index.md` is used as the authority for distinguishing CURRENT product documents from SUPERSEDED / ARCHIVE_CANDIDATE historical evidence. Historical audits and recovery snapshots are intentionally not rewritten.
## New document
- `docs/history/architecture/marketplace/DATA-RELAY-CONNECTOR-MARKETPLACE-ARCHITECTURE-CHARTER-v1.0-DRAFT.md`
## Append-only update targets
1. `docs/history/source-of-truth/PRODUCT-CHARTER-Version-1.2.1-FINAL.txt`
2. `docs/history/source-of-truth/MASTER-WBS-Version-1.2.1-FINAL.txt`
3. `docs/history/source-of-truth/DATA-RELAY-UX-CHARTER-v1.2.1-FINAL.txt`
4. `docs/history/source-of-truth/DATA-RELAY-STREAM-WIZARD-UX-CHARTER-v5.2-FINAL.txt`
5. `docs/ux/DATA-RELAY-ROUTE-PROCESSING-UX-SPEC.md`
6. `docs/history/source-of-truth/GOVERNANCE-UX-CHARTER-v1.1-FINAL.txt`
7. `docs/history/source-of-truth/DATA-RELAY-GOVERNANCE-WORKSPACE-UX-CHARTER-v1.1-FINAL.txt`
8. `docs/reference/governance/DATA-RELAY-GOVERNANCE-WORKSPACE-v1.1-FINAL.txt`
9. `docs/reference/governance/DATA-RELAY-GOVERNANCE-AND-TRANSFORM-POLICY-DRAFT-v1.1-FINAL.txt`
10. `docs/reference/ux/DATA-RELAY-UNION-SCHEMA-UX-SPEC-v1.1-FINAL.txt`
11. `docs/ux/DATA-RELAY-SCHEMA-DRIFT-POLICY-RUNTIME-SPEC.md`
12. `docs/history/source-of-truth/CHATGPT-DATA-RELAY-GUARDRAIL.txt`
13. `docs/architecture/OSS-v1-ARCHITECTURE.md`
14. `docs/ux/dashboard-operational-monitoring.md`
15. `docs/README.md`
16. `docs/getting-started/GETTING-STARTED.md`
17. `docs/release/KNOWN-LIMITATIONS.md`
18. `docs/architecture/route-processing-persist-roadmap.md`
19. `docs/architecture/source-of-truth-index.md`
20. `specs/049-template-registry/spec.md`
21. `specs/013-template-connector-system/spec.md`
22. `specs/001-core-architecture/spec.md`
23. `specs/002-runtime-pipeline/spec.md`
24. `specs/003-db-model/spec.md`
25. `specs/004-delivery-routing/spec.md`
26. `specs/048-runtime-reliability/spec.md`
27. `specs/091-route-processing-architecture/spec.md`
28. `specs/092-per-route-transform/spec.md`
29. `specs/093-per-route-protection/spec.md`
30. `specs/094-per-route-classification/spec.md`
31. `specs/095-per-route-policy/spec.md`
32. `specs/096-route-runtime-delivery/spec.md`
33. `specs/097-route-processing-ux/spec.md`
34. `.specify/memory/constitution.md`
35. `.specify/specs-index.md`
36. `specs/035-rbac-lite/spec.md`
37. `docs/architecture/credential-encryption-at-rest.md`

## Update categories
- Product/WBS: Marketplace product scope and M29 workstream.
- UX/Wizard: Browse/install/create-with-AI while preserving current navigation and Destination First flow.
- Governance: package trust/signing/license administration separated from data governance.
- Union Schema/Schema Drift: package schema is evidence, runtime remains truth.
- Route/Runtime: Marketplace is not a parallel runtime; checkpoint/reliability/route invariants stay unchanged.
- Source Pack/Template Registry: Marketplace evolves `specs/049`; it does not create a competing content model.
- Security/Credential/RBAC: no package secrets, existing credential encryption/auth and RBAC remain authoritative.
- Documentation/limitations: target architecture is clearly marked implementation-pending.

## Explicitly not modified
- `docs/archive/**` historical audits
- `docs/session-recovery/**`
- superseded M13 snapshot/audit documents
- historical RC/GA release notes/checklists
- deployment/runtime operational documents with no Marketplace contract impact
- unrelated destination/source implementation specs that receive no new Marketplace semantics

## Integrity rule
The updater reads each current repository file as raw bytes and writes `original_bytes + marketplace_addendum`. It verifies that the complete original byte sequence remains an exact prefix of the new file. It does not reformat or rewrite the existing body.

## WBS correction
The existing WBS already uses M21–M24 as excluded former AI Gateway milestones and M25–M28 as Enterprise Edition backlog. Marketplace is therefore defined as a new in-scope **Phase G / M29** workstream; M29 is not a child of Phase F and does not change historical completion percentages.
