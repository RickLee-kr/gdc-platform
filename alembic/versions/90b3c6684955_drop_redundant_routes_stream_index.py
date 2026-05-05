"""drop redundant routes stream index

Revision ID: 90b3c6684955
Revises: a9aee9120c1f
Create Date: 2026-05-05 17:40:27.058629
"""

from __future__ import annotations

revision = '90b3c6684955'
down_revision = 'a9aee9120c1f'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # no-op: redundant index removal handled in previous migrations
    pass


def downgrade() -> None:
    # no-op: redundant index stays removed in optimized chain
    pass
