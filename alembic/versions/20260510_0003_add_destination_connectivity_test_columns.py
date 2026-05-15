"""add destination connectivity test result columns

Revision ID: 20260510_0003
Revises: 20260509_0002
Create Date: 2026-05-10
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260510_0003"
down_revision = "20260509_0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "destinations",
        sa.Column("last_connectivity_test_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "destinations",
        sa.Column("last_connectivity_test_success", sa.Boolean(), nullable=True),
    )
    op.add_column(
        "destinations",
        sa.Column("last_connectivity_test_latency_ms", sa.Float(), nullable=True),
    )
    op.add_column(
        "destinations",
        sa.Column("last_connectivity_test_message", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("destinations", "last_connectivity_test_message")
    op.drop_column("destinations", "last_connectivity_test_latency_ms")
    op.drop_column("destinations", "last_connectivity_test_success")
    op.drop_column("destinations", "last_connectivity_test_at")
