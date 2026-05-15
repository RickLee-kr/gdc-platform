"""platform_retention_policy.operational_retention_meta — backfill/snapshot retention throttle."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "20260512_0018_op_ret_meta"
down_revision = "20260512_0017_backfill_progress"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "platform_retention_policy",
        sa.Column(
            "operational_retention_meta",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
    )


def downgrade() -> None:
    op.drop_column("platform_retention_policy", "operational_retention_meta")
