"""M21.2 AI Gateway Foundation — ai_providers table."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import ENUM, JSONB

revision = "20260608_0045_ai_providers"
down_revision = "20260606_0044_gov_notifications"
branch_labels = None
depends_on = None

AI_PROVIDER_TYPE = ENUM(
    "OPENAI",
    "AZURE_OPENAI",
    "CLAUDE",
    "GEMINI",
    "OLLAMA",
    "VLLM",
    "MOCK",
    name="ai_provider_type",
    create_type=False,
)


def upgrade() -> None:
    bind = op.get_bind()
    AI_PROVIDER_TYPE.create(bind, checkfirst=True)

    op.create_table(
        "ai_providers",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("name", sa.String(length=128), nullable=False),
        sa.Column("provider_type", AI_PROVIDER_TYPE, nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("endpoint_url", sa.String(length=512), nullable=False),
        sa.Column("auth_json", JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("default_model", sa.String(length=128), nullable=True),
        sa.Column("timeout_seconds", sa.Integer(), nullable=False, server_default="120"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_ai_providers_provider_type", "ai_providers", ["provider_type"])
    op.create_index("ix_ai_providers_enabled", "ai_providers", ["enabled"])


def downgrade() -> None:
    op.drop_index("ix_ai_providers_enabled", table_name="ai_providers")
    op.drop_index("ix_ai_providers_provider_type", table_name="ai_providers")
    op.drop_table("ai_providers")
    bind = op.get_bind()
    AI_PROVIDER_TYPE.drop(bind, checkfirst=True)
