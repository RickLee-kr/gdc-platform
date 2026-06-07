"""M20.2 Governance notification configs and events tables."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20260606_0044_gov_notifications"
down_revision = "20260606_0043_gov_approval"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "governance_notification_configs",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("approval_events", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("violation_events", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("quarantine_events", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("replay_events", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("email_enabled", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("email_recipients_json", sa.dialects.postgresql.JSONB(), nullable=True),
        sa.Column("webhook_enabled", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("webhook_url", sa.String(length=2048), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )

    op.create_table(
        "governance_notification_events",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("event_type", sa.String(length=64), nullable=False),
        sa.Column("event_category", sa.String(length=32), nullable=False),
        sa.Column("severity", sa.String(length=16), nullable=False, server_default="INFO"),
        sa.Column("payload_json", sa.dialects.postgresql.JSONB(), nullable=True),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="PENDING"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_governance_notification_events_event_type",
        "governance_notification_events",
        ["event_type"],
    )
    op.create_index(
        "ix_governance_notification_events_event_category",
        "governance_notification_events",
        ["event_category"],
    )
    op.create_index(
        "ix_governance_notification_events_status",
        "governance_notification_events",
        ["status"],
    )
    op.create_index(
        "ix_governance_notification_events_created_at",
        "governance_notification_events",
        ["created_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_governance_notification_events_created_at", table_name="governance_notification_events")
    op.drop_index("ix_governance_notification_events_status", table_name="governance_notification_events")
    op.drop_index("ix_governance_notification_events_event_category", table_name="governance_notification_events")
    op.drop_index("ix_governance_notification_events_event_type", table_name="governance_notification_events")
    op.drop_table("governance_notification_events")
    op.drop_table("governance_notification_configs")
