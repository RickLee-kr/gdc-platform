#!/usr/bin/env python3
"""Import configuration produced by ``export_config.py``.

Creates rows when the primary key is unused; skips rows that already exist.

Usage::

    python scripts/import_config.py --input backups/gdc_config_backup.json

Environment: ``DATABASE_URL`` (same as the API server).
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from sqlalchemy.orm import Session

from app.checkpoints.models import Checkpoint
from app.connectors.models import Connector
from app.database import SessionLocal
from app.destinations.models import Destination
from app.enrichments.models import Enrichment
from app.mappings.models import Mapping
from app.routes.models import Route
from app.sources.models import Source
from app.streams.models import Stream


def import_bundle(session: Session, data: dict) -> dict[str, int]:
    stats = {"created": 0, "skipped": 0}

    def bump_created() -> None:
        stats["created"] += 1

    def bump_skipped() -> None:
        stats["skipped"] += 1

    for row in data.get("connectors", []):
        cid = int(row["id"])
        if session.get(Connector, cid) is not None:
            print(f"skip connectors id={cid} (exists)")
            bump_skipped()
            continue
        session.add(
            Connector(
                id=cid,
                name=str(row["name"]),
                description=row.get("description"),
                status=str(row.get("status") or "STOPPED"),
            )
        )
        print(f"create connectors id={cid}")
        bump_created()

    for row in data.get("sources", []):
        sid = int(row["id"])
        if session.get(Source, sid) is not None:
            print(f"skip sources id={sid} (exists)")
            bump_skipped()
            continue
        session.add(
            Source(
                id=sid,
                connector_id=int(row["connector_id"]),
                source_type=str(row["source_type"]),
                config_json=dict(row.get("config_json") or {}),
                auth_json=dict(row.get("auth_json") or {}),
                enabled=bool(row.get("enabled", True)),
            )
        )
        print(f"create sources id={sid}")
        bump_created()

    for row in data.get("destinations", []):
        did = int(row["id"])
        if session.get(Destination, did) is not None:
            print(f"skip destinations id={did} (exists)")
            bump_skipped()
            continue
        session.add(
            Destination(
                id=did,
                name=str(row["name"]),
                destination_type=str(row["destination_type"]),
                config_json=dict(row.get("config_json") or {}),
                rate_limit_json=dict(row.get("rate_limit_json") or {}),
                enabled=bool(row.get("enabled", True)),
            )
        )
        print(f"create destinations id={did}")
        bump_created()

    for row in data.get("streams", []):
        tid = int(row["id"])
        if session.get(Stream, tid) is not None:
            print(f"skip streams id={tid} (exists)")
            bump_skipped()
            continue
        session.add(
            Stream(
                id=tid,
                connector_id=int(row["connector_id"]),
                source_id=int(row["source_id"]),
                name=str(row["name"]),
                stream_type=str(row.get("stream_type") or "HTTP_API_POLLING"),
                config_json=dict(row.get("config_json") or {}),
                polling_interval=int(row.get("polling_interval") or 60),
                enabled=bool(row.get("enabled", True)),
                status=str(row.get("status") or "STOPPED"),
                rate_limit_json=dict(row.get("rate_limit_json") or {}),
            )
        )
        print(f"create streams id={tid}")
        bump_created()

    for row in data.get("mappings", []):
        mid = int(row["id"])
        if session.get(Mapping, mid) is not None:
            print(f"skip mappings id={mid} (exists)")
            bump_skipped()
            continue
        session.add(
            Mapping(
                id=mid,
                stream_id=int(row["stream_id"]),
                event_array_path=row.get("event_array_path"),
                event_root_path=row.get("event_root_path"),
                field_mappings_json=dict(row.get("field_mappings_json") or {}),
                raw_payload_mode=row.get("raw_payload_mode"),
            )
        )
        print(f"create mappings id={mid}")
        bump_created()

    for row in data.get("enrichments", []):
        eid = int(row["id"])
        if session.get(Enrichment, eid) is not None:
            print(f"skip enrichments id={eid} (exists)")
            bump_skipped()
            continue
        session.add(
            Enrichment(
                id=eid,
                stream_id=int(row["stream_id"]),
                enrichment_json=dict(row.get("enrichment_json") or {}),
                override_policy=str(row.get("override_policy") or "KEEP_EXISTING"),
                enabled=bool(row.get("enabled", True)),
            )
        )
        print(f"create enrichments id={eid}")
        bump_created()

    for row in data.get("routes", []):
        rid = int(row["id"])
        if session.get(Route, rid) is not None:
            print(f"skip routes id={rid} (exists)")
            bump_skipped()
            continue
        session.add(
            Route(
                id=rid,
                stream_id=int(row["stream_id"]),
                destination_id=int(row["destination_id"]),
                enabled=bool(row.get("enabled", True)),
                failure_policy=str(row.get("failure_policy") or "LOG_AND_CONTINUE"),
                formatter_config_json=dict(row.get("formatter_config_json") or {}),
                rate_limit_json=dict(row.get("rate_limit_json") or {}),
                status=str(row.get("status") or "ENABLED"),
            )
        )
        print(f"create routes id={rid}")
        bump_created()

    for row in data.get("checkpoints", []):
        ckid = int(row["id"])
        if session.get(Checkpoint, ckid) is not None:
            print(f"skip checkpoints id={ckid} (exists)")
            bump_skipped()
            continue
        session.add(
            Checkpoint(
                id=ckid,
                stream_id=int(row["stream_id"]),
                checkpoint_type=str(row.get("checkpoint_type") or "CUSTOM_FIELD"),
                checkpoint_value_json=dict(row.get("checkpoint_value_json") or {}),
            )
        )
        print(f"create checkpoints id={ckid}")
        bump_created()

    session.commit()
    return stats


def main() -> None:
    p = argparse.ArgumentParser(description="Import GDC configuration JSON.")
    p.add_argument("--input", "-i", required=True, help="JSON file from export_config.py")
    args = p.parse_args()
    path = Path(args.input)
    data = json.loads(path.read_text(encoding="utf-8"))

    db = SessionLocal()
    try:
        stats = import_bundle(db, data)
        print(stats)
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    main()
