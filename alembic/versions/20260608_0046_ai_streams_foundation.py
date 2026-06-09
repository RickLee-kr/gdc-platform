"""M21.3 AI Gateway — ai_streams facade table."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20260608_0046_ai_streams"
down_revision = "20260608_0045_ai_providers"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "ai_streams",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("stream_id", sa.Integer(), nullable=False),
        sa.Column("provider_id", sa.Integer(), nullable=False),
        sa.Column("slug", sa.String(length=128), nullable=False),
        sa.Column("model", sa.String(length=128), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["stream_id"], ["streams.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["provider_id"], ["ai_providers.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("slug", name="uq_ai_streams_slug"),
        sa.UniqueConstraint("stream_id", name="uq_ai_streams_stream_id"),
    )
    op.create_index("ix_ai_streams_provider_id", "ai_streams", ["provider_id"])
    op.create_index("ix_ai_streams_enabled", "ai_streams", ["enabled"])


def downgrade() -> None:
    op.drop_index("ix_ai_streams_enabled", table_name="ai_streams")
    op.drop_index("ix_ai_streams_provider_id", table_name="ai_streams")
    op.drop_table("ai_streams")
