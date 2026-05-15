"""backfill_progress_events — append-only progress log for backfill jobs (Phase 2)."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20260512_0017_backfill_progress"
down_revision = "20260512_0016_backfill"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "backfill_progress_events",
        sa.Column("id", sa.Integer(), nullable=False, primary_key=True, autoincrement=True),
        sa.Column("backfill_job_id", sa.Integer(), nullable=False),
        sa.Column("stream_id", sa.Integer(), nullable=False),
        sa.Column("event_type", sa.String(length=64), nullable=False),
        sa.Column("level", sa.String(length=16), nullable=False),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("progress_json", sa.JSON(), nullable=True),
        sa.Column("error_code", sa.String(length=64), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["backfill_job_id"], ["backfill_jobs.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["stream_id"], ["streams.id"], ondelete="CASCADE"),
    )
    op.create_index(
        "ix_backfill_progress_events_job_created",
        "backfill_progress_events",
        ["backfill_job_id", "created_at"],
        unique=False,
    )
    op.create_index(
        "ix_backfill_jobs_stream_status_active",
        "backfill_jobs",
        ["stream_id", "status"],
        unique=False,
        postgresql_where=sa.text("status IN ('RUNNING', 'CANCELLING')"),
    )


def downgrade() -> None:
    op.drop_index("ix_backfill_jobs_stream_status_active", table_name="backfill_jobs")
    op.drop_index("ix_backfill_progress_events_job_created", table_name="backfill_progress_events")
    op.drop_table("backfill_progress_events")
