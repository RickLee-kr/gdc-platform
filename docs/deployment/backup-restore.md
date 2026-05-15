# Backup and restore (PostgreSQL)

Operator scripts live under `scripts/release/`:

| Script | Purpose |
|--------|---------|
| `backup-before-upgrade.sh` | `pg_dump` from the Compose `postgres` service, gzip, timestamped filename |
| `restore.sh` | Restore a gzip SQL dump into the Compose database (destructive; explicit confirmations) |

## Backup

### Requirements

- `docker` and `docker compose` available.
- Target stack running with a healthy `postgres` service.
- `GDC_RELEASE_COMPOSE_FILE` aligned with the stack (default `docker-compose.platform.yml`).

### Output layout

- Default directory: `deploy/backups/` (override with `GDC_BACKUP_DIR`; must still resolve **under the repository root**).
- Filenames: `gdc_pg_<UTC-timestamp>.sql.gz` plus a small `backup_<timestamp>.log`.

### Safety rules

- **Path safety**: refuses backup roots that are not under the repository checkout (mitigates accidental writes to host system paths) and refuses obvious volatile roots such as `/tmp` / `/var/tmp` prefixes.
- **No volume deletion**: scripts never run `docker compose down -v` or `docker volume rm`.
- **PostgreSQL-only** platform policy is unchanged; backups are logical SQL dumps from PostgreSQL.

### Environment knobs

| Variable | Default | Meaning |
|----------|---------|---------|
| `GDC_RELEASE_COMPOSE_FILE` | `docker-compose.platform.yml` | Compose file path relative to repo root |
| `GDC_BACKUP_DIR` | `deploy/backups` | Output directory (must stay under repo root) |
| `GDC_BACKUP_DB_NAME` | `gdc` | Database name inside the container |
| `GDC_BACKUP_DB_USER` | `gdc` | Role for `pg_dump` |

## Restore

Restore is **destructive** for the target database inside the Compose PostgreSQL instance.

### Hard requirements

1. Environment: `RESTORE_CONFIRM=YES_I_UNDERSTAND`
2. Interactive prompt: you must type the **exact** database name (`gdc` or `gdc_test` when using `GDC_RESTORE_DB_NAME`) to proceed.
3. **Unknown DB guard**: `GDC_RESTORE_DB_NAME` must be `gdc` or `gdc_test`. Other names are refused to avoid targeting unexpected catalogs.

### Example

```bash
export GDC_RELEASE_COMPOSE_FILE=docker-compose.platform.yml
export GDC_RESTORE_DB_NAME=gdc
RESTORE_CONFIRM=YES_I_UNDERSTAND ./scripts/release/restore.sh deploy/backups/gdc_pg_20260101T000000Z.sql.gz
```

### After restore

- Run `alembic upgrade head` if the restored data is from an older schema revision (same pattern as install/upgrade: `docker compose ... run --rm api alembic upgrade head`).
- Verify application health (`/health`, Maintenance Center, sample authenticated API).

### What restore does **not** do

- Does not restore Docker volume metadata beyond what is inside the dump.
- Does not validate application-level secrets or connector credentials beyond what is stored in the database.
- Does not bypass RBAC or StreamRunner semantics — those remain enforced at runtime.

## Operational alignment

- Retention and cleanup APIs remain separate (`specs/034-data-retention/spec.md`); backups are operator-driven.
- For JSON export/import of configuration entities, see `specs/015-backup-export-import/spec.md` (distinct from raw `pg_dump`).
