from __future__ import annotations

import os
from logging.config import fileConfig

from alembic import context
from sqlalchemy import engine_from_config, pool

from app.config import settings
from app.database import Base

# Ensure model metadata is registered.
import app.checkpoints.models  # noqa: F401
import app.connectors.models  # noqa: F401
import app.destinations.models  # noqa: F401
import app.enrichments.models  # noqa: F401
import app.logs.models  # noqa: F401
import app.mappings.models  # noqa: F401
import app.routes.models  # noqa: F401
import app.sources.models  # noqa: F401
import app.streams.models  # noqa: F401
import app.runtime.models  # noqa: F401
import app.platform_admin.models  # noqa: F401
import app.backfill.models  # noqa: F401

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata

# Same URL resolution as the runtime app (pydantic: .env into ``settings``), but prefer a
# live ``DATABASE_URL`` environment override. Host pytest updates ``os.environ`` after
# ``settings`` was constructed; without this, ``command.upgrade`` would migrate the wrong catalog.
effective_db_url = os.environ.get("DATABASE_URL", "").strip() or settings.DATABASE_URL
config.set_main_option("sqlalchemy.url", effective_db_url)


def run_migrations_offline() -> None:
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        compare_type=True,
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata, compare_type=True)

        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
