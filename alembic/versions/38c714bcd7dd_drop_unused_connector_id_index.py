"""drop unused connector_id index

Revision ID: 38c714bcd7dd
Revises: 664c11bc5a4c
Create Date: 2026-05-05 17:29:52.877592
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa



revision = '38c714bcd7dd'
down_revision = '664c11bc5a4c'
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    indexes = {i["name"] for i in inspector.get_indexes("delivery_logs")}
    if "ix_delivery_logs_connector_id" in indexes:
        op.drop_index("ix_delivery_logs_connector_id", table_name="delivery_logs")


def downgrade() -> None:
    op.create_index(
        "ix_delivery_logs_connector_id",
        "delivery_logs",
        ["connector_id"],
    )
