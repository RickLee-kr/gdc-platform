"""OSS v1.0.1 Sprint 8 — stream_replay_events list query indexes (S4-13)."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20260609_0052_replay_idx"
down_revision = "20260608_0049_ai_gov"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Governance replay list: created_at window + ORDER BY created_at DESC, id DESC
    op.execute(
        sa.text(
            """
            CREATE INDEX IF NOT EXISTS idx_stream_replay_events_created_at_id
            ON stream_replay_events (created_at DESC, id DESC)
            """
        )
    )
    # Status-filtered replay queues: WHERE status = ? AND created_at range
    op.execute(
        sa.text(
            """
            CREATE INDEX IF NOT EXISTS idx_stream_replay_events_status_created_at_id
            ON stream_replay_events (status, created_at DESC, id DESC)
            """
        )
    )


def downgrade() -> None:
    op.drop_index("idx_stream_replay_events_status_created_at_id", table_name="stream_replay_events")
    op.drop_index("idx_stream_replay_events_created_at_id", table_name="stream_replay_events")
