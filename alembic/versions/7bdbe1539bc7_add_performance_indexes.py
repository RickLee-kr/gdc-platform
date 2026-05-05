"""add performance indexes

Revision ID: 7bdbe1539bc7
Revises: 20260505_0001
Create Date: 2026-05-05 17:08:17.088584
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa



revision = '7bdbe1539bc7'
down_revision = '20260505_0001'
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()

    def existing_index_names(table_name: str) -> set[str]:
        inspector = sa.inspect(bind)
        return {idx["name"] for idx in inspector.get_indexes(table_name)}

    def create_index_if_missing(
        index_name: str,
        table_name: str,
        columns: list[sa.ColumnElement[str] | str],
        *,
        unique: bool = False,
    ) -> None:
        if index_name not in existing_index_names(table_name):
            op.create_index(index_name, table_name, columns, unique=unique)

    def existing_unique_constraint_names(table_name: str) -> set[str]:
        inspector = sa.inspect(bind)
        constraints = inspector.get_unique_constraints(table_name)
        return {c["name"] for c in constraints if c.get("name")}

    def create_unique_constraint_if_missing(
        constraint_name: str,
        table_name: str,
        columns: list[str],
    ) -> None:
        if constraint_name not in existing_unique_constraint_names(table_name):
            op.create_unique_constraint(constraint_name, table_name, columns)

    # mappings / enrichments
    create_index_if_missing("idx_mappings_stream_id", "mappings", ["stream_id"], unique=False)
    create_index_if_missing("idx_enrichments_stream_id", "enrichments", ["stream_id"], unique=False)

    # routes fan-out and destination lookup
    create_unique_constraint_if_missing(
        "uq_routes_stream_destination",
        "routes",
        ["stream_id", "destination_id"],
    )

    # checkpoints hot-path lookup
    create_unique_constraint_if_missing(
        "uq_checkpoints_stream_id",
        "checkpoints",
        ["stream_id"],
    )

    # delivery log recent-history lookups
    create_index_if_missing(
        "idx_logs_stream_id_created_at",
        "delivery_logs",
        ["stream_id", "created_at"],
        unique=False,
    )
    create_index_if_missing(
        "idx_logs_route_id_created_at",
        "delivery_logs",
        ["route_id", "created_at"],
        unique=False,
    )
    create_index_if_missing(
        "idx_logs_destination_id_created_at",
        "delivery_logs",
        ["destination_id", "created_at"],
        unique=False,
    )


def downgrade() -> None:
    bind = op.get_bind()

    def existing_index_names(table_name: str) -> set[str]:
        inspector = sa.inspect(bind)
        return {idx["name"] for idx in inspector.get_indexes(table_name)}

    def drop_index_if_exists(index_name: str, table_name: str) -> None:
        if index_name in existing_index_names(table_name):
            op.drop_index(index_name, table_name=table_name)

    drop_index_if_exists("idx_logs_destination_id_created_at", "delivery_logs")
    drop_index_if_exists("idx_logs_route_id_created_at", "delivery_logs")
    drop_index_if_exists("idx_logs_stream_id_created_at", "delivery_logs")

    op.drop_constraint("uq_checkpoints_stream_id", "checkpoints", type_="unique")
    op.drop_constraint("uq_routes_stream_destination", "routes", type_="unique")

    drop_index_if_exists("idx_enrichments_stream_id", "enrichments")
    drop_index_if_exists("idx_mappings_stream_id", "mappings")
