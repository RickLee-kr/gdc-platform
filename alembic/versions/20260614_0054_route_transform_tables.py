"""M13.2 — route_mappings and route_enrichments (per-route transform)."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20260614_0054_route_transform"
down_revision = "20260609_0053_product_group"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "route_mappings",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("route_id", sa.Integer(), nullable=False),
        sa.Column("field_mappings_json", sa.JSON(), nullable=False),
        sa.Column("raw_payload_mode", sa.String(length=64), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["route_id"], ["routes.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("route_id"),
    )
    op.create_index(op.f("ix_route_mappings_id"), "route_mappings", ["id"], unique=False)
    op.create_index(op.f("ix_route_mappings_route_id"), "route_mappings", ["route_id"], unique=True)

    op.create_table(
        "route_enrichments",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("route_id", sa.Integer(), nullable=False),
        sa.Column("enrichment_json", sa.JSON(), nullable=False),
        sa.Column("override_policy", sa.String(length=64), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["route_id"], ["routes.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("route_id"),
    )
    op.create_index(op.f("ix_route_enrichments_id"), "route_enrichments", ["id"], unique=False)
    op.create_index(op.f("ix_route_enrichments_route_id"), "route_enrichments", ["route_id"], unique=True)


def downgrade() -> None:
    op.drop_index(op.f("ix_route_enrichments_route_id"), table_name="route_enrichments")
    op.drop_index(op.f("ix_route_enrichments_id"), table_name="route_enrichments")
    op.drop_table("route_enrichments")
    op.drop_index(op.f("ix_route_mappings_route_id"), table_name="route_mappings")
    op.drop_index(op.f("ix_route_mappings_id"), table_name="route_mappings")
    op.drop_table("route_mappings")
