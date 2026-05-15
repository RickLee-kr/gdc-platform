"""platform_users.token_version for JWT invalidation (spec 020)."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20260512_0012_user_tv"
down_revision = "20260512_0011_ret_alert"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "platform_users",
        sa.Column("token_version", sa.Integer(), nullable=False, server_default="1"),
    )
    # Drop the server_default after backfill so future inserts go through application logic.
    op.alter_column("platform_users", "token_version", server_default=None)


def downgrade() -> None:
    op.drop_column("platform_users", "token_version")
