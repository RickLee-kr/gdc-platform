"""Registry dispatch for :class:`SourceAdapter` by ``source_type``."""

from __future__ import annotations

from typing import Any

from app.pollers.http_poller import HttpPoller
from app.runtime.errors import SourceFetchError
from app.sources.adapters.base import SourceAdapter
from app.sources.adapters.database_query import DatabaseQuerySourceAdapter
from app.sources.adapters.http_api import HttpApiSourceAdapter
from app.sources.adapters.remote_file_polling import RemoteFilePollingAdapter
from app.sources.adapters.s3_object_polling import S3ObjectPollingAdapter


class SourceAdapterRegistry:
    """Maps ``Source.source_type`` values to adapters."""

    def __init__(self, *, http_poller: HttpPoller | None = None) -> None:
        poll = http_poller or HttpPoller()
        self._by_type: dict[str, SourceAdapter] = {
            "HTTP_API_POLLING": HttpApiSourceAdapter(poll),
            "S3_OBJECT_POLLING": S3ObjectPollingAdapter(),
            "DATABASE_QUERY": DatabaseQuerySourceAdapter(),
            "REMOTE_FILE_POLLING": RemoteFilePollingAdapter(),
        }

    def get(self, source_type: str | None) -> SourceAdapter:
        key = (source_type or "HTTP_API_POLLING").strip().upper()
        adapter = self._by_type.get(key)
        if adapter is None:
            raise SourceFetchError(f"Unsupported source_type: {key}")
        return adapter
