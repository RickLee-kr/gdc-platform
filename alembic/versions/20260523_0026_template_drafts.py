"""template_drafts table for Template Builder draft index."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "20260523_0026_template_drafts"
down_revision = "20260522_0025_rt_analytics"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "template_drafts",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("display_name", sa.String(length=255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("vendor", sa.String(length=128), nullable=True),
        sa.Column("product", sa.String(length=128), nullable=True),
        sa.Column("use_case", sa.String(length=128), nullable=True),
        sa.Column("source_type", sa.String(length=64), nullable=False, server_default="HTTP_API_POLLING"),
        sa.Column("api_family", sa.String(length=64), nullable=True),
        sa.Column("api_version", sa.String(length=64), nullable=True),
        sa.Column("auth_type", sa.String(length=64), nullable=True),
        sa.Column("import_source", sa.String(length=32), nullable=False),
        sa.Column("storage_path", sa.String(length=512), nullable=False),
        sa.Column("metadata_json", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default="{}"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_template_drafts_created_at", "template_drafts", ["created_at"])
    op.create_index("ix_template_drafts_import_source", "template_drafts", ["import_source"])


def downgrade() -> None:
    op.drop_index("ix_template_drafts_import_source", table_name="template_drafts")
    op.drop_index("ix_template_drafts_created_at", table_name="template_drafts")
    op.drop_table("template_drafts")
