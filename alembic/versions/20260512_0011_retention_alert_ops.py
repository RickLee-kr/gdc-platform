"""retention cleanup state + alert delivery history + alert cooldown."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "20260512_0011_ret_alert"
down_revision = "20260511_0010_pl_ops"
branch_labels = None
depends_on = None


_CATEGORIES = ("logs", "runtime_metrics", "preview_cache", "backup_temp")


def upgrade() -> None:
    op.add_column(
        "platform_retention_policy",
        sa.Column("cleanup_scheduler_enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
    )
    op.add_column(
        "platform_retention_policy",
        sa.Column("cleanup_interval_minutes", sa.Integer(), nullable=False, server_default="60"),
    )
    op.add_column(
        "platform_retention_policy",
        sa.Column("cleanup_batch_size", sa.Integer(), nullable=False, server_default="5000"),
    )

    for cat in _CATEGORIES:
        op.add_column(
            "platform_retention_policy",
            sa.Column(f"{cat}_last_deleted_count", sa.Integer(), nullable=True),
        )
        op.add_column(
            "platform_retention_policy",
            sa.Column(f"{cat}_last_duration_ms", sa.Integer(), nullable=True),
        )
        op.add_column(
            "platform_retention_policy",
            sa.Column(f"{cat}_last_status", sa.String(length=32), nullable=True),
        )

    op.add_column(
        "platform_alert_settings",
        sa.Column("cooldown_seconds", sa.Integer(), nullable=False, server_default="600"),
    )
    op.add_column(
        "platform_alert_settings",
        sa.Column("monitor_enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
    )

    op.create_table(
        "platform_alert_history",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("alert_type", sa.String(length=64), nullable=False),
        sa.Column("severity", sa.String(length=16), nullable=False),
        sa.Column("stream_id", sa.Integer(), nullable=True),
        sa.Column("stream_name", sa.String(length=256), nullable=True),
        sa.Column("route_id", sa.Integer(), nullable=True),
        sa.Column("destination_id", sa.Integer(), nullable=True),
        sa.Column("message", sa.String(length=1024), nullable=False),
        sa.Column("fingerprint", sa.String(length=64), nullable=False),
        sa.Column("channel", sa.String(length=32), nullable=False, server_default="webhook"),
        sa.Column("delivery_status", sa.String(length=32), nullable=False),
        sa.Column("http_status", sa.Integer(), nullable=True),
        sa.Column("error_message", sa.String(length=512), nullable=True),
        sa.Column("webhook_url_masked", sa.String(length=512), nullable=True),
        sa.Column("duration_ms", sa.Integer(), nullable=True),
        sa.Column("payload_json", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("trigger_source", sa.String(length=32), nullable=False, server_default="monitor"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_platform_alert_history_created_at",
        "platform_alert_history",
        ["created_at"],
        unique=False,
    )
    op.create_index(
        "ix_platform_alert_history_alert_type",
        "platform_alert_history",
        ["alert_type"],
        unique=False,
    )
    op.create_index(
        "ix_platform_alert_history_fingerprint",
        "platform_alert_history",
        ["fingerprint"],
        unique=False,
    )
    op.create_index(
        "ix_platform_alert_history_stream_id",
        "platform_alert_history",
        ["stream_id"],
        unique=False,
    )

    # Drop server defaults so application semantics drive future writes.
    op.alter_column("platform_retention_policy", "cleanup_scheduler_enabled", server_default=None)
    op.alter_column("platform_retention_policy", "cleanup_interval_minutes", server_default=None)
    op.alter_column("platform_retention_policy", "cleanup_batch_size", server_default=None)
    op.alter_column("platform_alert_settings", "cooldown_seconds", server_default=None)
    op.alter_column("platform_alert_settings", "monitor_enabled", server_default=None)
    op.alter_column("platform_alert_history", "channel", server_default=None)
    op.alter_column("platform_alert_history", "trigger_source", server_default=None)


def downgrade() -> None:
    op.drop_index("ix_platform_alert_history_stream_id", table_name="platform_alert_history")
    op.drop_index("ix_platform_alert_history_fingerprint", table_name="platform_alert_history")
    op.drop_index("ix_platform_alert_history_alert_type", table_name="platform_alert_history")
    op.drop_index("ix_platform_alert_history_created_at", table_name="platform_alert_history")
    op.drop_table("platform_alert_history")

    op.drop_column("platform_alert_settings", "monitor_enabled")
    op.drop_column("platform_alert_settings", "cooldown_seconds")

    for cat in _CATEGORIES:
        op.drop_column("platform_retention_policy", f"{cat}_last_status")
        op.drop_column("platform_retention_policy", f"{cat}_last_duration_ms")
        op.drop_column("platform_retention_policy", f"{cat}_last_deleted_count")

    op.drop_column("platform_retention_policy", "cleanup_batch_size")
    op.drop_column("platform_retention_policy", "cleanup_interval_minutes")
    op.drop_column("platform_retention_policy", "cleanup_scheduler_enabled")
