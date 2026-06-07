"""M9 dynamic routing — stream_dynamic_routes table."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "20260604_0034_dynamic_routes"
down_revision = "20260604_0033_policy_rules"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "stream_dynamic_routes",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("stream_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=128), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("condition_json", JSONB(), nullable=False),
        sa.Column("destination_id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["stream_id"], ["streams.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["destination_id"], ["destinations.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_stream_dynamic_routes_stream_enabled",
        "stream_dynamic_routes",
        ["stream_id", "enabled"],
    )


def downgrade() -> None:
    op.drop_index("ix_stream_dynamic_routes_stream_enabled", table_name="stream_dynamic_routes")
    op.drop_table("stream_dynamic_routes")
