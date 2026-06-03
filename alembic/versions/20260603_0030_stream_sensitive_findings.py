"""M5 sensitive detection — stream_sensitive_findings table."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "20260603_0030_sensitive_findings"
down_revision = "20260603_0029_schema_drift_m4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "stream_sensitive_findings",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("stream_id", sa.Integer(), nullable=False),
        sa.Column("field_path", sa.Text(), nullable=False),
        sa.Column("sensitivity_class", sa.String(length=32), nullable=False),
        sa.Column("detection_method", sa.String(length=16), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="open"),
        sa.Column("confirm_run_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("first_detected_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("last_confirmed_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("finding_json", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("related_drift_finding_id", sa.Integer(), nullable=True),
        sa.Column("acknowledged_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("acknowledged_by", sa.String(length=128), nullable=True),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("resolved_by", sa.String(length=128), nullable=True),
        sa.Column("operator_note", sa.Text(), nullable=True),
        sa.Column("resolution", sa.String(length=32), nullable=True),
        sa.ForeignKeyConstraint(["stream_id"], ["streams.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["related_drift_finding_id"],
            ["stream_schema_field_drifts.id"],
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "stream_id",
            "field_path",
            "sensitivity_class",
            name="uq_stream_sensitive_findings_stream_path_class",
        ),
    )
    op.create_index(
        "ix_stream_sensitive_findings_stream_status",
        "stream_sensitive_findings",
        ["stream_id", "status"],
    )
    op.create_index(
        "ix_stream_sensitive_findings_stream_class_status",
        "stream_sensitive_findings",
        ["stream_id", "sensitivity_class", "status"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_stream_sensitive_findings_stream_class_status",
        table_name="stream_sensitive_findings",
    )
    op.drop_index(
        "ix_stream_sensitive_findings_stream_status",
        table_name="stream_sensitive_findings",
    )
    op.drop_table("stream_sensitive_findings")
