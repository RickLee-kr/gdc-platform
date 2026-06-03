"""stream schema baseline columns + field drift findings (Milestone 2)."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "20260603_0028_schema_field_drift"
down_revision = "20260603_0027_stream_obs_schema"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "stream_observed_schemas",
        sa.Column(
            "baseline_paths_json",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
        ),
    )
    op.add_column(
        "stream_observed_schemas",
        sa.Column("baseline_established_at", sa.DateTime(timezone=True), nullable=True),
    )

    op.create_table(
        "stream_schema_field_drifts",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("stream_id", sa.Integer(), nullable=False),
        sa.Column("field_path", sa.Text(), nullable=False),
        sa.Column("category", sa.String(length=32), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="open"),
        sa.Column("first_detected_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("last_confirmed_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["stream_id"], ["streams.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "stream_id",
            "field_path",
            "category",
            name="uq_stream_schema_field_drifts_stream_path_category",
        ),
    )
    op.create_index(
        "ix_stream_schema_field_drifts_stream_status",
        "stream_schema_field_drifts",
        ["stream_id", "status"],
    )


def downgrade() -> None:
    op.drop_index("ix_stream_schema_field_drifts_stream_status", table_name="stream_schema_field_drifts")
    op.drop_table("stream_schema_field_drifts")
    op.drop_column("stream_observed_schemas", "baseline_established_at")
    op.drop_column("stream_observed_schemas", "baseline_paths_json")
