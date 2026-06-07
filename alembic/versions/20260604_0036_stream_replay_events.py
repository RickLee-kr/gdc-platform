"""M11 replay engine — stream_replay_events table."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20260604_0036_replay_events"
down_revision = "20260604_0035_failover_routes"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "stream_replay_events",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("stream_id", sa.Integer(), nullable=False),
        sa.Column("destination_id", sa.Integer(), nullable=False),
        sa.Column("route_id", sa.Integer(), nullable=True),
        sa.Column("dynamic_route_id", sa.Integer(), nullable=True),
        sa.Column("failover_route_id", sa.Integer(), nullable=True),
        sa.Column(
            "delivery_kind",
            sa.String(length=32),
            nullable=False,
        ),
        sa.Column(
            "status",
            sa.String(length=16),
            nullable=False,
            server_default="pending",
        ),
        sa.Column("protected_payload_json", sa.JSON(), nullable=False),
        sa.Column("delivery_context_json", sa.JSON(), nullable=False),
        sa.Column("error_type", sa.String(length=128), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("retry_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("event_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("last_replay_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["stream_id"], ["streams.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["destination_id"], ["destinations.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["route_id"], ["routes.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_stream_replay_events_stream_status",
        "stream_replay_events",
        ["stream_id", "status"],
    )
    op.create_index(
        "ix_stream_replay_events_stream_created",
        "stream_replay_events",
        ["stream_id", "created_at"],
    )
    op.create_index(
        "ix_stream_replay_events_status",
        "stream_replay_events",
        ["status"],
    )


def downgrade() -> None:
    op.drop_index("ix_stream_replay_events_status", table_name="stream_replay_events")
    op.drop_index("ix_stream_replay_events_stream_created", table_name="stream_replay_events")
    op.drop_index("ix_stream_replay_events_stream_status", table_name="stream_replay_events")
    op.drop_table("stream_replay_events")
