"""Lightweight PostgreSQL checks for ``delivery_logs`` index validity (read-only)."""

from __future__ import annotations

from typing import Any

from sqlalchemy import text
from sqlalchemy.engine import Connection


def probe_delivery_logs_indexes(conn: Connection) -> dict[str, Any]:
    """Return invalid / not-ready btree indexes on ``delivery_logs`` in the current schema.

    Operators may run ``REINDEX INDEX CONCURRENTLY …`` when ``reindex_suggested`` is true.
    This does not detect all corruption classes; it surfaces catalog flags PostgreSQL sets
    when indexes fail validation or are mid-build.
    """

    out: dict[str, Any] = {
        "checked": False,
        "invalid_indexes": [],
        "reindex_suggested": False,
        "error": None,
    }
    try:
        rows = conn.execute(
            text(
                """
                SELECT ci.relname AS index_name, i.indisvalid, i.indisready
                FROM pg_class tbl
                JOIN pg_namespace ns ON ns.oid = tbl.relnamespace
                JOIN pg_index i ON i.indrelid = tbl.oid
                JOIN pg_class ci ON ci.oid = i.indexrelid
                WHERE tbl.relname = 'delivery_logs'
                  AND ns.nspname = ANY (current_schemas(false))
                """
            )
        ).mappings().all()
        out["checked"] = True
        bad: list[dict[str, Any]] = []
        for r in rows:
            if not bool(r["indisvalid"]) or not bool(r["indisready"]):
                bad.append(
                    {
                        "name": str(r["index_name"]),
                        "indisvalid": bool(r["indisvalid"]),
                        "indisready": bool(r["indisready"]),
                    }
                )
        out["invalid_indexes"] = bad
        out["reindex_suggested"] = len(bad) > 0
    except Exception as exc:  # pragma: no cover - defensive
        out["error"] = str(exc)[:240]
    return out


__all__ = ["probe_delivery_logs_indexes"]
