"""platform network config: reverse-proxy published ports.

Revision ID: 20260518_0022_net_cfg
Revises: 20260517_0021_obs_scale
Create Date: 2026-05-18
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20260518_0022_net_cfg"
down_revision = "20260517_0021_obs_scale"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "platform_network_config",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("http_port", sa.Integer(), nullable=False),
        sa.Column("https_port", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("http_port BETWEEN 1 AND 65535", name="ck_platform_network_config_http_port_range"),
        sa.CheckConstraint("https_port BETWEEN 1 AND 65535", name="ck_platform_network_config_https_port_range"),
        sa.CheckConstraint("http_port <> https_port", name="ck_platform_network_config_distinct_ports"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.execute(
        sa.text(
            """
            INSERT INTO platform_network_config (id, http_port, https_port, updated_at)
            VALUES (1, 18080, 18443, NOW())
            """
        )
    )


def downgrade() -> None:
    op.drop_table("platform_network_config")
