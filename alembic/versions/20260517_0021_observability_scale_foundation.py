"""Add delivery_logs partitioning and runtime aggregate snapshots.

Revision ID: 20260517_0021_obs_scale
Revises: 20260516_0020_rt_metrics_30d
Create Date: 2026-05-17
"""

from __future__ import annotations

from datetime import date

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "20260517_0021_obs_scale"
down_revision = "20260516_0020_rt_metrics_30d"
branch_labels = None
depends_on = None


def _month_floor(value: date) -> date:
    return date(value.year, value.month, 1)


def _add_month(value: date) -> date:
    if value.month == 12:
        return date(value.year + 1, 1, 1)
    return date(value.year, value.month + 1, 1)


def _partition_name(month_start: date) -> str:
    return f"delivery_logs_{month_start.year:04d}_{month_start.month:02d}"


def _create_partition(month_start: date) -> None:
    month_end = _add_month(month_start)
    op.execute(
        sa.text(
            f"""
            CREATE TABLE IF NOT EXISTS {_partition_name(month_start)}
            PARTITION OF delivery_logs
            FOR VALUES FROM ('{month_start.isoformat()} 00:00:00+00')
            TO ('{month_end.isoformat()} 00:00:00+00')
            """
        )
    )


def _create_default_partition() -> None:
    op.execute(
        sa.text(
            """
            CREATE TABLE IF NOT EXISTS delivery_logs_default
            PARTITION OF delivery_logs DEFAULT
            """
        )
    )


def _delivery_logs_is_partitioned() -> bool:
    bind = op.get_bind()
    return bool(
        bind.execute(
            sa.text(
                """
                SELECT EXISTS (
                    SELECT 1
                    FROM pg_partitioned_table pt
                    JOIN pg_class c ON c.oid = pt.partrelid
                    WHERE c.relname = 'delivery_logs'
                )
                """
            )
        ).scalar()
    )


def _create_delivery_log_parent_indexes() -> None:
    op.create_index("ix_delivery_logs_id", "delivery_logs", ["id"], unique=False)
    op.create_index("idx_logs_created_at", "delivery_logs", ["created_at"], unique=False)
    op.create_index("idx_logs_stage_created_at", "delivery_logs", ["stage", "created_at"], unique=False)
    op.create_index("idx_logs_stream_id_created_at", "delivery_logs", ["stream_id", "created_at"], unique=False)
    op.create_index("idx_logs_route_id_created_at", "delivery_logs", ["route_id", "created_at"], unique=False)
    op.create_index(
        "idx_logs_destination_id_created_at",
        "delivery_logs",
        ["destination_id", "created_at"],
        unique=False,
    )
    op.create_index(
        "ix_delivery_logs_run_id_created_at",
        "delivery_logs",
        ["run_id", "created_at"],
        unique=False,
        postgresql_where=sa.text("run_id IS NOT NULL"),
    )


def _convert_delivery_logs_to_monthly_partitions() -> None:
    if _delivery_logs_is_partitioned():
        today = _month_floor(date.today())
        _create_partition(today)
        _create_partition(_add_month(today))
        _create_default_partition()
        return

    bind = op.get_bind()
    bounds = bind.execute(
        sa.text("SELECT min(created_at)::date AS min_created_at, max(created_at)::date AS max_created_at FROM delivery_logs")
    ).one()
    first_month = _month_floor(bounds.min_created_at or date.today())
    last_month = _month_floor(bounds.max_created_at or date.today())

    op.execute(sa.text("ALTER TABLE delivery_logs RENAME TO delivery_logs_unpartitioned"))
    for index_name in (
        "ix_delivery_logs_id",
        "idx_logs_created_at",
        "idx_logs_stage_created_at",
        "idx_logs_stream_id_created_at",
        "idx_logs_route_id_created_at",
        "idx_logs_destination_id_created_at",
        "ix_delivery_logs_run_id_created_at",
    ):
        op.execute(sa.text(f"DROP INDEX IF EXISTS {index_name}"))

    op.execute(
        sa.text(
            """
            CREATE TABLE delivery_logs (
                id integer NOT NULL DEFAULT nextval('delivery_logs_id_seq'::regclass),
                connector_id integer NULL,
                stream_id integer NULL,
                route_id integer NULL,
                destination_id integer NULL,
                stage varchar(64) NOT NULL,
                level varchar(16) NOT NULL,
                status varchar(64) NULL,
                message text NOT NULL,
                payload_sample json NULL,
                retry_count integer NOT NULL,
                http_status integer NULL,
                latency_ms integer NULL,
                error_code varchar(128) NULL,
                created_at timestamp with time zone NOT NULL DEFAULT now(),
                run_id varchar(36) NULL,
                CONSTRAINT pk_delivery_logs_id_created_at PRIMARY KEY (id, created_at),
                CONSTRAINT fk_delivery_logs_connector_id FOREIGN KEY (connector_id) REFERENCES connectors(id),
                CONSTRAINT fk_delivery_logs_stream_id FOREIGN KEY (stream_id) REFERENCES streams(id),
                CONSTRAINT fk_delivery_logs_route_id FOREIGN KEY (route_id) REFERENCES routes(id),
                CONSTRAINT fk_delivery_logs_destination_id FOREIGN KEY (destination_id) REFERENCES destinations(id)
            ) PARTITION BY RANGE (created_at)
            """
        )
    )

    month = first_month
    next_after_last = _add_month(last_month)
    while month <= next_after_last:
        _create_partition(month)
        month = _add_month(month)
    _create_default_partition()

    op.execute(
        sa.text(
            """
            INSERT INTO delivery_logs (
                id,
                connector_id,
                stream_id,
                route_id,
                destination_id,
                stage,
                level,
                status,
                message,
                payload_sample,
                retry_count,
                http_status,
                latency_ms,
                error_code,
                created_at,
                run_id
            )
            SELECT
                id,
                connector_id,
                stream_id,
                route_id,
                destination_id,
                stage,
                level,
                status,
                message,
                payload_sample,
                retry_count,
                http_status,
                latency_ms,
                error_code,
                created_at,
                run_id
            FROM delivery_logs_unpartitioned
            """
        )
    )
    op.execute(
        sa.text(
            """
            SELECT setval(
                'delivery_logs_id_seq',
                GREATEST(
                    COALESCE((SELECT max(id) FROM delivery_logs), 1),
                    COALESCE((SELECT last_value FROM delivery_logs_id_seq), 1)
                ),
                true
            )
            """
        )
    )
    op.execute(sa.text("ALTER SEQUENCE delivery_logs_id_seq OWNED BY delivery_logs.id"))
    _create_delivery_log_parent_indexes()
    op.execute(sa.text("DROP TABLE delivery_logs_unpartitioned"))


def upgrade() -> None:
    _convert_delivery_logs_to_monthly_partitions()
    op.create_table(
        "runtime_aggregate_snapshots",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("snapshot_scope", sa.String(length=64), nullable=False),
        sa.Column("snapshot_key", sa.String(length=512), nullable=False),
        sa.Column("snapshot_id", sa.String(length=64), nullable=False),
        sa.Column("generated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("window_start", sa.DateTime(timezone=True), nullable=False),
        sa.Column("window_end", sa.DateTime(timezone=True), nullable=False),
        sa.Column("payload_json", postgresql.JSONB(), nullable=False),
        sa.Column("metric_meta_json", postgresql.JSONB(), nullable=False),
        sa.Column("visualization_meta_json", postgresql.JSONB(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint(
            "snapshot_scope",
            "snapshot_key",
            "snapshot_id",
            name="uq_runtime_aggregate_snapshots_scope_key_snapshot",
        ),
    )
    op.create_index(
        "idx_runtime_aggregate_snapshots_scope_key_expires",
        "runtime_aggregate_snapshots",
        ["snapshot_scope", "snapshot_key", "expires_at"],
        unique=False,
    )
    op.create_index(
        "idx_runtime_aggregate_snapshots_expires_at",
        "runtime_aggregate_snapshots",
        ["expires_at"],
        unique=False,
    )
    op.create_index(
        "idx_runtime_aggregate_snapshots_created_at",
        "runtime_aggregate_snapshots",
        ["created_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("idx_runtime_aggregate_snapshots_created_at", table_name="runtime_aggregate_snapshots")
    op.drop_index("idx_runtime_aggregate_snapshots_expires_at", table_name="runtime_aggregate_snapshots")
    op.drop_index("idx_runtime_aggregate_snapshots_scope_key_expires", table_name="runtime_aggregate_snapshots")
    op.drop_table("runtime_aggregate_snapshots")
    # Downgrade intentionally does not convert partitioned delivery_logs back to a heap table.
    # That rollback would require another full-table copy and risks operator delivery history;
    # keep the partitioned structure in place unless an operator performs a manual data-safe rollback.

