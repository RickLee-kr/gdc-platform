"""Add delivery_logs outcome query index (stream/route/dest + stage + created_at).

Revision ID: 20260630_0059
Revises: 20260629_0058
Create Date: 2026-06-30
"""

from __future__ import annotations

from alembic import op

revision = "20260630_0059"
down_revision = "20260629_0058_display_tz"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_logs_stream_stage_status_created_at
        ON delivery_logs (stream_id, stage, status, created_at DESC)
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_logs_route_stage_status_created_at
        ON delivery_logs (route_id, stage, status, created_at DESC)
        WHERE route_id IS NOT NULL
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_logs_destination_stage_status_created_at
        ON delivery_logs (destination_id, stage, status, created_at DESC)
        WHERE destination_id IS NOT NULL
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_logs_destination_stage_status_created_at")
    op.execute("DROP INDEX IF EXISTS idx_logs_route_stage_status_created_at")
    op.execute("DROP INDEX IF EXISTS idx_logs_stream_stage_status_created_at")
