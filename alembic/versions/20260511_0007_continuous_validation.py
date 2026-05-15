"""Continuous validation definitions and run history (synthetic operational validation)."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20260511_0007"
down_revision = "20260511_0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "continuous_validations",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=256), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("validation_type", sa.String(length=32), nullable=False),
        sa.Column("target_stream_id", sa.Integer(), nullable=True),
        sa.Column("template_key", sa.String(length=64), nullable=True),
        sa.Column("schedule_seconds", sa.Integer(), nullable=False, server_default=sa.text("300")),
        sa.Column("expect_checkpoint_advance", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("last_run_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_status", sa.String(length=32), nullable=False, server_default="HEALTHY"),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("consecutive_failures", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("last_success_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["target_stream_id"], ["streams.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_continuous_validations_enabled_schedule",
        "continuous_validations",
        ["enabled", "schedule_seconds"],
        unique=False,
    )
    op.create_index(
        "ix_continuous_validations_target_stream_id",
        "continuous_validations",
        ["target_stream_id"],
        unique=False,
    )

    op.create_table(
        "validation_runs",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("validation_id", sa.Integer(), nullable=False),
        sa.Column("stream_id", sa.Integer(), nullable=True),
        sa.Column("run_id", sa.String(length=36), nullable=True),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("validation_stage", sa.String(length=64), nullable=False),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("latency_ms", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["stream_id"], ["streams.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["validation_id"], ["continuous_validations.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_validation_runs_validation_id_created_at",
        "validation_runs",
        ["validation_id", "created_at"],
        unique=False,
    )
    op.create_index(
        "ix_validation_runs_stream_id_created_at",
        "validation_runs",
        ["stream_id", "created_at"],
        unique=False,
    )
    op.create_index(
        "ix_validation_runs_run_id",
        "validation_runs",
        ["run_id"],
        unique=False,
        postgresql_where=sa.text("run_id IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("ix_validation_runs_run_id", table_name="validation_runs")
    op.drop_index("ix_validation_runs_stream_id_created_at", table_name="validation_runs")
    op.drop_index("ix_validation_runs_validation_id_created_at", table_name="validation_runs")
    op.drop_table("validation_runs")
    op.drop_index("ix_continuous_validations_target_stream_id", table_name="continuous_validations")
    op.drop_index("ix_continuous_validations_enabled_schedule", table_name="continuous_validations")
    op.drop_table("continuous_validations")
