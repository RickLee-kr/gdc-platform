#!/usr/bin/env python3
"""Create the gdc_pytest (or gdc_e2e_test) catalog on the lab server if missing (idempotent).

Connects via the ``postgres`` maintenance database on the same host/port/credentials as
``TEST_DATABASE_URL`` / ``DATABASE_URL``. Safe to run against existing volumes where
``docker-entrypoint-initdb.d`` did not run.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path
from urllib.parse import urlunparse

from sqlalchemy import create_engine, text

_REPO_ROOT = Path(__file__).resolve().parents[2]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from tests.db_test_policy import (  # noqa: E402
    DEFAULT_PYTEST_DATABASE_URL,
    catalog_name_from_database_url,
    validate_host_pytest_catalog,
)


def _maintenance_url(db_url: str, maintenance_db: str = "postgres") -> str:
    from urllib.parse import urlparse

    u = urlparse(db_url)
    return urlunparse((u.scheme, u.netloc, f"/{maintenance_db}", "", "", ""))


def main() -> int:
    url = (
        os.environ.get("TEST_DATABASE_URL")
        or os.environ.get("DATABASE_URL")
        or DEFAULT_PYTEST_DATABASE_URL
    )
    name = catalog_name_from_database_url(url)
    validate_host_pytest_catalog(name)

    admin_url = _maintenance_url(url)
    engine = create_engine(admin_url, isolation_level="AUTOCOMMIT")
    try:
        with engine.connect() as conn:
            row = conn.execute(
                text("SELECT 1 FROM pg_database WHERE datname = :n"),
                {"n": name},
            ).first()
            if row is not None:
                print(f"Catalog {name!r} already exists — nothing to do.")
                return 0
            # ``name`` is allow-list vetted (alphanumeric + underscore).
            if not name.replace("_", "").isalnum():
                print(f"ERROR: invalid catalog name {name!r}", file=sys.stderr)
                return 1
            conn.execute(text(f'CREATE DATABASE "{name}" OWNER gdc'))
        print(f"Created PostgreSQL catalog {name!r} (OWNER gdc).")
    finally:
        engine.dispose()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
