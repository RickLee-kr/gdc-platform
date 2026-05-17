"""Host pytest database allowlist — destructive fixtures must never target the live API catalog."""

from __future__ import annotations

from urllib.parse import urlparse

# Default URL for host pytest ontology/aggregate validation.
DEFAULT_PYTEST_DATABASE_URL = "postgresql://gdc_ontology:gdc_ontology_pw@127.0.0.1:55440/gdc_ontology_test"

# Positive allowlist: only these PostgreSQL *catalog* names may receive TRUNCATE / DROP SCHEMA from conftest.
ALLOWED_PYTEST_DATABASE_CATALOGS = frozenset({"gdc_ontology_test", "gdc_pytest", "gdc_e2e_test"})

# Explicitly blocked names (clearer errors than "not in allowlist").
_FORBIDDEN_PYTEST_CATALOGS = frozenset(
    {
        "datarelay",  # Docker API + dev-validation lab default; shared with running stack
        "gdc",  # production-style platform catalog
        "postgres",  # maintenance DB
        "template0",
        "template1",
    }
)


def catalog_name_from_database_url(url: str) -> str:
    path = urlparse(url).path.strip("/")
    return path.split("/")[-1] if path else ""


def validate_host_pytest_catalog(name: str) -> None:
    """Raise ``RuntimeError`` unless *name* is an allow-listed pytest-only catalog."""

    if not name:
        raise RuntimeError("Refusing host pytest: database URL has no catalog (path) component.")
    if name in _FORBIDDEN_PYTEST_CATALOGS:
        raise RuntimeError(
            f"Refusing host pytest against catalog {name!r}: reserved for the running API, "
            "validation lab, or PostgreSQL internals. Host pytest truncates public data and "
            "re-applies Alembic — never point it at that catalog. "
            f"Set TEST_DATABASE_URL to a dedicated pytest catalog, e.g. {DEFAULT_PYTEST_DATABASE_URL!r}. "
            f"Allowed catalogs: {sorted(ALLOWED_PYTEST_DATABASE_CATALOGS)}."
        )
    if name not in ALLOWED_PYTEST_DATABASE_CATALOGS:
        raise RuntimeError(
            "Refusing host pytest: database catalog must be one of "
            f"{sorted(ALLOWED_PYTEST_DATABASE_CATALOGS)} (got {name!r}). "
            "Destructive test fixtures are scoped only to explicitly named pytest catalogs."
        )
