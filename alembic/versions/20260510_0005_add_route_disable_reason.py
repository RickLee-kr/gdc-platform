"""Add optional disable_reason on routes (operational disable notes).

Revision ID: 20260510_0005
Revises: 20260510_0004
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260510_0005"
down_revision = "20260510_0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("routes", sa.Column("disable_reason", sa.String(length=512), nullable=True))


def downgrade() -> None:
    op.drop_column("routes", "disable_reason")
