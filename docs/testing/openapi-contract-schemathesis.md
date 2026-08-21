# OpenAPI contract audit & Schemathesis PoC (QA Track D)

Goal: make the Data Relay OpenAPI contract exportable and auditable **before** enabling Schemathesis as a CI mandatory gate.

## Deterministic export

Do **not** rely on a live `GET /openapi.json` for CI artifacts (SPA catch-all / lab env can obscure failures). Export in-process:

```bash
export PYTHONPATH=. REQUIRE_AUTH=false APP_ENV=development
export DATABASE_URL=postgresql://gdc:gdc@127.0.0.1:55441/gdc_pytest
export SECRET_KEY=dev JWT_SECRET_KEY=dev
python3 scripts/openapi/export_openapi.py --print-summary
```

Output is sorted-key JSON under `artifacts/openapi/openapi.json` (gitignored via `artifacts/`). Repeated runs produce identical SHA-256 for the same code + settings surface.

`app.main.custom_openapi()` injects `components.securitySchemes.HTTPBearer` and per-operation `security` for non-public `/api/*` routes. Auth enforcement remains middleware (`REQUIRE_AUTH`); this is contract metadata only.

## Route audit

```bash
python3 scripts/openapi/audit_openapi_routes.py --schema artifacts/openapi/openapi.json
```

Checks undocumented endpoints, request/response model gaps, auth metadata gaps, and lab/internal exposure (`dev-validation`, etc.).

## Schemathesis PoC (subset only)

```bash
python3 -m venv /tmp/gdc-schemathesis-venv
/tmp/gdc-schemathesis-venv/bin/pip install -r requirements-openapi.txt
export PATH="/tmp/gdc-schemathesis-venv/bin:$PATH"
python3 scripts/openapi/schemathesis_poc.py --base-url http://127.0.0.1:8000
```

Default subset: `/health`, `/api/v1/auth/login`, `/api/v1/sources/`, `/api/v1/runtime/health/overview`.

Or: `scripts/openapi/run_track_d.sh`

**Not** a PR-required full-API fuzz gate.

## Defect vs false positive

| Signal | Classification |
| --- | --- |
| Undocumented HTTP status that the handler actually returns | PRODUCT_DEFECT (document `responses=`) |
| Response body violates declared schema | PRODUCT_DEFECT |
| 401 when `REQUIRE_AUTH=false` / missing securitySchemes historically | SCHEMATHESIS_FALSE_POSITIVE / env mismatch |
| Product `.../test` connection endpoints flagged as "internal" by naive path heuristics | FALSE_POSITIVE heuristic (audit script excludes these) |
| Invalid `Authorization` synthesized because `securitySchemes` exist, while `REQUIRE_AUTH=false` still rejects bad tokens | SCHEMATHESIS_FALSE_POSITIVE (PoC disables `--generation-with-security-parameters`) |
| Negative fuzz sends non-JSON body → framework `400` with `detail: string` vs documented auth/domain `400` object | SCHEMATHESIS_FALSE_POSITIVE for subset dry-run |

## Known fixes landed in Track D

1. Missing `IncrementalFetchStrategy` / `StreamReplayMode` aliases blocked `app.openapi()` (Pydantic incomplete model).
2. `POST /auth/login` documents HTTP 400 `USER_AUTH_FAILED`.
3. `POST /sources/` documents HTTP 404 `CONNECTOR_NOT_FOUND`.
4. Lab `GET /admin/dev-validation/status` excluded from schema (`include_in_schema=False`).
5. OpenAPI bearer security metadata added without changing runtime auth semantics.
