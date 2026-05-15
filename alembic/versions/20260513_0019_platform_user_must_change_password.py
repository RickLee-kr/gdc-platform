"""platform_users.must_change_password — force default-password change on first login."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20260513_0019_must_change_pw"
down_revision = "20260512_0018_op_ret_meta"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "platform_users",
        sa.Column(
            "must_change_password",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )


def downgrade() -> None:
    op.drop_column("platform_users", "must_change_password")
