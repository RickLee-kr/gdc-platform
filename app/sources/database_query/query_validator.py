"""Deterministic SELECT-only validation for DATABASE_QUERY streams."""

from __future__ import annotations

import re
from typing import Any

import sqlparse
from sqlparse import tokens as T

from app.runtime.errors import SourceFetchError

_FORBIDDEN_DML_DDL = frozenset(
    {
        "INSERT",
        "UPDATE",
        "DELETE",
        "MERGE",
        "DROP",
        "ALTER",
        "CREATE",
        "TRUNCATE",
        "COPY",
        "GRANT",
        "REVOKE",
        "CALL",
        "EXECUTE",
        "EXEC",
    }
)

_IDENTIFIER_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


def validate_sql_identifier(name: str, *, field: str) -> str:
    """Allow only simple unquoted SQL identifiers (checkpoint columns)."""

    raw = str(name or "").strip()
    if not raw or not _IDENTIFIER_RE.match(raw):
        raise SourceFetchError(f"Invalid {field}: use letters, digits, underscore; must start with letter or underscore.")
    return raw


def validate_select_query(sql: str) -> str:
    """Ensure a single read-only SELECT (or WITH … SELECT); raise SourceFetchError otherwise."""

    text = str(sql or "").strip()
    if not text:
        raise SourceFetchError("query is empty")

    if ";" in text:
        raise SourceFetchError("multi-statement SQL is not allowed (semicolon detected)")

    parsed = sqlparse.parse(text)
    if not parsed:
        raise SourceFetchError("query could not be parsed")
    if len(parsed) > 1:
        raise SourceFetchError("multi-statement SQL is not allowed")

    stmt = parsed[0]
    stype = str(stmt.get_type() or "").upper()
    if stype != "SELECT":
        raise SourceFetchError(f"only SELECT queries are allowed (parsed type: {stype or 'UNKNOWN'})")

    for tok in stmt.flatten():
        if tok.ttype in (T.Keyword.DML, T.Keyword.DDL):
            word = str(tok.value or "").strip().upper()
            if word in _FORBIDDEN_DML_DDL:
                raise SourceFetchError(f"forbidden SQL keyword in query: {word}")

    return text


def coerce_query_params(raw: Any) -> tuple | dict[str, Any] | None:
    """Normalize stream query_params to psycopg2 / PyMySQL binding shape."""

    if raw is None:
        return None
    if isinstance(raw, list):
        return tuple(raw)
    if isinstance(raw, dict):
        return dict(raw)
    raise SourceFetchError("query_params must be a JSON array (positional) or object (named)")

