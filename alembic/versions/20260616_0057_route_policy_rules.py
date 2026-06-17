"""M13.5 — route_policy_rules + nullable route_id on stream_quarantine_events."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "20260616_0057_route_policy"
down_revision = "20260616_0056_route_class"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "route_policy_rules",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("route_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=128), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("condition_json", JSONB(), nullable=False),
        sa.Column("action_type", sa.String(length=32), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["route_id"], ["routes.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_route_policy_rules_route_enabled",
        "route_policy_rules",
        ["route_id", "enabled"],
    )
    op.create_index(op.f("ix_route_policy_rules_route_id"), "route_policy_rules", ["route_id"])

    op.add_column(
        "stream_quarantine_events",
        sa.Column("route_id", sa.Integer(), nullable=True),
    )
    op.create_foreign_key(
        "fk_stream_quarantine_events_route_id",
        "stream_quarantine_events",
        "routes",
        ["route_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index(
        op.f("ix_stream_quarantine_events_route_id"),
        "stream_quarantine_events",
        ["route_id"],
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_stream_quarantine_events_route_id"), table_name="stream_quarantine_events")
    op.drop_constraint("fk_stream_quarantine_events_route_id", "stream_quarantine_events", type_="foreignkey")
    op.drop_column("stream_quarantine_events", "route_id")

    op.drop_index(op.f("ix_route_policy_rules_route_id"), table_name="route_policy_rules")
    op.drop_index("ix_route_policy_rules_route_enabled", table_name="route_policy_rules")
    op.drop_table("route_policy_rules")
