"""ai_policy_violations table (M24)

Revision ID: 20260608_0049_ai_gov
Revises: 20260608_0048_ai_audit
Create Date: 2026-06-08
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20260608_0049_ai_gov"
down_revision = "20260608_0048_ai_audit"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "ai_policy_violations",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("request_id", sa.String(length=64), nullable=False),
        sa.Column("stream_id", sa.Integer(), nullable=True),
        sa.Column("ai_provider_id", sa.Integer(), nullable=True),
        sa.Column("ai_stream_id", sa.Integer(), nullable=True),
        sa.Column("policy_rule_id", sa.Integer(), nullable=True),
        sa.Column("provider", sa.String(length=64), nullable=True),
        sa.Column("ai_stream", sa.String(length=128), nullable=True),
        sa.Column("rule_id", sa.String(length=128), nullable=True),
        sa.Column("action", sa.String(length=32), nullable=False),
        sa.Column("severity", sa.String(length=16), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("operator_note", sa.Text(), nullable=True),
        sa.Column("acknowledged_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("acknowledged_by", sa.String(length=128), nullable=True),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("resolved_by", sa.String(length=128), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["ai_provider_id"], ["ai_providers.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["ai_stream_id"], ["ai_streams.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["policy_rule_id"], ["ai_policy_rules.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["stream_id"], ["streams.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_ai_policy_violations_request_id", "ai_policy_violations", ["request_id"])
    op.create_index("ix_ai_policy_violations_stream_id", "ai_policy_violations", ["stream_id"])
    op.create_index("ix_ai_policy_violations_ai_provider_id", "ai_policy_violations", ["ai_provider_id"])
    op.create_index("ix_ai_policy_violations_ai_stream_id", "ai_policy_violations", ["ai_stream_id"])
    op.create_index("ix_ai_policy_violations_policy_rule_id", "ai_policy_violations", ["policy_rule_id"])
    op.create_index("ix_ai_policy_violations_provider", "ai_policy_violations", ["provider"])
    op.create_index("ix_ai_policy_violations_action", "ai_policy_violations", ["action"])
    op.create_index("ix_ai_policy_violations_severity", "ai_policy_violations", ["severity"])
    op.create_index("ix_ai_policy_violations_status", "ai_policy_violations", ["status"])
    op.create_index("ix_ai_policy_violations_created_at", "ai_policy_violations", ["created_at"])


def downgrade() -> None:
    op.drop_index("ix_ai_policy_violations_created_at", table_name="ai_policy_violations")
    op.drop_index("ix_ai_policy_violations_status", table_name="ai_policy_violations")
    op.drop_index("ix_ai_policy_violations_severity", table_name="ai_policy_violations")
    op.drop_index("ix_ai_policy_violations_action", table_name="ai_policy_violations")
    op.drop_index("ix_ai_policy_violations_provider", table_name="ai_policy_violations")
    op.drop_index("ix_ai_policy_violations_policy_rule_id", table_name="ai_policy_violations")
    op.drop_index("ix_ai_policy_violations_ai_stream_id", table_name="ai_policy_violations")
    op.drop_index("ix_ai_policy_violations_ai_provider_id", table_name="ai_policy_violations")
    op.drop_index("ix_ai_policy_violations_stream_id", table_name="ai_policy_violations")
    op.drop_index("ix_ai_policy_violations_request_id", table_name="ai_policy_violations")
    op.drop_table("ai_policy_violations")
