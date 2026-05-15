"""add routes stream enabled index

Revision ID: a9aee9120c1f
Revises: 38c714bcd7dd
Create Date: 2026-05-05 17:37:29.498250
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa



revision = 'a9aee9120c1f'
down_revision = '38c714bcd7dd'
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    indexes = {idx["name"] for idx in inspector.get_indexes("routes")}
    if "idx_routes_stream_enabled" not in indexes:
        op.create_index(
            "idx_routes_stream_enabled",
            "routes",
            ["stream_id", "enabled"],
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    indexes = {idx["name"] for idx in inspector.get_indexes("routes")}
    if "idx_routes_stream_enabled" in indexes:
        op.drop_index(
            "idx_routes_stream_enabled",
            table_name="routes",
        )
