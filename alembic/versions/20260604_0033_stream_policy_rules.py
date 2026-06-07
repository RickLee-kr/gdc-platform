"""M8 policy engine — stream_policy_rules table."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "20260604_0033_policy_rules"
down_revision = "20260604_0032_identity_vault"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "stream_policy_rules",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("stream_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=128), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("condition_json", JSONB(), nullable=False),
        sa.Column("action_type", sa.String(length=32), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["stream_id"], ["streams.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_stream_policy_rules_stream_enabled",
        "stream_policy_rules",
        ["stream_id", "enabled"],
    )


def downgrade() -> None:
    op.drop_index("ix_stream_policy_rules_stream_enabled", table_name="stream_policy_rules")
    op.drop_table("stream_policy_rules")
