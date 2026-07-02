"""Enable pg_stat_statements extension for operator SQL performance analysis."""

from __future__ import annotations

from alembic import op

revision = "20260630_0061"
down_revision = "20260630_0060"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_stat_statements")


def downgrade() -> None:
    op.execute("DROP EXTENSION IF EXISTS pg_stat_statements")
