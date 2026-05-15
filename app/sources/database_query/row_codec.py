"""Normalize driver values to JSON-friendly Python types."""

from __future__ import annotations

import base64
from datetime import date, datetime, time, timedelta
from decimal import Decimal
from typing import Any


def json_safe_row(row: dict[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for k, v in row.items():
        out[str(k)] = _json_safe_value(v)
    return out


def _json_safe_value(v: Any) -> Any:
    if v is None:
        return None
    if isinstance(v, bool | int | float | str):
        return v
    if isinstance(v, Decimal):
        return str(v)
    if isinstance(v, datetime):
        if v.tzinfo is None:
            return v.isoformat() + "Z"
        return v.isoformat()
    if isinstance(v, date):
        return v.isoformat()
    if isinstance(v, time):
        return v.isoformat()
    if isinstance(v, timedelta):
        return v.total_seconds()
    if isinstance(v, bytes | bytearray):
        return {"gdc_encoding": "base64", "data": base64.b64encode(bytes(v)).decode("ascii")}
    if isinstance(v, dict):
        return {str(kk): _json_safe_value(vv) for kk, vv in v.items()}
    if isinstance(v, (list, tuple)):
        return [_json_safe_value(x) for x in v]
    return str(v)
