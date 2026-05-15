"""platform admin: local users + HTTPS configuration row."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "20260511_0009_pl_adm"
down_revision = "20260511_0008_val_alerts"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "platform_users",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("username", sa.String(length=128), nullable=False),
        sa.Column("password_hash", sa.String(length=255), nullable=False),
        sa.Column("role", sa.String(length=32), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_login_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_platform_users_username", "platform_users", ["username"], unique=True)

    op.create_table(
        "platform_https_config",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("certificate_ip_addresses", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("certificate_dns_names", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("redirect_http_to_https", sa.Boolean(), nullable=False),
        sa.Column("certificate_valid_days", sa.Integer(), nullable=False),
        sa.Column("cert_not_after", sa.DateTime(timezone=True), nullable=True),
        sa.Column("cert_generated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )

    op.execute(
        sa.text(
            """
            INSERT INTO platform_https_config (
                id, enabled, certificate_ip_addresses, certificate_dns_names,
                redirect_http_to_https, certificate_valid_days, cert_not_after, cert_generated_at, updated_at
            ) VALUES (
                1, FALSE, '[]'::jsonb, '[]'::jsonb, FALSE, 365, NULL, NULL, NOW()
            )
            """
        )
    )


def downgrade() -> None:
    op.drop_table("platform_https_config")
    op.drop_index("ix_platform_users_username", table_name="platform_users")
    op.drop_table("platform_users")
