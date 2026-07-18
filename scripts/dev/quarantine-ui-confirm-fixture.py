#!/usr/bin/env python3
"""Seed / cleanup quarantine rows used only for UI confirm dialog browser checks.

Marker: metadata_json.ui_confirm_test == true and reason prefix [UI-CONFIRM-TEST]
Never touches DEV VALIDATION / DEV E2E streams.
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone

MARKER = "[UI-CONFIRM-TEST]"
META_FLAG = "ui_confirm_test"


def _session():
    # Ensure relationship mappers resolve (Stream → Connector → Source, …).
    from app.main import app as _app  # noqa: F401
    from app.database import SessionLocal

    return SessionLocal()


def seed(*, stream_id: int, count: int) -> list[int]:
    from app.quarantine.models import (
        QUARANTINE_SOURCE_POLICY,
        QUARANTINE_STATUS_QUARANTINED,
        StreamQuarantineEvent,
    )
    from app.streams.models import Stream

    db = _session()
    try:
        stream = db.query(Stream).filter(Stream.id == int(stream_id)).one_or_none()
        if stream is None:
            raise SystemExit(f"stream {stream_id} not found")
        name = str(stream.name or "")
        if "DEV VALIDATION" in name.upper() or "DEV E2E" in name.upper():
            raise SystemExit(f"refusing to seed on protected stream: {name}")

        now = datetime.now(timezone.utc)
        ids: list[int] = []
        for i in range(count):
            row = StreamQuarantineEvent(
                stream_id=int(stream_id),
                quarantine_reason=f"{MARKER} synthetic quarantine row #{i + 1}",
                quarantine_source=QUARANTINE_SOURCE_POLICY,
                status=QUARANTINE_STATUS_QUARANTINED,
                protected_payload_json={
                    "events": [{"classification_level": "RESTRICTED", "marker": MARKER}],
                },
                metadata_json={
                    META_FLAG: True,
                    "event_count": 1,
                    "policy_names": [f"{MARKER} Policy"],
                },
                created_at=now,
                updated_at=now,
            )
            db.add(row)
            db.flush()
            ids.append(int(row.id))
        db.commit()
        print(json.dumps({"seeded_ids": ids, "stream_id": stream_id, "marker": MARKER}))
        return ids
    finally:
        db.close()


def cleanup() -> int:
    from app.quarantine.models import StreamQuarantineEvent

    db = _session()
    try:
        rows = (
            db.query(StreamQuarantineEvent)
            .filter(StreamQuarantineEvent.quarantine_reason.like(f"{MARKER}%"))
            .all()
        )
        # Also catch any rows that only set the metadata flag.
        flagged = (
            db.query(StreamQuarantineEvent)
            .filter(StreamQuarantineEvent.metadata_json["ui_confirm_test"].as_string() == "true")
            .all()
        )
        by_id = {int(r.id): r for r in rows}
        for r in flagged:
            by_id[int(r.id)] = r
        ids = sorted(by_id)
        for row in by_id.values():
            db.delete(row)
        db.commit()
        print(json.dumps({"deleted_ids": ids, "deleted_count": len(ids), "marker": MARKER}))
        return len(ids)
    finally:
        db.close()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="cmd", required=True)
    seed_p = sub.add_parser("seed")
    seed_p.add_argument("--stream-id", type=int, required=True)
    seed_p.add_argument("--count", type=int, default=2)
    sub.add_parser("cleanup")
    args = parser.parse_args()
    if args.cmd == "seed":
        seed(stream_id=args.stream_id, count=args.count)
    else:
        cleanup()


if __name__ == "__main__":
    main()
