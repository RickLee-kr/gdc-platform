"""platform_https_config: reverse-proxy reload audit columns."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20260512_0013_https_px"
down_revision = "20260512_0012_user_tv"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("platform_https_config", sa.Column("proxy_last_reload_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("platform_https_config", sa.Column("proxy_last_reload_ok", sa.Boolean(), nullable=True))
    op.add_column("platform_https_config", sa.Column("proxy_last_reload_detail", sa.String(length=1024), nullable=True))
    op.add_column(
        "platform_https_config",
        sa.Column("proxy_last_https_effective", sa.Boolean(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("platform_https_config", "proxy_last_https_effective")
    op.drop_column("platform_https_config", "proxy_last_reload_detail")
    op.drop_column("platform_https_config", "proxy_last_reload_ok")
    op.drop_column("platform_https_config", "proxy_last_reload_at")
