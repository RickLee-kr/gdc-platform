"""M13.3 — route_protection_rules (per-route protection)."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20260615_0055_route_protection"
down_revision = "20260614_0054_route_transform"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "route_protection_rules",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("route_id", sa.Integer(), nullable=False),
        sa.Column("field_path", sa.Text(), nullable=False),
        sa.Column("sensitivity_class", sa.String(length=32), nullable=False),
        sa.Column("protection_mode", sa.String(length=16), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("source_finding_id", sa.Integer(), nullable=True),
        sa.Column("created_by", sa.String(length=128), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["route_id"], ["routes.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["source_finding_id"],
            ["stream_sensitive_findings.id"],
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("route_id", "field_path", name="uq_route_protection_rules_route_path"),
    )
    op.create_index(op.f("ix_route_protection_rules_id"), "route_protection_rules", ["id"], unique=False)
    op.create_index(op.f("ix_route_protection_rules_route_id"), "route_protection_rules", ["route_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_route_protection_rules_route_id"), table_name="route_protection_rules")
    op.drop_index(op.f("ix_route_protection_rules_id"), table_name="route_protection_rules")
    op.drop_table("route_protection_rules")
