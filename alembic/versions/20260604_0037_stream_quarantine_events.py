"""M12 quarantine MVP — stream_quarantine_events table."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20260604_0037_quarantine_events"
down_revision = "20260604_0036_replay_events"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "stream_quarantine_events",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("stream_id", sa.Integer(), nullable=False),
        sa.Column("quarantine_reason", sa.String(length=256), nullable=False),
        sa.Column("quarantine_source", sa.String(length=32), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="quarantined"),
        sa.Column("protected_payload_json", sa.JSON(), nullable=False),
        sa.Column("metadata_json", sa.JSON(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("released_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("released_by", sa.String(length=128), nullable=True),
        sa.ForeignKeyConstraint(["stream_id"], ["streams.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_stream_quarantine_events_stream_status",
        "stream_quarantine_events",
        ["stream_id", "status"],
    )
    op.create_index(
        "ix_stream_quarantine_events_created_at",
        "stream_quarantine_events",
        ["created_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_stream_quarantine_events_created_at", table_name="stream_quarantine_events")
    op.drop_index("ix_stream_quarantine_events_stream_status", table_name="stream_quarantine_events")
    op.drop_table("stream_quarantine_events")
