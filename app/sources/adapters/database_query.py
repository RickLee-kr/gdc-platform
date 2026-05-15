"""DATABASE_QUERY source adapter — rows feed the standard extract → map → enrich pipeline."""

from __future__ import annotations

from typing import Any

from app.runtime.errors import SourceFetchError
from app.sources.adapters.base import SourceAdapter
from app.sources.database_query.execute import fetch_database_rows


def _get(cfg: dict[str, Any], key: str, default: Any = None) -> Any:
    if isinstance(cfg, dict):
        return cfg.get(key, default)
    return getattr(cfg, key, default)


class DatabaseQuerySourceAdapter(SourceAdapter):
    def fetch(
        self,
        source_config: dict[str, Any],
        stream_config: dict[str, Any],
        checkpoint: dict[str, Any] | None,
    ) -> Any:
        rows = fetch_database_rows(source_config=source_config, stream_config=stream_config, checkpoint=checkpoint)
        ck_mode = str(_get(stream_config, "checkpoint_mode") or "NONE").strip().upper()
        ck_col = str(_get(stream_config, "checkpoint_column") or "").strip()
        ck_ord = str(_get(stream_config, "checkpoint_order_column") or "").strip()

        out: list[dict[str, Any]] = []
        for r in rows:
            if not isinstance(r, dict):
                continue
            ev = dict(r)
            if ck_mode in {"SINGLE_COLUMN", "COMPOSITE_ORDER"} and ck_col and ck_col in r:
                ev["gdc_db_watermark"] = r.get(ck_col)
            if ck_mode == "COMPOSITE_ORDER" and ck_ord and ck_ord in r:
                ev["gdc_db_order_value"] = r.get(ck_ord)
            out.append(ev)
        return out
