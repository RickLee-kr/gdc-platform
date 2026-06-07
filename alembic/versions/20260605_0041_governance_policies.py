"""M18.1 Policy Builder — governance_policies and stream_policy_assignments."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "20260605_0041_gov_policies"
down_revision = "20260605_0040_m16_2_idx"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "governance_policies",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("name", sa.String(length=128), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("category", sa.String(length=32), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="DRAFT"),
        sa.Column("policy_json", JSONB(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_governance_policies_status", "governance_policies", ["status"])
    op.create_index("ix_governance_policies_category", "governance_policies", ["category"])

    op.create_table(
        "stream_policy_assignments",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("stream_id", sa.Integer(), nullable=False),
        sa.Column("policy_id", sa.Integer(), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.ForeignKeyConstraint(["policy_id"], ["governance_policies.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["stream_id"], ["streams.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("stream_id", "policy_id", name="uq_stream_policy_assignments_stream_policy"),
    )
    op.create_index("ix_stream_policy_assignments_stream_id", "stream_policy_assignments", ["stream_id"])
    op.create_index("ix_stream_policy_assignments_policy_id", "stream_policy_assignments", ["policy_id"])


def downgrade() -> None:
    op.drop_index("ix_stream_policy_assignments_policy_id", table_name="stream_policy_assignments")
    op.drop_index("ix_stream_policy_assignments_stream_id", table_name="stream_policy_assignments")
    op.drop_table("stream_policy_assignments")
    op.drop_index("ix_governance_policies_category", table_name="governance_policies")
    op.drop_index("ix_governance_policies_status", table_name="governance_policies")
    op.drop_table("governance_policies")
