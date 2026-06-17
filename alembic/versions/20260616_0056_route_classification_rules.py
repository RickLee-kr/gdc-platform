"""M13.4 — route_classification_rules (per-route classification)."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "20260616_0056_route_class"
down_revision = "20260615_0055_route_protection"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "route_classification_rules",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("route_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=128), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("condition_json", JSONB(), nullable=False),
        sa.Column("classification_level", sa.String(length=32), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["route_id"], ["routes.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_route_classification_rules_route_enabled",
        "route_classification_rules",
        ["route_id", "enabled"],
    )
    op.create_index(op.f("ix_route_classification_rules_route_id"), "route_classification_rules", ["route_id"])


def downgrade() -> None:
    op.drop_index(op.f("ix_route_classification_rules_route_id"), table_name="route_classification_rules")
    op.drop_index("ix_route_classification_rules_route_enabled", table_name="route_classification_rules")
    op.drop_table("route_classification_rules")
