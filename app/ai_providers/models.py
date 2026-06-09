"""SQLAlchemy model: AiProvider."""

from __future__ import annotations

from sqlalchemy import JSON, Boolean, DateTime, Integer, String
from sqlalchemy.dialects.postgresql import ENUM
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base, utcnow

AI_PROVIDER_TYPES = (
    "OPENAI",
    "AZURE_OPENAI",
    "CLAUDE",
    "GEMINI",
    "OLLAMA",
    "VLLM",
    "MOCK",
)


class AiProvider(Base):
    """Vendor endpoint and credentials for AI Gateway destinations."""

    __tablename__ = "ai_providers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    provider_type: Mapped[str] = mapped_column(
        ENUM(*AI_PROVIDER_TYPES, name="ai_provider_type", create_type=False),
        nullable=False,
    )
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    endpoint_url: Mapped[str] = mapped_column(String(512), nullable=False)
    auth_json: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    default_model: Mapped[str | None] = mapped_column(String(128), nullable=True)
    timeout_seconds: Mapped[int] = mapped_column(Integer, nullable=False, default=120)
    created_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    updated_at: Mapped[DateTime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow
    )
