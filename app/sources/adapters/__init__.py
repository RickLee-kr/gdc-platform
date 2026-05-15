"""Source adapters (plugin-style) for stream ingestion."""

from __future__ import annotations

from app.sources.adapters.base import SourceAdapter
from app.sources.adapters.http_api import HttpApiSourceAdapter
from app.sources.adapters.registry import SourceAdapterRegistry

__all__ = ["SourceAdapter", "HttpApiSourceAdapter", "SourceAdapterRegistry"]
