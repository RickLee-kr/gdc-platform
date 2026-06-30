"""Platform display settings (default timezone) and per-user timezone preference."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20260629_0058_display_tz"
down_revision = "20260616_0057_route_policy"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("platform_users", sa.Column("timezone", sa.String(length=64), nullable=True))
    op.create_table(
        "platform_display_settings",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("default_timezone", sa.String(length=64), nullable=False, server_default="UTC"),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("id"),
    )
    op.execute(
        sa.text(
            "INSERT INTO platform_display_settings (id, default_timezone) VALUES (1, 'UTC') "
            "ON CONFLICT (id) DO NOTHING"
        )
    )


def downgrade() -> None:
    op.drop_table("platform_display_settings")
    op.drop_column("platform_users", "timezone")
