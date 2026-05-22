"""Physical runtime operational snapshot read model tables.

Revision ID: 20260522_0024_rt_ops_snap
Revises: 20260521_0023_audit
Create Date: 2026-05-22
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20260522_0024_rt_ops_snap"
down_revision = "20260521_0023_audit"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "runtime_stream_snapshot",
        sa.Column("stream_id", sa.Integer(), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("health_status", sa.String(length=16), nullable=False, server_default="IDLE"),
        sa.Column("eps_1m", sa.Float(), nullable=False, server_default="0"),
        sa.Column("eps_5m", sa.Float(), nullable=False, server_default="0"),
        sa.Column("success_rate_5m", sa.Float(), nullable=False, server_default="0"),
        sa.Column("failure_rate_5m", sa.Float(), nullable=False, server_default="0"),
        sa.Column("retry_rate_5m", sa.Float(), nullable=False, server_default="0"),
        sa.Column("avg_latency_ms", sa.Float(), nullable=True),
        sa.Column("route_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("healthy_route_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("failed_route_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("last_success_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_error_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_error_message", sa.Text(), nullable=True),
        sa.Column("checkpoint_updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("checkpoint_lag_seconds", sa.Integer(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["stream_id"], ["streams.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("stream_id"),
    )
    op.create_index(
        "idx_runtime_stream_snapshot_updated_at",
        "runtime_stream_snapshot",
        ["updated_at"],
        unique=False,
    )
    op.create_index(
        "idx_runtime_stream_snapshot_health_status",
        "runtime_stream_snapshot",
        ["health_status"],
        unique=False,
    )

    op.create_table(
        "runtime_route_snapshot",
        sa.Column("route_id", sa.Integer(), nullable=False),
        sa.Column("stream_id", sa.Integer(), nullable=False),
        sa.Column("destination_id", sa.Integer(), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("health_status", sa.String(length=16), nullable=False, server_default="IDLE"),
        sa.Column("delivered_eps_1m", sa.Float(), nullable=False, server_default="0"),
        sa.Column("failed_eps_1m", sa.Float(), nullable=False, server_default="0"),
        sa.Column("success_rate_5m", sa.Float(), nullable=False, server_default="0"),
        sa.Column("retry_rate_5m", sa.Float(), nullable=False, server_default="0"),
        sa.Column("avg_latency_ms", sa.Float(), nullable=True),
        sa.Column("last_success_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_error_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_error_message", sa.Text(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["route_id"], ["routes.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["stream_id"], ["streams.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["destination_id"], ["destinations.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("route_id"),
    )
    op.create_index(
        "idx_runtime_route_snapshot_updated_at",
        "runtime_route_snapshot",
        ["updated_at"],
        unique=False,
    )
    op.create_index(
        "idx_runtime_route_snapshot_stream_id",
        "runtime_route_snapshot",
        ["stream_id"],
        unique=False,
    )
    op.create_index(
        "idx_runtime_route_snapshot_health_status",
        "runtime_route_snapshot",
        ["health_status"],
        unique=False,
    )

    op.create_table(
        "runtime_destination_snapshot",
        sa.Column("destination_id", sa.Integer(), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("health_status", sa.String(length=16), nullable=False, server_default="IDLE"),
        sa.Column("inbound_eps_1m", sa.Float(), nullable=False, server_default="0"),
        sa.Column("failed_eps_1m", sa.Float(), nullable=False, server_default="0"),
        sa.Column("avg_latency_ms", sa.Float(), nullable=True),
        sa.Column("route_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("last_success_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_error_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_error_message", sa.Text(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["destination_id"], ["destinations.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("destination_id"),
    )
    op.create_index(
        "idx_runtime_destination_snapshot_updated_at",
        "runtime_destination_snapshot",
        ["updated_at"],
        unique=False,
    )
    op.create_index(
        "idx_runtime_destination_snapshot_health_status",
        "runtime_destination_snapshot",
        ["health_status"],
        unique=False,
    )

    op.create_table(
        "runtime_snapshot_updater_state",
        sa.Column("id", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("last_delivery_log_id", sa.BigInteger(), nullable=True),
        sa.Column("last_scan_since", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint("id = 1", name="ck_runtime_snapshot_updater_state_singleton"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.execute(
        sa.text(
            "INSERT INTO runtime_snapshot_updater_state (id, last_delivery_log_id, last_scan_since) "
            "VALUES (1, NULL, NULL)"
        )
    )


def downgrade() -> None:
    op.drop_table("runtime_snapshot_updater_state")
    op.drop_index("idx_runtime_destination_snapshot_health_status", table_name="runtime_destination_snapshot")
    op.drop_index("idx_runtime_destination_snapshot_updated_at", table_name="runtime_destination_snapshot")
    op.drop_table("runtime_destination_snapshot")
    op.drop_index("idx_runtime_route_snapshot_health_status", table_name="runtime_route_snapshot")
    op.drop_index("idx_runtime_route_snapshot_stream_id", table_name="runtime_route_snapshot")
    op.drop_index("idx_runtime_route_snapshot_updated_at", table_name="runtime_route_snapshot")
    op.drop_table("runtime_route_snapshot")
    op.drop_index("idx_runtime_stream_snapshot_health_status", table_name="runtime_stream_snapshot")
    op.drop_index("idx_runtime_stream_snapshot_updated_at", table_name="runtime_stream_snapshot")
    op.drop_table("runtime_stream_snapshot")
