"""M6 protection engine — stream_protection_rules table."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20260604_0031_protection_rules"
down_revision = "20260603_0030_sensitive_findings"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "stream_protection_rules",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("stream_id", sa.Integer(), nullable=False),
        sa.Column("field_path", sa.Text(), nullable=False),
        sa.Column("sensitivity_class", sa.String(length=32), nullable=False),
        sa.Column("protection_mode", sa.String(length=16), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("source_finding_id", sa.Integer(), nullable=True),
        sa.Column("created_by", sa.String(length=128), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["stream_id"], ["streams.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["source_finding_id"],
            ["stream_sensitive_findings.id"],
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "stream_id",
            "field_path",
            name="uq_stream_protection_rules_stream_path",
        ),
    )
    op.create_index(
        "ix_stream_protection_rules_stream_enabled",
        "stream_protection_rules",
        ["stream_id", "enabled"],
    )


def downgrade() -> None:
    op.drop_index("ix_stream_protection_rules_stream_enabled", table_name="stream_protection_rules")
    op.drop_table("stream_protection_rules")
