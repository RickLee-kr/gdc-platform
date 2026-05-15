"""continuous_validations.last_perf_snapshot_json — dev validation performance smoke (optional)."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20260512_0015_val_perf"
down_revision = "20260512_0014_cfg_snap"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "continuous_validations",
        sa.Column("last_perf_snapshot_json", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("continuous_validations", "last_perf_snapshot_json")
