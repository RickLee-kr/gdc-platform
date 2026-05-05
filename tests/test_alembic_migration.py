from __future__ import annotations

import os
from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect

PG_URL = os.getenv("DATABASE_URL", "postgresql://gdc:gdc@localhost:5432/gdc")

def test_alembic_upgrade_head_creates_tables(monkeypatch) -> None:
    db_url = PG_URL
    monkeypatch.setenv("DATABASE_URL", db_url)

    root = Path(__file__).resolve().parents[1]
    cfg = Config(str(root / "alembic.ini"))
    cfg.set_main_option("script_location", str(root / "alembic"))
    cfg.set_main_option("sqlalchemy.url", db_url)

    command.upgrade(cfg, "head")

    engine = create_engine(db_url)
    inspector = inspect(engine)
    tables = set(inspector.get_table_names())
    assert "connectors" in tables
    assert "sources" in tables
    assert "streams" in tables
    assert "routes" in tables
    assert "checkpoints" in tables
