# Operator/Developer Runbook (Local)

## Purpose

This runbook describes how to run the backend and frontend locally as separate processes.

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
