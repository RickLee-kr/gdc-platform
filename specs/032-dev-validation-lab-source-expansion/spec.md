# 032 Dev Validation Lab — S3 / DATABASE_QUERY / REMOTE_FILE expansion

## Purpose

Document **optional**, **isolated** development validation lab additions that continuously exercise `S3_OBJECT_POLLING`, `DATABASE_QUERY`, and `REMOTE_FILE_POLLING` without changing production compose, platform startup defaults, or StreamRunner checkpoint semantics.

## Rules

- `ENABLE_DEV_VALIDATION_LAB` remains **`false`** in `docker-compose.platform.yml`.
- Fixture databases and SSH endpoints are **not** the platform catalog (`gdc` / `datarelay` policy unchanged for the main API).
- Checkpoint updates remain **only after successful destination delivery** (no StreamRunner semantic changes).

## Feature flags

| Flag | Role |
| --- | --- |
| `ENABLE_DEV_VALIDATION_S3` | Seed + run `dev_lab_s3_object_polling` when MinIO credentials exist. |
| `ENABLE_DEV_VALIDATION_DATABASE_QUERY` | Seed + run DB query lab validations. |
| `ENABLE_DEV_VALIDATION_REMOTE_FILE` | Seed + run SFTP/SCP lab validations (passwords required). |
| `ENABLE_DEV_VALIDATION_PERFORMANCE` | Persist last perf snapshot JSON on continuous validation rows (smoke only). |

`./scripts/validation-lab/start.sh` (underlying `scripts/dev-validation/start-dev-validation-lab.sh`) exports **`ENABLE_DEV_VALIDATION_S3` / `DATABASE_QUERY` / `REMOTE_FILE` default `true`** so the full adapter matrix is visible after `./scripts/testing/source-e2e/seed-fixtures.sh`; `app/config.py` remains **`false`** for non-lab processes.

## Infrastructure

See `docker-compose.test.yml` services behind profile **`dev-validation`**: `minio-test`, `postgres-query-test`, `mysql-query-test`, `mariadb-query-test`, `sftp-test`, `ssh-scp-test`.

## Seeds

`scripts/testing/source-expansion/seed-*.sh` populate external fixtures; run after containers are healthy.
