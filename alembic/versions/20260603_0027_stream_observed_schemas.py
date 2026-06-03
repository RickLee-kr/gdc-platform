"""stream_observed_schemas — per-Stream runtime schema observation (Milestone 1)."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "20260603_0027_stream_obs_schema"
down_revision = "20260523_0026_template_drafts"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "stream_observed_schemas",
        sa.Column("stream_id", sa.Integer(), nullable=False),
        sa.Column(
            "paths_json",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{\"paths\": {}}'::jsonb"),
        ),
        sa.Column("total_events_observed", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("observation_run_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("last_observation_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["stream_id"], ["streams.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("stream_id"),
    )


def downgrade() -> None:
    op.drop_table("stream_observed_schemas")
