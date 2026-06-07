"""M16.2 summary query indexes — delivery_logs stage lookup and AI gateway 24h aggregates.

Revision ID: 20260605_0040_m16_2_idx
Revises: 20260605_0039_ai_gateway
Create Date: 2026-06-05
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20260605_0040_m16_2_idx"
down_revision = "20260605_0039_ai_gateway"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        sa.text(
            """
            CREATE INDEX IF NOT EXISTS idx_logs_stream_stage_created_at
            ON delivery_logs (stream_id, stage, created_at DESC)
            """
        )
    )
    op.execute(
        sa.text(
            """
            CREATE INDEX IF NOT EXISTS idx_ai_gateway_requests_created_at_decision
            ON ai_gateway_requests (created_at, decision)
            """
        )
    )


def downgrade() -> None:
    op.drop_index("idx_ai_gateway_requests_created_at_decision", table_name="ai_gateway_requests")
    op.drop_index("idx_logs_stream_stage_created_at", table_name="delivery_logs")
