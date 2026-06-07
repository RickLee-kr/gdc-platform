"""M18.4 Policy Lifecycle — status enum extension and lifecycle timestamps."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20260606_0042_gov_lifecycle"
down_revision = "20260605_0041_gov_policies"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "governance_policies",
        sa.Column("activated_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "governance_policies",
        sa.Column("retired_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.execute(
        sa.text(
            "UPDATE governance_policies SET status = 'RETIRED', retired_at = updated_at "
            "WHERE status = 'DISABLED'"
        )
    )


def downgrade() -> None:
    op.execute(
        sa.text("UPDATE governance_policies SET status = 'DISABLED' WHERE status = 'RETIRED'")
    )
    op.drop_column("governance_policies", "retired_at")
    op.drop_column("governance_policies", "activated_at")
