"""DATABASE_QUERY connector config_json build (secret merge from stored password key)."""

from __future__ import annotations

from app.connectors.router import _MASK, _build_database_query_config_json
from app.connectors.schemas import ConnectorUpdate


def test_database_query_partial_update_preserves_password_when_omitted() -> None:
    existing = {
        "connector_type": "relational_database",
        "db_type": "POSTGRESQL",
        "host": "db.example",
        "port": 5432,
        "database": "app",
        "username": "reader",
        "password": "stored-secret",
        "ssl_mode": "PREFER",
        "connection_timeout_seconds": 20,
    }
    payload = ConnectorUpdate(name="renamed")
    out = _build_database_query_config_json(payload, existing=existing, partial=True)
    assert out["password"] == "stored-secret"
    assert out["host"] == "db.example"
    assert out["database"] == "app"


def test_database_query_mask_password_reuses_stored() -> None:
    existing = {
        "connector_type": "relational_database",
        "db_type": "MYSQL",
        "host": "127.0.0.1",
        "port": 3306,
        "database": "logs",
        "username": "u",
        "password": "real",
        "ssl_mode": "DISABLE",
        "connection_timeout_seconds": 15,
    }
    payload = ConnectorUpdate(db_password=_MASK)
    out = _build_database_query_config_json(payload, existing=existing, partial=True)
    assert out["password"] == "real"
