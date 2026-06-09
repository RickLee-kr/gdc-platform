"""ai_audit_events table (M23)

Revision ID: 20260608_0048_ai_audit
Revises: 20260608_0047_ai_policy
Create Date: 2026-06-08
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20260608_0048_ai_audit"
down_revision = "20260608_0047_ai_policy"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "ai_audit_events",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("stream_id", sa.Integer(), nullable=True),
        sa.Column("ai_provider_id", sa.Integer(), nullable=True),
        sa.Column("ai_stream_id", sa.Integer(), nullable=True),
        sa.Column("request_id", sa.String(length=64), nullable=False),
        sa.Column("event_type", sa.String(length=32), nullable=False),
        sa.Column("policy_rule_id", sa.Integer(), nullable=True),
        sa.Column("action", sa.String(length=32), nullable=False),
        sa.Column("matched_rule", sa.String(length=256), nullable=True),
        sa.Column("matched_pattern", sa.String(length=512), nullable=True),
        sa.Column("provider", sa.String(length=64), nullable=True),
        sa.Column("model", sa.String(length=128), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["ai_provider_id"], ["ai_providers.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["ai_stream_id"], ["ai_streams.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["policy_rule_id"], ["ai_policy_rules.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["stream_id"], ["streams.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_ai_audit_events_request_id", "ai_audit_events", ["request_id"])
    op.create_index("ix_ai_audit_events_stream_id", "ai_audit_events", ["stream_id"])
    op.create_index("ix_ai_audit_events_ai_provider_id", "ai_audit_events", ["ai_provider_id"])
    op.create_index("ix_ai_audit_events_event_type", "ai_audit_events", ["event_type"])
    op.create_index("ix_ai_audit_events_action", "ai_audit_events", ["action"])
    op.create_index("ix_ai_audit_events_created_at", "ai_audit_events", ["created_at"])


def downgrade() -> None:
    op.drop_index("ix_ai_audit_events_created_at", table_name="ai_audit_events")
    op.drop_index("ix_ai_audit_events_action", table_name="ai_audit_events")
    op.drop_index("ix_ai_audit_events_event_type", table_name="ai_audit_events")
    op.drop_index("ix_ai_audit_events_ai_provider_id", table_name="ai_audit_events")
    op.drop_index("ix_ai_audit_events_stream_id", table_name="ai_audit_events")
    op.drop_index("ix_ai_audit_events_request_id", table_name="ai_audit_events")
    op.drop_table("ai_audit_events")
