# 015 Backup, Export, Import (Phase 1)

## Purpose

Configuration portability and safe recovery: export/import JSON bundles, workspace snapshots, and clone connector/stream configuration **without** replacing the database, **without** changing StreamRunner transaction ownership, and **without** exporting plaintext credentials.

## Rules

- Read-only export endpoints; no `DROP`, `TRUNCATE`, or destructive restore.
- Import is **additive** or **clone** only: new primary keys; existing rows are not overwritten by ID.
- Routes remain `stream_id` → `destination_id`; mapping and enrichment remain separate rows.
- Checkpoint values in exports are **metadata only**; StreamRunner still owns runtime checkpoint updates after successful delivery.
- Secrets in `auth_json` and sensitive destination fields are **masked** in export JSON; operators re-enter credentials after import when needed.
- Merge/replace import is out of scope for Phase 1.

## API

Mounted under `/api/v1/backup/*` (see implementation).

## Non-Goals (Phase 1)

Binary DB backups, cloud sync, scheduled backups, encrypted vaults, multi-user ownership, remote repositories, full runtime replay.
