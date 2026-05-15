"""validation alerts, recovery events, failing clock on continuous_validations."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

# Keep revision id <= 32 chars: PostgreSQL alembic_version.version_num is VARCHAR(32).
revision = "20260511_0008_val_alerts"
down_revision = "20260511_0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "continuous_validations",
        sa.Column("last_failing_started_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_table(
        "validation_alerts",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("validation_id", sa.Integer(), nullable=False),
        sa.Column("validation_run_id", sa.Integer(), nullable=True),
        sa.Column("severity", sa.String(length=16), nullable=False),
        sa.Column("alert_type", sa.String(length=48), nullable=False),
        sa.Column("status", sa.String(length=24), nullable=False),
        sa.Column("title", sa.String(length=512), nullable=False),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("fingerprint", sa.String(length=64), nullable=False),
        sa.Column("triggered_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("acknowledged_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["validation_id"], ["continuous_validations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["validation_run_id"], ["validation_runs.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_validation_alerts_validation_id", "validation_alerts", ["validation_id"])
    op.create_index("ix_validation_alerts_fingerprint_status", "validation_alerts", ["fingerprint", "status"])
    op.create_index("ix_validation_alerts_status_severity", "validation_alerts", ["status", "severity"])

    op.create_table(
        "validation_recovery_events",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("validation_id", sa.Integer(), nullable=False),
        sa.Column("validation_run_id", sa.Integer(), nullable=True),
        sa.Column("category", sa.String(length=32), nullable=False),
        sa.Column("title", sa.String(length=512), nullable=False),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["validation_id"], ["continuous_validations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["validation_run_id"], ["validation_runs.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_validation_recovery_events_validation_id", "validation_recovery_events", ["validation_id"])


def downgrade() -> None:
    op.drop_index("ix_validation_recovery_events_validation_id", table_name="validation_recovery_events")
    op.drop_table("validation_recovery_events")
    op.drop_index("ix_validation_alerts_status_severity", table_name="validation_alerts")
    op.drop_index("ix_validation_alerts_fingerprint_status", table_name="validation_alerts")
    op.drop_index("ix_validation_alerts_validation_id", table_name="validation_alerts")
    op.drop_table("validation_alerts")
    op.drop_column("continuous_validations", "last_failing_started_at")
