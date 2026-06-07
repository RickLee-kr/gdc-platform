"""M14 AI Gateway MVP — ai_gateway_policies and ai_gateway_requests."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "20260605_0039_ai_gateway"
down_revision = "20260604_0038_class_rules"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "ai_gateway_policies",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("name", sa.String(length=128), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("condition_json", JSONB(), nullable=False),
        sa.Column("action_type", sa.String(length=32), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_ai_gateway_policies_enabled",
        "ai_gateway_policies",
        ["enabled"],
    )

    op.create_table(
        "ai_gateway_requests",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("request_id", sa.String(length=36), nullable=False),
        sa.Column("stream_id", sa.Integer(), nullable=True),
        sa.Column("classification_level", sa.String(length=32), nullable=False),
        sa.Column("decision", sa.String(length=16), nullable=False),
        sa.Column("provider", sa.String(length=64), nullable=False),
        sa.Column("processing_time_ms", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("matched_policy_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["stream_id"], ["streams.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_ai_gateway_requests_request_id", "ai_gateway_requests", ["request_id"], unique=True)
    op.create_index("ix_ai_gateway_requests_created_at", "ai_gateway_requests", ["created_at"])
    op.create_index("ix_ai_gateway_requests_decision", "ai_gateway_requests", ["decision"])


def downgrade() -> None:
    op.drop_index("ix_ai_gateway_requests_decision", table_name="ai_gateway_requests")
    op.drop_index("ix_ai_gateway_requests_created_at", table_name="ai_gateway_requests")
    op.drop_index("ix_ai_gateway_requests_request_id", table_name="ai_gateway_requests")
    op.drop_table("ai_gateway_requests")
    op.drop_index("ix_ai_gateway_policies_enabled", table_name="ai_gateway_policies")
    op.drop_table("ai_gateway_policies")
