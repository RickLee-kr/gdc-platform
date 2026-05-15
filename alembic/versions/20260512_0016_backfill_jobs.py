"""backfill_jobs — isolated data backfill runtime job registry (Phase 1)."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20260512_0016_backfill"
down_revision = "20260512_0015_val_perf"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "backfill_jobs",
        sa.Column("id", sa.Integer(), nullable=False, primary_key=True, autoincrement=True),
        sa.Column("stream_id", sa.Integer(), nullable=False),
        sa.Column("source_type", sa.String(length=64), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False, server_default="PENDING"),
        sa.Column("backfill_mode", sa.String(length=64), nullable=False),
        sa.Column("requested_by", sa.String(length=256), nullable=False, server_default="unknown"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("failed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("source_config_snapshot_json", sa.JSON(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("checkpoint_snapshot_json", sa.JSON(), nullable=True),
        sa.Column("runtime_options_json", sa.JSON(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("progress_json", sa.JSON(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("error_summary", sa.Text(), nullable=True),
        sa.Column("delivery_summary_json", sa.JSON(), nullable=True),
        sa.ForeignKeyConstraint(["stream_id"], ["streams.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_backfill_jobs_stream_id", "backfill_jobs", ["stream_id"], unique=False)
    op.create_index("ix_backfill_jobs_status", "backfill_jobs", ["status"], unique=False)
    op.create_index("ix_backfill_jobs_created_at", "backfill_jobs", ["created_at"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_backfill_jobs_created_at", table_name="backfill_jobs")
    op.drop_index("ix_backfill_jobs_status", table_name="backfill_jobs")
    op.drop_index("ix_backfill_jobs_stream_id", table_name="backfill_jobs")
    op.drop_table("backfill_jobs")
