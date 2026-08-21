#!/usr/bin/env python3
"""Deterministic OpenAPI export for Data Relay (FastAPI app.openapi()).

Does not start uvicorn or hit a live server. Writes sorted JSON so repeated
exports are byte-stable for the same code + settings surface.

Usage (host shell, pytest-compatible env):

  REQUIRE_AUTH=false APP_ENV=development \\
  DATABASE_URL=postgresql://gdc:gdc@127.0.0.1:55441/gdc_pytest \\
  SECRET_KEY=dev JWT_SECRET_KEY=dev \\
  python scripts/openapi/export_openapi.py [--out artifacts/openapi/openapi.json]
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from pathlib import Path


def _prepare_env() -> None:
    os.environ.setdefault("REQUIRE_AUTH", "false")
    os.environ.setdefault("APP_ENV", "development")
    os.environ.setdefault("SECRET_KEY", "openapi-export-dev-secret")
    os.environ.setdefault("JWT_SECRET_KEY", "openapi-export-dev-secret")
    if not os.environ.get("DATABASE_URL"):
        # Engine is constructed at import; PostgreSQL is required (no SQLite).
        os.environ["DATABASE_URL"] = "postgresql://gdc:gdc@127.0.0.1:55441/gdc_pytest"


def export_schema() -> dict:
    _prepare_env()
    # Import after env pin so app.database binds correctly.
    from app.main import app

    # Force regeneration (avoid stale cached schema after model rebuilds).
    app.openapi_schema = None
    return app.openapi()


def dumps_deterministic(schema: dict) -> str:
    return json.dumps(schema, indent=2, sort_keys=True, ensure_ascii=False) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--out",
        type=Path,
        default=Path("artifacts/openapi/openapi.json"),
        help="Output path for openapi.json",
    )
    parser.add_argument(
        "--print-summary",
        action="store_true",
        help="Print path/component counts and sha256 to stdout",
    )
    args = parser.parse_args()

    try:
        schema = export_schema()
    except Exception as exc:  # noqa: BLE001 — CLI surface
        print(f"OPENAPI_EXPORT=FAIL error={type(exc).__name__}: {exc}", file=sys.stderr)
        return 1

    text = dumps_deterministic(schema)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(text, encoding="utf-8")
    digest = hashlib.sha256(text.encode("utf-8")).hexdigest()

    if args.print_summary:
        paths = schema.get("paths") or {}
        comps = schema.get("components") or {}
        print(
            "OPENAPI_EXPORT=PASS "
            f"paths={len(paths)} "
            f"schemas={len((comps.get('schemas') or {}))} "
            f"sha256={digest} "
            f"out={args.out}"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
