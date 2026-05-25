"""Template Draft registry rows (metadata index; artifacts live on filesystem)."""

from __future__ import annotations

from sqlalchemy import DateTime, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base, utcnow


class TemplateDraft(Base):
    """Operator-saved Template Draft — not a runtime Stream or Connector."""

    __tablename__ = "template_drafts"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    vendor: Mapped[str | None] = mapped_column(String(128), nullable=True)
    product: Mapped[str | None] = mapped_column(String(128), nullable=True)
    use_case: Mapped[str | None] = mapped_column(String(128), nullable=True)
    source_type: Mapped[str] = mapped_column(String(64), nullable=False, default="HTTP_API_POLLING")
    api_family: Mapped[str | None] = mapped_column(String(64), nullable=True)
    api_version: Mapped[str | None] = mapped_column(String(64), nullable=True)
    auth_type: Mapped[str | None] = mapped_column(String(64), nullable=True)
    import_source: Mapped[str] = mapped_column(String(32), nullable=False)
    storage_path: Mapped[str] = mapped_column(String(512), nullable=False)
    metadata_json: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    created_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    updated_at: Mapped[DateTime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow
    )
    display_name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
