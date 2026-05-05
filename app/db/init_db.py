"""Run Alembic migrations programmatically."""

from __future__ import annotations

from pathlib import Path

from alembic import command
from alembic.config import Config


def run_migrations() -> None:
    """Apply Alembic migrations up to head."""

    root = Path(__file__).resolve().parents[2]
    cfg = Config(str(root / "alembic.ini"))
    cfg.set_main_option("script_location", str(root / "alembic"))
    command.upgrade(cfg, "head")


if __name__ == "__main__":
    run_migrations()
