"""platform admin operational: retention, audit log, config versions, alert settings."""

from __future__ import annotations

import json

import sqlalchemy as sa
from alembic import op
from sqlalchemy import column, insert, table
from sqlalchemy.dialects import postgresql

revision = "20260511_0010_pl_ops"
down_revision = "20260511_0009_pl_adm"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "platform_retention_policy",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("logs_retention_days", sa.Integer(), nullable=False),
        sa.Column("logs_enabled", sa.Boolean(), nullable=False),
        sa.Column("logs_last_cleanup_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("logs_next_cleanup_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("runtime_metrics_retention_days", sa.Integer(), nullable=False),
        sa.Column("runtime_metrics_enabled", sa.Boolean(), nullable=False),
        sa.Column("runtime_metrics_last_cleanup_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("runtime_metrics_next_cleanup_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("preview_cache_retention_days", sa.Integer(), nullable=False),
        sa.Column("preview_cache_enabled", sa.Boolean(), nullable=False),
        sa.Column("preview_cache_last_cleanup_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("preview_cache_next_cleanup_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("backup_temp_retention_days", sa.Integer(), nullable=False),
        sa.Column("backup_temp_enabled", sa.Boolean(), nullable=False),
        sa.Column("backup_temp_last_cleanup_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("backup_temp_next_cleanup_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )

    op.create_table(
        "platform_audit_events",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("actor_username", sa.String(length=128), nullable=False),
        sa.Column("action", sa.String(length=64), nullable=False),
        sa.Column("entity_type", sa.String(length=64), nullable=True),
        sa.Column("entity_id", sa.Integer(), nullable=True),
        sa.Column("entity_name", sa.String(length=256), nullable=True),
        sa.Column("details_json", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_platform_audit_events_created_at", "platform_audit_events", ["created_at"], unique=False)

    op.create_table(
        "platform_config_versions",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("entity_type", sa.String(length=64), nullable=False),
        sa.Column("entity_id", sa.Integer(), nullable=False),
        sa.Column("entity_name", sa.String(length=256), nullable=True),
        sa.Column("changed_by", sa.String(length=128), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("summary", sa.String(length=512), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("version"),
    )
    op.create_index("ix_platform_config_versions_created_at", "platform_config_versions", ["created_at"], unique=False)

    op.create_table(
        "platform_alert_settings",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("rules_json", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("webhook_url", sa.String(length=1024), nullable=True),
        sa.Column("slack_webhook_url", sa.String(length=1024), nullable=True),
        sa.Column("email_to", sa.String(length=512), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )

    op.execute(
        sa.text(
            """
            INSERT INTO platform_retention_policy (
                id,
                logs_retention_days, logs_enabled, logs_last_cleanup_at, logs_next_cleanup_at,
                runtime_metrics_retention_days, runtime_metrics_enabled,
                runtime_metrics_last_cleanup_at, runtime_metrics_next_cleanup_at,
                preview_cache_retention_days, preview_cache_enabled,
                preview_cache_last_cleanup_at, preview_cache_next_cleanup_at,
                backup_temp_retention_days, backup_temp_enabled,
                backup_temp_last_cleanup_at, backup_temp_next_cleanup_at,
                updated_at
            ) VALUES (
                1,
                30, TRUE, NULL, NULL,
                90, TRUE, NULL, NULL,
                7, TRUE, NULL, NULL,
                14, TRUE, NULL, NULL,
                NOW()
            )
            """
        )
    )

    default_rules = [
        {"alert_type": "stream_paused", "enabled": True, "severity": "WARNING", "last_triggered_at": None},
        {"alert_type": "checkpoint_stalled", "enabled": True, "severity": "CRITICAL", "last_triggered_at": None},
        {"alert_type": "destination_failed", "enabled": True, "severity": "CRITICAL", "last_triggered_at": None},
        {"alert_type": "high_retry_count", "enabled": False, "severity": "WARNING", "last_triggered_at": None},
        {"alert_type": "rate_limit_triggered", "enabled": True, "severity": "WARNING", "last_triggered_at": None},
    ]
    alert_t = table(
        "platform_alert_settings",
        column("id"),
        column("rules_json"),
        column("webhook_url"),
        column("slack_webhook_url"),
        column("email_to"),
        column("updated_at"),
    )
    # Core insert() passes bind params to psycopg2; list/dict must be JSON-serialized for JSONB.
    rules_literal = sa.cast(json.dumps(default_rules), postgresql.JSONB(astext_type=sa.Text()))
    op.execute(
        insert(alert_t).values(
            id=1,
            rules_json=rules_literal,
            webhook_url=None,
            slack_webhook_url=None,
            email_to=None,
            updated_at=sa.func.now(),
        )
    )


def downgrade() -> None:
    op.drop_table("platform_alert_settings")
    op.drop_index("ix_platform_config_versions_created_at", table_name="platform_config_versions")
    op.drop_table("platform_config_versions")
    op.drop_index("ix_platform_audit_events_created_at", table_name="platform_audit_events")
    op.drop_table("platform_audit_events")
    op.drop_table("platform_retention_policy")
