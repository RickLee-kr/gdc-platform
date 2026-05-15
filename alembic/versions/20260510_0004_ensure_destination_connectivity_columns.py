"""Ensure connectivity columns exist on destinations (idempotent for drifted databases).

Revision ID: 20260510_0004
Revises: 20260510_0003
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260510_0004"
down_revision = "20260510_0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # PostgreSQL: safe when a DB had tables but missed revision 20260510_0003.
    op.execute(
        sa.text(
            """
            ALTER TABLE destinations ADD COLUMN IF NOT EXISTS last_connectivity_test_at TIMESTAMP WITH TIME ZONE;
            ALTER TABLE destinations ADD COLUMN IF NOT EXISTS last_connectivity_test_success BOOLEAN;
            ALTER TABLE destinations ADD COLUMN IF NOT EXISTS last_connectivity_test_latency_ms DOUBLE PRECISION;
            ALTER TABLE destinations ADD COLUMN IF NOT EXISTS last_connectivity_test_message TEXT;
            """
        )
    )


def downgrade() -> None:
    pass
