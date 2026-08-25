# Operator/Developer Runbook (Local)

## Purpose

This runbook describes how to run the backend and frontend locally as separate processes.

## Docker: platform stack vs development validation lab

These are **different** workflows (different Postgres databases and different seeding):

| Goal | Start with |
| --- | --- |
| Production-style stack (nginx + API + `gdc` DB) | `docs/operations/deployment/docker-platform.md` |
| `[DEV VALIDATION]` lab entities + `gdc` + WireMock | `./scripts/dev/start-platform.sh` — see `docs/testing/dev-validation-lab.md` for the older standalone lab |

Canonical side-by-side table and troubleshooting: **`docs/development/local-docker-workflow.md`**.

## Release candidate installs and upgrades

English operator guides for scripted installs, upgrades, backups, TLS, and RC verification live under **`docs/operations/deployment/`** (for example `install-guide.md`, `upgrade-guide.md`, `release-checklist.md`, `https-reverse-proxy.md`, **`uvicorn-gunicorn-production.md`**). Backup/restore authority: **`docs/operations/data-management/backup-restore.md`**. Operational retention guidance: **`docs/operations/data-management/retention-policies.md`**. Release automation scripts are under `scripts/release/` (see `specs/038-release-candidate-deployment/spec.md`). Non-destructive retention helpers: **`scripts/ops/`**.

## Platform Reverse-Proxy Ports

For the Docker platform stack, browser ports are configured in `.env`:

```env
GDC_HTTP_PORT=18080
GDC_HTTPS_PORT=18443
GDC_PUBLIC_HTTPS_PORT=18443
```

Change the values directly in `.env` or through the Administrator-only `PUT /api/v1/admin/network-settings` API. The API persists the values and returns `restart_required=true`; it does not restart containers. Apply the Docker port binding change with:

```bash
docker compose -f docker-compose.platform.yml up -d --force-recreate reverse-proxy
```

## Architecture Reminder

- Backend: FastAPI runtime API server
- Frontend: separate Vite app under `frontend/`
- FastAPI static frontend serving is out of scope

## Prerequisites

- Python environment for backend dependencies
- PostgreSQL running locally or reachable by `DATABASE_URL`
- Node.js 20+ for frontend

Node example for this host:

```bash
export PATH=$HOME/.nvm/versions/node/v22.18.0/bin:$PATH
```

## Backend Startup

Backend requires PostgreSQL. SQLite fallback is not supported.

Use the backend startup command already documented in the repository root README:

```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

If your team uses a different wrapper command, keep the same app target and environment config.

## Frontend Startup

Run frontend separately:

```bash
cd frontend
npm install
npm run dev
```

API base URL defaults and override behavior are documented in `frontend/README.md`:

- Vite env (`VITE_API_BASE_URL`)
- local UI override (browser localStorage-backed)

## Focused Validation Commands

Backend smoke only:

```bash
pytest tests/test_runtime_save_smoke_endpoint.py tests/test_runtime_ui_smoke_endpoint.py
```

Frontend validate:

```bash
cd frontend
PATH=$HOME/.nvm/versions/node/v22.18.0/bin:$PATH npm run validate
```

## Safety Notes

- Preview flows are preview-only.
- StreamRunner owns runtime transaction semantics.
- Checkpoints are backend runtime-owned and update only after successful destination delivery.
- `delivery_logs` stores committed runtime outcomes only.
- `run_failed` is logger-only.
