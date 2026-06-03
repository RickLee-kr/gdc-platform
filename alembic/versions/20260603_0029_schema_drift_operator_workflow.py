"""Schema drift M4 — operator workflow columns (acknowledge, baseline reset)."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20260603_0029_schema_drift_m4"
down_revision = "20260603_0028_schema_field_drift"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "stream_observed_schemas",
        sa.Column("baseline_version", sa.Integer(), nullable=False, server_default="1"),
    )
    op.add_column(
        "stream_observed_schemas",
        sa.Column("baseline_reset_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "stream_observed_schemas",
        sa.Column("baseline_reset_by", sa.String(length=128), nullable=True),
    )
    op.add_column(
        "stream_observed_schemas",
        sa.Column("baseline_reset_reason", sa.Text(), nullable=True),
    )

    op.add_column(
        "stream_schema_field_drifts",
        sa.Column("acknowledged_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "stream_schema_field_drifts",
        sa.Column("acknowledged_by", sa.String(length=128), nullable=True),
    )
    op.add_column(
        "stream_schema_field_drifts",
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "stream_schema_field_drifts",
        sa.Column("resolved_by", sa.String(length=128), nullable=True),
    )
    op.add_column(
        "stream_schema_field_drifts",
        sa.Column("operator_note", sa.Text(), nullable=True),
    )
    op.add_column(
        "stream_schema_field_drifts",
        sa.Column("resolution", sa.String(length=32), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("stream_schema_field_drifts", "resolution")
    op.drop_column("stream_schema_field_drifts", "operator_note")
    op.drop_column("stream_schema_field_drifts", "resolved_by")
    op.drop_column("stream_schema_field_drifts", "resolved_at")
    op.drop_column("stream_schema_field_drifts", "acknowledged_by")
    op.drop_column("stream_schema_field_drifts", "acknowledged_at")
    op.drop_column("stream_observed_schemas", "baseline_reset_reason")
    op.drop_column("stream_observed_schemas", "baseline_reset_by")
    op.drop_column("stream_observed_schemas", "baseline_reset_at")
    op.drop_column("stream_observed_schemas", "baseline_version")
