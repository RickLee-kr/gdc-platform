from __future__ import annotations

from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import inspect
from sqlalchemy.engine import Engine

def test_alembic_upgrade_head_creates_tables(
    reset_db_schema: None, test_db_url: str, db_engine: Engine
) -> None:
    root = Path(__file__).resolve().parents[1]
    cfg = Config(str(root / "alembic.ini"))
    cfg.set_main_option("script_location", str(root / "alembic"))
    cfg.set_main_option("sqlalchemy.url", test_db_url)

    command.upgrade(cfg, "head")

    inspector = inspect(db_engine)
    tables = set(inspector.get_table_names())
    assert "connectors" in tables
    assert "sources" in tables
    assert "streams" in tables
    assert "routes" in tables
    assert "destinations" in tables
    assert "checkpoints" in tables
    assert "mappings" in tables
    assert "enrichments" in tables
    assert "delivery_logs" in tables
    assert "platform_users" in tables
    assert "platform_https_config" in tables
    assert "platform_alert_history" in tables

    retention_columns = {c["name"] for c in inspector.get_columns("platform_retention_policy")}
    assert "cleanup_scheduler_enabled" in retention_columns
    assert "cleanup_interval_minutes" in retention_columns
    assert "cleanup_batch_size" in retention_columns
    assert "logs_last_deleted_count" in retention_columns

    alert_columns = {c["name"] for c in inspector.get_columns("platform_alert_settings")}
    assert "cooldown_seconds" in alert_columns
    assert "monitor_enabled" in alert_columns
