"""Normalize runtime_metrics retention default from 90 to 30 days (no table truncation)."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20260516_0020_rt_metrics_30d"
down_revision = "20260513_0019_must_change_pw"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Legacy seeded row (0010) used 90; operators who intentionally keep 90 can set it again via Admin UI.
    op.execute(
        sa.text(
            """
            UPDATE platform_retention_policy
            SET runtime_metrics_retention_days = 30
            WHERE runtime_metrics_retention_days = 90
            """
        )
    )
    op.alter_column(
        "platform_retention_policy",
        "runtime_metrics_retention_days",
        existing_type=sa.Integer(),
        existing_nullable=False,
        server_default=sa.text("30"),
    )


def downgrade() -> None:
    op.alter_column(
        "platform_retention_policy",
        "runtime_metrics_retention_days",
        existing_type=sa.Integer(),
        existing_nullable=False,
        server_default=sa.text("90"),
    )
