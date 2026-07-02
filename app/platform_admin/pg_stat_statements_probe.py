"""PostgreSQL pg_stat_statements probe and top-query helpers."""

from __future__ import annotations

from typing import Any

from sqlalchemy import text
from sqlalchemy.engine import Connection


def probe_pg_stat_statements(conn: Connection) -> dict[str, Any]:
    """Return extension availability and lightweight stats for maintenance panels."""

    out: dict[str, Any] = {
        "enabled": False,
        "extension_installed": False,
        "tracked_statements": 0,
        "error": None,
    }
    try:
        preload = conn.execute(
            text("SHOW shared_preload_libraries")
        ).scalar_one_or_none()
        out["shared_preload_libraries"] = str(preload or "")
        out["enabled"] = "pg_stat_statements" in str(preload or "")
    except Exception as exc:  # pragma: no cover - defensive
        out["error"] = str(exc)[:300]
        return out

    try:
        installed = conn.execute(
            text(
                """
                SELECT EXISTS (
                    SELECT 1 FROM pg_extension WHERE extname = 'pg_stat_statements'
                )
                """
            )
        ).scalar_one()
        out["extension_installed"] = bool(installed)
    except Exception as exc:  # pragma: no cover - defensive
        out["error"] = str(exc)[:300]
        return out

    if not out["extension_installed"]:
        return out

    try:
        out["tracked_statements"] = int(
            conn.execute(text("SELECT COUNT(*) FROM pg_stat_statements")).scalar_one() or 0
        )
    except Exception as exc:  # pragma: no cover - defensive
        out["error"] = str(exc)[:300]
    return out


def fetch_pg_stat_statements_top(
    conn: Connection,
    *,
    limit: int = 10,
) -> list[dict[str, Any]]:
    """Return top statements by total execution time (requires extension + preload)."""

    lim = max(1, min(int(limit), 50))
    probe = probe_pg_stat_statements(conn)
    if not probe.get("extension_installed"):
        return []

    rows = conn.execute(
        text(
            f"""
            SELECT
                LEFT(query, 500) AS query,
                calls,
                ROUND(total_exec_time::numeric, 2) AS total_exec_time_ms,
                ROUND(mean_exec_time::numeric, 2) AS mean_exec_time_ms,
                ROUND(max_exec_time::numeric, 2) AS max_exec_time_ms,
                rows
            FROM pg_stat_statements
            WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
            ORDER BY total_exec_time DESC
            LIMIT :lim
            """
        ),
        {"lim": lim},
    ).mappings().all()
    return [dict(row) for row in rows]


__all__ = ["fetch_pg_stat_statements_top", "probe_pg_stat_statements"]
