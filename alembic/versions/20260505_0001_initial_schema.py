"""initial schema

Revision ID: 20260505_0001
Revises:
Create Date: 2026-05-05
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260505_0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "connectors",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("status", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_connectors_id"), "connectors", ["id"], unique=False)

    op.create_table(
        "destinations",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("destination_type", sa.String(length=64), nullable=False),
        sa.Column("config_json", sa.JSON(), nullable=False),
        sa.Column("rate_limit_json", sa.JSON(), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_destinations_id"), "destinations", ["id"], unique=False)

    op.create_table(
        "sources",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("connector_id", sa.Integer(), nullable=False),
        sa.Column("source_type", sa.String(length=64), nullable=False),
        sa.Column("config_json", sa.JSON(), nullable=False),
        sa.Column("auth_json", sa.JSON(), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["connector_id"], ["connectors.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_sources_connector_id"), "sources", ["connector_id"], unique=False)
    op.create_index(op.f("ix_sources_id"), "sources", ["id"], unique=False)

    op.create_table(
        "streams",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("connector_id", sa.Integer(), nullable=False),
        sa.Column("source_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("stream_type", sa.String(length=64), nullable=False),
        sa.Column("config_json", sa.JSON(), nullable=False),
        sa.Column("polling_interval", sa.Integer(), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("status", sa.String(length=64), nullable=False),
        sa.Column("rate_limit_json", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["connector_id"], ["connectors.id"]),
        sa.ForeignKeyConstraint(["source_id"], ["sources.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_streams_connector_id"), "streams", ["connector_id"], unique=False)
    op.create_index(op.f("ix_streams_id"), "streams", ["id"], unique=False)
    op.create_index(op.f("ix_streams_source_id"), "streams", ["source_id"], unique=False)

    op.create_table(
        "checkpoints",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("stream_id", sa.Integer(), nullable=False),
        sa.Column("checkpoint_type", sa.String(length=64), nullable=False),
        sa.Column("checkpoint_value_json", sa.JSON(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["stream_id"], ["streams.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("stream_id", name="uq_checkpoints_stream_id"),
    )
    op.create_index(op.f("ix_checkpoints_id"), "checkpoints", ["id"], unique=False)

    op.create_table(
        "enrichments",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("stream_id", sa.Integer(), nullable=False),
        sa.Column("enrichment_json", sa.JSON(), nullable=False),
        sa.Column("override_policy", sa.String(length=64), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["stream_id"], ["streams.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("stream_id"),
    )
    op.create_index(op.f("ix_enrichments_id"), "enrichments", ["id"], unique=False)
    op.create_index(op.f("ix_enrichments_stream_id"), "enrichments", ["stream_id"], unique=True)

    op.create_table(
        "mappings",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("stream_id", sa.Integer(), nullable=False),
        sa.Column("event_array_path", sa.String(length=255), nullable=True),
        sa.Column("field_mappings_json", sa.JSON(), nullable=False),
        sa.Column("raw_payload_mode", sa.String(length=64), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["stream_id"], ["streams.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("stream_id"),
    )
    op.create_index(op.f("ix_mappings_id"), "mappings", ["id"], unique=False)
    op.create_index(op.f("ix_mappings_stream_id"), "mappings", ["stream_id"], unique=True)

    op.create_table(
        "routes",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("stream_id", sa.Integer(), nullable=False),
        sa.Column("destination_id", sa.Integer(), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("failure_policy", sa.String(length=64), nullable=False),
        sa.Column("formatter_config_json", sa.JSON(), nullable=False),
        sa.Column("rate_limit_json", sa.JSON(), nullable=False),
        sa.Column("status", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["destination_id"], ["destinations.id"]),
        sa.ForeignKeyConstraint(["stream_id"], ["streams.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("stream_id", "destination_id", name="uq_routes_stream_destination"),
    )
    op.create_index(op.f("ix_routes_id"), "routes", ["id"], unique=False)
    op.create_index("idx_routes_stream_enabled", "routes", ["stream_id", "enabled"], unique=False)

    op.create_table(
        "delivery_logs",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("connector_id", sa.Integer(), nullable=True),
        sa.Column("stream_id", sa.Integer(), nullable=True),
        sa.Column("route_id", sa.Integer(), nullable=True),
        sa.Column("destination_id", sa.Integer(), nullable=True),
        sa.Column("stage", sa.String(length=64), nullable=False),
        sa.Column("level", sa.String(length=16), nullable=False),
        sa.Column("status", sa.String(length=64), nullable=True),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("payload_sample", sa.JSON(), nullable=True),
        sa.Column("retry_count", sa.Integer(), nullable=False),
        sa.Column("http_status", sa.Integer(), nullable=True),
        sa.Column("latency_ms", sa.Integer(), nullable=True),
        sa.Column("error_code", sa.String(length=128), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["connector_id"], ["connectors.id"]),
        sa.ForeignKeyConstraint(["destination_id"], ["destinations.id"]),
        sa.ForeignKeyConstraint(["route_id"], ["routes.id"]),
        sa.ForeignKeyConstraint(["stream_id"], ["streams.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_delivery_logs_id"), "delivery_logs", ["id"], unique=False)
    op.create_index(
        "idx_logs_stream_id_created_at",
        "delivery_logs",
        ["stream_id", "created_at"],
        unique=False,
    )
    op.create_index(
        "idx_logs_route_id_created_at",
        "delivery_logs",
        ["route_id", "created_at"],
        unique=False,
    )
    op.create_index(
        "idx_logs_destination_id_created_at",
        "delivery_logs",
        ["destination_id", "created_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("idx_logs_destination_id_created_at", table_name="delivery_logs")
    op.drop_index("idx_logs_route_id_created_at", table_name="delivery_logs")
    op.drop_index("idx_logs_stream_id_created_at", table_name="delivery_logs")
    op.drop_index(op.f("ix_delivery_logs_id"), table_name="delivery_logs")
    op.drop_table("delivery_logs")

    op.drop_index("idx_routes_stream_enabled", table_name="routes")
    op.drop_index(op.f("ix_routes_id"), table_name="routes")
    op.drop_table("routes")

    op.drop_index(op.f("ix_mappings_stream_id"), table_name="mappings")
    op.drop_index(op.f("ix_mappings_id"), table_name="mappings")
    op.drop_table("mappings")

    op.drop_index(op.f("ix_enrichments_stream_id"), table_name="enrichments")
    op.drop_index(op.f("ix_enrichments_id"), table_name="enrichments")
    op.drop_table("enrichments")

    op.drop_index(op.f("ix_checkpoints_id"), table_name="checkpoints")
    op.drop_table("checkpoints")

    op.drop_index(op.f("ix_streams_source_id"), table_name="streams")
    op.drop_index(op.f("ix_streams_id"), table_name="streams")
    op.drop_index(op.f("ix_streams_connector_id"), table_name="streams")
    op.drop_table("streams")

    op.drop_index(op.f("ix_sources_id"), table_name="sources")
    op.drop_index(op.f("ix_sources_connector_id"), table_name="sources")
    op.drop_table("sources")

    op.drop_index(op.f("ix_destinations_id"), table_name="destinations")
    op.drop_table("destinations")

    op.drop_index(op.f("ix_connectors_id"), table_name="connectors")
    op.drop_table("connectors")
