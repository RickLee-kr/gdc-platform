"""Add nullable run_id to delivery_logs for stream execution correlation."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20260511_0006"
down_revision = "20260510_0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "delivery_logs",
        sa.Column("run_id", sa.String(length=36), nullable=True),
    )
    op.create_index(
        "ix_delivery_logs_run_id_created_at",
        "delivery_logs",
        ["run_id", "created_at"],
        unique=False,
        postgresql_where=sa.text("run_id IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("ix_delivery_logs_run_id_created_at", table_name="delivery_logs")
    op.drop_column("delivery_logs", "run_id")
