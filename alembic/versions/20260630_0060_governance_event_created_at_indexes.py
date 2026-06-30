"""Add created_at indexes for governance replay/quarantine event scans.

Revision ID: 20260630_0060
Revises: 20260630_0059
Create Date: 2026-06-30
"""

from __future__ import annotations

from alembic import op

revision = "20260630_0060"
down_revision = "20260630_0059"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_stream_replay_events_created_at
        ON stream_replay_events (created_at DESC)
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_stream_quarantine_events_created_at
        ON stream_quarantine_events (created_at DESC)
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_stream_quarantine_events_created_at")
    op.execute("DROP INDEX IF EXISTS idx_stream_replay_events_created_at")
