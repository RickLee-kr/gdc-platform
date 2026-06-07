"""M19.5 Governance policy approval events table."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20260606_0043_gov_approval"
down_revision = "20260606_0042_gov_lifecycle"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "governance_policy_approval_events",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("policy_id", sa.Integer(), nullable=False),
        sa.Column("event_type", sa.String(length=32), nullable=False),
        sa.Column("actor", sa.String(length=128), nullable=False),
        sa.Column("comment", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["policy_id"], ["governance_policies.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_governance_policy_approval_events_policy_id",
        "governance_policy_approval_events",
        ["policy_id"],
    )
    op.create_index(
        "ix_governance_policy_approval_events_event_type",
        "governance_policy_approval_events",
        ["event_type"],
    )
    op.create_index(
        "ix_governance_policy_approval_events_created_at",
        "governance_policy_approval_events",
        ["created_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_governance_policy_approval_events_created_at", table_name="governance_policy_approval_events")
    op.drop_index("ix_governance_policy_approval_events_event_type", table_name="governance_policy_approval_events")
    op.drop_index("ix_governance_policy_approval_events_policy_id", table_name="governance_policy_approval_events")
    op.drop_table("governance_policy_approval_events")
