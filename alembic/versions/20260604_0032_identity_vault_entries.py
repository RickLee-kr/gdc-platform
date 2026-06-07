"""M7 identity vault — identity_vault_entries + global token sequence."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20260604_0032_identity_vault"
down_revision = "20260604_0031_protection_rules"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(sa.text("CREATE SEQUENCE IF NOT EXISTS identity_vault_token_seq START WITH 1 INCREMENT BY 1"))
    op.create_table(
        "identity_vault_entries",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("stream_id", sa.Integer(), nullable=False),
        sa.Column("field_path", sa.Text(), nullable=False),
        sa.Column("original_value_hash", sa.String(length=64), nullable=False),
        sa.Column("token_value", sa.String(length=32), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["stream_id"], ["streams.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "stream_id",
            "field_path",
            "original_value_hash",
            name="uq_identity_vault_stream_path_hash",
        ),
    )
    op.create_index(
        "ix_identity_vault_entries_stream_id",
        "identity_vault_entries",
        ["stream_id"],
    )
    op.create_index(
        "ix_identity_vault_entries_token_value",
        "identity_vault_entries",
        ["token_value"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("ix_identity_vault_entries_token_value", table_name="identity_vault_entries")
    op.drop_index("ix_identity_vault_entries_stream_id", table_name="identity_vault_entries")
    op.drop_table("identity_vault_entries")
    op.execute(sa.text("DROP SEQUENCE IF EXISTS identity_vault_token_seq"))
