"""M10 failover routing — stream_failover_routes table."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20260604_0035_failover_routes"
down_revision = "20260604_0034_dynamic_routes"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "stream_failover_routes",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("stream_id", sa.Integer(), nullable=False),
        sa.Column("primary_destination_id", sa.Integer(), nullable=False),
        sa.Column("secondary_destination_id", sa.Integer(), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["stream_id"], ["streams.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["primary_destination_id"], ["destinations.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["secondary_destination_id"], ["destinations.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "stream_id",
            "primary_destination_id",
            name="uq_stream_failover_routes_stream_primary",
        ),
    )
    op.create_index(
        "ix_stream_failover_routes_stream_enabled",
        "stream_failover_routes",
        ["stream_id", "enabled"],
    )


def downgrade() -> None:
    op.drop_index("ix_stream_failover_routes_stream_enabled", table_name="stream_failover_routes")
    op.drop_table("stream_failover_routes")
