#!/usr/bin/env python3
"""Compare FastAPI routes to exported OpenAPI and flag contract gaps.

Reports (does not mutate product APIs):
  - undocumented endpoints (in app.routes, missing from OpenAPI paths)
  - schema-only paths (in OpenAPI, no matching route)
  - missing requestBody / response content where FastAPI declares models
  - auth-required endpoints lacking OpenAPI security metadata
  - internal/test-ish paths still include_in_schema=True
  - include_in_schema=False routes (intentional omissions)

Usage:

  REQUIRE_AUTH=false APP_ENV=development \\
  DATABASE_URL=postgresql://gdc:gdc@127.0.0.1:55441/gdc_pytest \\
  SECRET_KEY=dev JWT_SECRET_KEY=dev \\
  python scripts/openapi/audit_openapi_routes.py \\
    [--schema artifacts/openapi/openapi.json] \\
    [--out artifacts/openapi/route-audit.json]
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path
from typing import Any


# Product "test connection" APIs (destinations/.../test) are not internal.
INTERNAL_PATH_HINTS = re.compile(
    r"(dev-validation|/debug|/fixture|/lab\b)",
    re.IGNORECASE,
)


def _prepare_env() -> None:
    os.environ.setdefault("REQUIRE_AUTH", "false")
    os.environ.setdefault("APP_ENV", "development")
    os.environ.setdefault("SECRET_KEY", "openapi-export-dev-secret")
    os.environ.setdefault("JWT_SECRET_KEY", "openapi-export-dev-secret")
    if not os.environ.get("DATABASE_URL"):
        os.environ["DATABASE_URL"] = "postgresql://gdc:gdc@127.0.0.1:55441/gdc_pytest"


def _normalize_path(path: str) -> str:
    # Starlette uses {param}; OpenAPI uses {param} — keep as-is, strip trailing slash
    # except root.
    if path != "/" and path.endswith("/"):
        return path.rstrip("/")
    return path


def _route_methods(route) -> set[str]:
    methods = getattr(route, "methods", None) or set()
    return {m.upper() for m in methods if m.upper() not in {"HEAD", "OPTIONS"}}


def collect_app_routes(app) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for route in app.routes:
        path = getattr(route, "path", None)
        if not path:
            continue
        methods = _route_methods(route)
        if not methods and route.__class__.__name__ == "APIRoute":
            continue
        include = bool(getattr(route, "include_in_schema", True))
        endpoint = getattr(route, "endpoint", None)
        response_model = getattr(route, "response_model", None)
        # Body field presence: FastAPI stores dependant
        dependant = getattr(route, "dependant", None)
        has_body = False
        if dependant is not None:
            has_body = bool(getattr(dependant, "body_params", None))
        name = getattr(route, "name", None) or (getattr(endpoint, "__name__", None) if endpoint else None)
        for method in sorted(methods) or ["*"]:
            rows.append(
                {
                    "method": method,
                    "path": _normalize_path(path),
                    "include_in_schema": include,
                    "name": name,
                    "has_response_model": response_model is not None,
                    "has_body_params": has_body,
                    "endpoint_module": getattr(endpoint, "__module__", None) if endpoint else None,
                }
            )
    return rows


def openapi_operations(schema: dict) -> dict[tuple[str, str], dict[str, Any]]:
    out: dict[tuple[str, str], dict[str, Any]] = {}
    for path, item in (schema.get("paths") or {}).items():
        if not isinstance(item, dict):
            continue
        for method, op in item.items():
            if method.startswith("x-") or method in {"parameters", "summary", "description", "servers"}:
                continue
            if not isinstance(op, dict):
                continue
            out[(method.upper(), _normalize_path(path))] = op
    return out


def audit(app, schema: dict) -> dict[str, Any]:
    routes = collect_app_routes(app)
    ops = openapi_operations(schema)
    security_schemes = ((schema.get("components") or {}).get("securitySchemes")) or {}
    global_security = schema.get("security") or []

    undocumented: list[dict[str, Any]] = []
    intentional_hidden: list[dict[str, Any]] = []
    missing_request_body: list[dict[str, Any]] = []
    missing_response_schema: list[dict[str, Any]] = []
    auth_metadata_gaps: list[dict[str, Any]] = []
    internal_exposed: list[dict[str, Any]] = []

    route_keys: set[tuple[str, str]] = set()
    for row in routes:
        key = (row["method"], row["path"])
        if row["method"] == "*":
            continue
        route_keys.add(key)
        if not row["include_in_schema"]:
            intentional_hidden.append(row)
            continue
        op = ops.get(key)
        if op is None:
            undocumented.append(row)
            continue
        if row["has_body_params"] and "requestBody" not in op:
            missing_request_body.append({**row, "issue": "route has body params but OpenAPI lacks requestBody"})
        # 2xx response content
        responses = op.get("responses") or {}
        has_json_schema = False
        for code, resp in responses.items():
            if not str(code).startswith("2"):
                continue
            content = (resp or {}).get("content") or {}
            for _ctype, media in content.items():
                if isinstance(media, dict) and media.get("schema") is not None:
                    has_json_schema = True
        if row["has_response_model"] and not has_json_schema:
            missing_response_schema.append(
                {**row, "issue": "response_model set but no 2xx response schema in OpenAPI"}
            )
        # Auth: middleware enforces JWT when REQUIRE_AUTH; OpenAPI should declare security
        # for non-bypass API paths under API_PREFIX (except auth login/refresh/logout).
        path = row["path"]
        is_api = path.startswith("/api/")
        is_public_auth = any(
            path.startswith(p)
            for p in (
                "/api/v1/auth/login",
                "/api/v1/auth/refresh",
                "/api/v1/auth/logout",
                "/health",
            )
        ) or path in {"/openapi.json", "/docs", "/redoc"}
        op_security = op.get("security", global_security)
        if is_api and not is_public_auth and not op_security and not security_schemes:
            auth_metadata_gaps.append(
                {
                    **row,
                    "issue": "no components.securitySchemes / operation security (auth is middleware-only)",
                }
            )
        if row["include_in_schema"] and INTERNAL_PATH_HINTS.search(path):
            internal_exposed.append(row)

    schema_only = []
    for key, op in ops.items():
        if key not in route_keys:
            schema_only.append({"method": key[0], "path": key[1], "operationId": op.get("operationId")})

    # Deduplicate auth gap noise: one summary + count + sample
    auth_gap_count = len(auth_metadata_gaps)
    auth_sample = auth_metadata_gaps[:15]

    return {
        "summary": {
            "routes_audited": len([r for r in routes if r["method"] != "*"]),
            "openapi_operations": len(ops),
            "undocumented_endpoints": len(undocumented),
            "schema_only_operations": len(schema_only),
            "intentional_include_in_schema_false": len(intentional_hidden),
            "missing_request_body": len(missing_request_body),
            "missing_response_schema": len(missing_response_schema),
            "auth_metadata_gaps": auth_gap_count,
            "internal_or_test_exposed": len(internal_exposed),
            "security_schemes_defined": sorted(security_schemes.keys()),
        },
        "undocumented_endpoints": undocumented,
        "schema_only_operations": schema_only,
        "intentional_hidden": intentional_hidden,
        "missing_request_body": missing_request_body,
        "missing_response_schema": missing_response_schema,
        "auth_metadata_gaps_sample": auth_sample,
        "internal_or_test_exposed": internal_exposed,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--schema", type=Path, default=Path("artifacts/openapi/openapi.json"))
    parser.add_argument("--out", type=Path, default=Path("artifacts/openapi/route-audit.json"))
    parser.add_argument("--export-if-missing", action="store_true")
    args = parser.parse_args()

    _prepare_env()
    from app.main import app

    if args.export_if_missing or not args.schema.is_file():
        from scripts.openapi.export_openapi import dumps_deterministic, export_schema

        schema = export_schema()
        args.schema.parent.mkdir(parents=True, exist_ok=True)
        args.schema.write_text(dumps_deterministic(schema), encoding="utf-8")
    else:
        schema = json.loads(args.schema.read_text(encoding="utf-8"))

    report = audit(app, schema)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    s = report["summary"]
    print(
        "ROUTE_AUDIT "
        f"routes={s['routes_audited']} "
        f"ops={s['openapi_operations']} "
        f"undocumented={s['undocumented_endpoints']} "
        f"missing_body={s['missing_request_body']} "
        f"missing_resp={s['missing_response_schema']} "
        f"auth_gaps={s['auth_metadata_gaps']} "
        f"internal_exposed={s['internal_or_test_exposed']} "
        f"out={args.out}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
