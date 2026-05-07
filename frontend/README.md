# Runtime Management MVP (Frontend)

## Overview

- **Runtime Management MVP frontend** — operator-facing UI for the GDC Platform runtime APIs.
- **Stack:** React + Vite + TypeScript.
- **Backend:** Talks to existing **FastAPI** runtime HTTP endpoints (`/api/v1/runtime/...`). You must have (or point at) a running API server.
- **Scope:** This UI does **not** own runtime transaction semantics, checkpoint rules, or StreamRunner behavior; those remain server-side per platform specs.

## Runtime UI sections

### Runtime Config

Tabs for **Connector**, **Source**, **Stream**, **Mapping**, **Route**, and **Destination**. Each tab supports loading UI-oriented config and saving changes via the runtime **ui/config** and **ui/save** style endpoints (see API docs / router for exact paths).

### Dashboard

Aggregate runtime summary and recent problem indicators (loads via dashboard summary API).

### Stream Health

Per-stream health view for the current **stream_id** context.

### Stream Stats

Per-stream stats / checkpoint-oriented summary for the current **stream_id**.

### Timeline

Stream-scoped timeline of runtime log events.

### Logs

- **Search** — query filters over persisted logs.
- **Page** — cursor-based paging through logs.
- **Cleanup** — administrative cleanup of old log rows (see Safety notes).

### Failure Trend

Aggregated failure buckets / trend view for investigation.

### Control & Test

- **Start stream / Stop stream** — **real control actions** against the runtime (not previews).
- **HTTP API test**, **Mapping preview**, **Delivery format preview**, **Route delivery preview** — **preview-only** flows; they do not replace production pipeline semantics or live delivery.

## API base URL behavior

- **Default resolution**
  - Build-time env: **`VITE_API_BASE_URL`** (Vite).
  - If unset, the app falls back to **`http://localhost:8000`** (see `api.ts`).
- **Local UI override**
  - Optional override is stored in **`localStorage`** (key used in app: `gdc.apiBaseUrlOverride`).
  - The UI shows the **effective** base URL and provides **Reset API URL** to clear the override.
  - **`requestJson`** resolves the **effective** base URL **per request** (env default plus optional override), so changes apply without reloading the page.

## Local UI preferences

Persisted in **`localStorage`** (keys prefixed `gdc.` — see `localPreferences.ts`):

| Preference | Description |
|------------|-------------|
| **Entity IDs** | Last-used **connector_id**, **source_id**, **stream_id**, **route_id**, **destination_id** fields |
| **Display density** | **Comfortable** (default spacing) or **Compact** (tighter layout) |

**Reset controls** (frontend-only; no API calls):

- **Reset IDs** — clears persisted entity IDs and empties the ID inputs.
- **Reset UI preferences** — restores default UI preferences (e.g. comfortable density).
- **Reset API URL** — clears the optional API base URL override (back to env default / localhost fallback).

## Install / run / build / test / validate

```bash
cd frontend
npm install
npm run dev
npm run test -- --run
npm run build
npm run lint
npm run validate   # test + build + lint (release-style check)
```

### Host-specific Node note

This host may expose **system Node 12** on the default non-interactive `PATH`. **Node 20+** is required for this frontend.

Use an nvm-installed Node and put it first, for example:

```bash
PATH=$HOME/.nvm/versions/node/v22.18.0/bin:$PATH npm run validate
```

Apply the same pattern for `dev`, `test`, `build`, and `lint` if `node -v` is too old.

## Known warnings

Running **Vitest** or **Vite** may print **deprecation warnings** (e.g. esbuild / plugin-related messages). These are **non-fatal** if **`npm run test`**, **`npm run build`**, and **`npm run lint`** all succeed.

Warnings are not suppressed here unless a **simple, config-only** fix is available that does **not** add dependencies or force a major toolchain upgrade.

## Safety notes

- **Preview / test** endpoints (mapping, format, route-delivery preview, HTTP API test, etc.) **do not** perform **live destination delivery** from this UI.
- **Stream Start / Stop** invoke **real** runtime control APIs — treat them as production-impacting where your environment is shared.
- **Logs cleanup** can **delete** old `delivery_logs` (or equivalent persisted log rows) when **`dry_run` is off** — use care in production-like environments.
- **Checkpoint** behavior and success-path delivery remain **owned by the backend runtime**; the frontend does not perform checkpoint updates through preview flows.

## Environment override (build-time)

```bash
VITE_API_BASE_URL=http://localhost:9000 npm run dev
```

The optional **in-browser** override (localStorage) is independent of this and is controlled from the UI.
