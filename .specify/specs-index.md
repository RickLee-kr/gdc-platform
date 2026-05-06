# Spec Index

## 001 Core Architecture
Path: `specs/001-core-architecture/spec.md`

Defines:
- Connector / Source / Stream / Destination / Route separation
- Core platform boundaries
- MVP architecture constraints

## 002 Runtime Pipeline
Path: `specs/002-runtime-pipeline/spec.md`

Defines:
- Stream runtime execution
- Polling pipeline
- Mapping / Enrichment / Fan-out / Checkpoint order
- Failure behavior

## 003 DB Model
Path: `specs/003-db-model/spec.md`

Defines:
- Connector, Source, Stream, Mapping, Enrichment, Destination, Route, Checkpoint, Log models
- DB relationship rules

## 004 Delivery Routing
Path: `specs/004-delivery-routing/spec.md`

Defines:
- Multi destination routing
- Syslog/Webhook delivery
- Route failure policy
- Destination rate limit

## Database Policy

All database implementations must target PostgreSQL.
SQLite must not be used as a fallback.
All migrations, indexes, and query validation rules are PostgreSQL-based.

---

## Mapping UI UX Policy

MVP Mapping UI must provide a preview-first, non-developer-friendly workflow inspired by WebhookRelay-style payload preview UX.

MVP includes:

- JSON Tree Raw Payload Preview
- click-based JSONPath generation
- Mapping Table
- Raw / Mapped / Enriched Final Preview
- Final Preview matching actual destination payload

Phase 2 includes:

- JSON Tree to Mapping Table Drag & Drop
- duplicate mapping warning
- overwrite / append behavior

Drag & Drop is explicitly not part of MVP.

---
