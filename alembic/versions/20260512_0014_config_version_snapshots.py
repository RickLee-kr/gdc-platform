"""platform_config_versions: before/after JSON snapshots for diff and rollback."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "20260512_0014_cfg_snap"
down_revision = "20260512_0013_https_px"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "platform_config_versions",
        sa.Column("snapshot_before_json", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )
    op.add_column(
        "platform_config_versions",
        sa.Column("snapshot_after_json", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("platform_config_versions", "snapshot_after_json")
    op.drop_column("platform_config_versions", "snapshot_before_json")
