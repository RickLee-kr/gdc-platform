"""M22 AI Policy Enforcement — ai_policy_rules."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20260608_0047_ai_policy"
down_revision = "20260608_0046_ai_streams"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "ai_policy_rules",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("ai_stream_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=128), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("target", sa.String(length=16), nullable=False),
        sa.Column("inspection_type", sa.String(length=32), nullable=False),
        sa.Column("condition_json", sa.JSON(), nullable=False, server_default=sa.text("'{}'::json")),
        sa.Column("action_type", sa.String(length=16), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["ai_stream_id"], ["ai_streams.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("ai_stream_id", "name", name="uq_ai_policy_rules_stream_name"),
    )
    op.create_index("ix_ai_policy_rules_ai_stream_id", "ai_policy_rules", ["ai_stream_id"])
    op.create_index("ix_ai_policy_rules_target", "ai_policy_rules", ["target"])
    op.create_index("ix_ai_policy_rules_enabled", "ai_policy_rules", ["enabled"])


def downgrade() -> None:
    op.drop_index("ix_ai_policy_rules_enabled", table_name="ai_policy_rules")
    op.drop_index("ix_ai_policy_rules_target", table_name="ai_policy_rules")
    op.drop_index("ix_ai_policy_rules_ai_stream_id", table_name="ai_policy_rules")
    op.drop_table("ai_policy_rules")
