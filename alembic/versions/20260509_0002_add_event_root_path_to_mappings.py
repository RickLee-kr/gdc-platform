"""add event_root_path to mappings

Revision ID: 20260509_0002
Revises: 20260505_0001
Create Date: 2026-05-09
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260509_0002"
down_revision = "90b3c6684955"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("mappings", sa.Column("event_root_path", sa.String(length=255), nullable=True))


def downgrade() -> None:
    op.drop_column("mappings", "event_root_path")
