"""drop redundant indexes

Revision ID: 664c11bc5a4c
Revises: 7bdbe1539bc7
Create Date: 2026-05-05 17:25:35.668621
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa



revision = '664c11bc5a4c'
down_revision = '7bdbe1539bc7'
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    def drop_if_exists(table: str, name: str) -> None:
        indexes = {i["name"] for i in inspector.get_indexes(table)}
        if name in indexes:
            op.drop_index(name, table_name=table)

    drop_if_exists("routes", "ix_routes_stream_id")
    drop_if_exists("routes", "ix_routes_destination_id")

    drop_if_exists("checkpoints", "ix_checkpoints_stream_id")

    drop_if_exists("delivery_logs", "ix_delivery_logs_stream_id")
    drop_if_exists("delivery_logs", "ix_delivery_logs_route_id")
    drop_if_exists("delivery_logs", "ix_delivery_logs_destination_id")


def downgrade() -> None:
    # drop-only migration: keep redundant indexes removed
    pass
