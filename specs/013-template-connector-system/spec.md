# Template Connector System (Phase 1)

## Purpose

Filesystem-backed integration templates accelerate operator onboarding. Templates are **configuration generators only** — they are not runtime entities and are not executed by StreamRunner.

## Rules

- Templates MUST NOT become runtime objects, runners, or StreamRunner transaction participants.
- Instantiation creates normal `Connector`, `Source`, `Stream`, `Mapping`, `Enrichment`, `Checkpoint`, and optionally `Route` rows using the same persistence semantics as manual CRUD.
- New streams created from templates MUST be `enabled=false` and `status=STOPPED` until the operator explicitly starts them.
- Checkpoint rows may be created with initial cursor values; StreamRunner still owns checkpoint updates after successful delivery.

## API

- `GET /api/v1/templates` — list template summaries from static JSON under `templates/`.
- `GET /api/v1/templates/{template_id}` — full template document for preview.
- `POST /api/v1/templates/{template_id}/instantiate` — additive create of platform entities; returns created IDs and a suggested UI redirect path.

## Non-Goals (Phase 1)

Marketplace, remote sync, user uploads, version rollback, package installer, Python adapter uploads, sandboxed execution, template auto-update, multi-user sharing.

---

## DATA RELAY MARKETPLACE ADDENDUM v1.0 — Marketplace Transition

Status: Architecture Direction / Implementation Pending
Authority: Additive only. Existing Product Charter, Runtime Is Truth, Stream/Route, Credential, Governance, and Checkpoint invariants remain authoritative.
Reference: `docs/history/architecture/marketplace/DATA-RELAY-CONNECTOR-MARKETPLACE-ARCHITECTURE-CHARTER-v1.0-DRAFT.md`


Phase-1 template connector files remain supported as legacy package shapes during Marketplace migration.
They SHOULD be normalized through `specs/049` Source Pack compatibility rather than replaced by a parallel Marketplace runtime.

Existing instantiate semantics remain unchanged until an approved Marketplace phase explicitly evolves them.
