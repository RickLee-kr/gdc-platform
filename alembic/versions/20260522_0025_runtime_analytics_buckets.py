"""Historical runtime analytics bucket read model (Phase 6).

Revision ID: 20260522_0025_rt_analytics
Revises: 20260522_0024_rt_ops_snap
Create Date: 2026-05-22
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20260522_0025_rt_analytics"
down_revision = "20260522_0024_rt_ops_snap"
branch_labels = None
depends_on = None


def _create_bucket_table(name: str) -> None:
    op.create_table(
        name,
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("bucket_start", sa.DateTime(timezone=True), nullable=False),
        sa.Column("stream_id", sa.Integer(), nullable=False),
        sa.Column("route_id", sa.Integer(), nullable=False),
        sa.Column("destination_id", sa.Integer(), nullable=False),
        sa.Column("event_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("success_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("failure_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("retry_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("rate_limited_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("eps_avg", sa.Float(), nullable=False, server_default="0"),
        sa.Column("latency_avg_ms", sa.Float(), nullable=True),
        sa.Column("latency_p95_ms", sa.Float(), nullable=True),
        sa.Column("latency_max_ms", sa.Float(), nullable=True),
        sa.Column("last_error_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("health_transition_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(f"idx_{name}_bucket_start", name, ["bucket_start"], unique=False)
    op.create_index(f"idx_{name}_stream_id", name, ["stream_id"], unique=False)
    op.create_index(f"idx_{name}_route_id", name, ["route_id"], unique=False)
    op.create_index(f"idx_{name}_destination_id", name, ["destination_id"], unique=False)
    op.create_index(
        f"idx_{name}_bucket_start_stream_route_dest",
        name,
        ["bucket_start", "stream_id", "route_id", "destination_id"],
        unique=False,
    )
    op.create_unique_constraint(
        f"uq_{name}_bucket_dims",
        name,
        ["bucket_start", "stream_id", "route_id", "destination_id"],
    )


def upgrade() -> None:
    _create_bucket_table("runtime_analytics_bucket_1m")
    _create_bucket_table("runtime_analytics_bucket_5m")
    op.create_table(
        "runtime_analytics_bucket_updater_state",
        sa.Column("id", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("last_delivery_log_id", sa.BigInteger(), nullable=True),
        sa.Column("last_scan_since", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint("id = 1", name="ck_runtime_analytics_bucket_updater_state_singleton"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.execute(
        sa.text(
            "INSERT INTO runtime_analytics_bucket_updater_state (id, last_delivery_log_id, last_scan_since) "
            "VALUES (1, NULL, NULL)"
        )
    )


def downgrade() -> None:
    op.drop_table("runtime_analytics_bucket_updater_state")
    op.drop_constraint("uq_runtime_analytics_bucket_5m_bucket_dims", "runtime_analytics_bucket_5m", type_="unique")
    op.drop_index(
        "idx_runtime_analytics_bucket_5m_bucket_start_stream_route_dest",
        table_name="runtime_analytics_bucket_5m",
    )
    op.drop_index("idx_runtime_analytics_bucket_5m_destination_id", table_name="runtime_analytics_bucket_5m")
    op.drop_index("idx_runtime_analytics_bucket_5m_route_id", table_name="runtime_analytics_bucket_5m")
    op.drop_index("idx_runtime_analytics_bucket_5m_stream_id", table_name="runtime_analytics_bucket_5m")
    op.drop_index("idx_runtime_analytics_bucket_5m_bucket_start", table_name="runtime_analytics_bucket_5m")
    op.drop_table("runtime_analytics_bucket_5m")
    op.drop_constraint("uq_runtime_analytics_bucket_1m_bucket_dims", "runtime_analytics_bucket_1m", type_="unique")
    op.drop_index(
        "idx_runtime_analytics_bucket_1m_bucket_start_stream_route_dest",
        table_name="runtime_analytics_bucket_1m",
    )
    op.drop_index("idx_runtime_analytics_bucket_1m_destination_id", table_name="runtime_analytics_bucket_1m")
    op.drop_index("idx_runtime_analytics_bucket_1m_route_id", table_name="runtime_analytics_bucket_1m")
    op.drop_index("idx_runtime_analytics_bucket_1m_stream_id", table_name="runtime_analytics_bucket_1m")
    op.drop_index("idx_runtime_analytics_bucket_1m_bucket_start", table_name="runtime_analytics_bucket_1m")
    op.drop_table("runtime_analytics_bucket_1m")
