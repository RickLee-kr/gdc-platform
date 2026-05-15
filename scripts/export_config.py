#!/usr/bin/env python3
"""Export connectors, sources, streams, mappings, enrichments, destinations, routes, checkpoints.

Plaintext credentials are redacted from ``auth_json`` fields.

Usage::

    python scripts/export_config.py --output backups/gdc_config_backup.json

Environment: ``DATABASE_URL`` (same as the API server).
"""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
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


def _iso(dt: datetime | None) -> str | None:
    if dt is None:
        return None
    return dt.isoformat()


def _connector_dict(c: Connector) -> dict:
    return {
        "id": c.id,
        "name": c.name,
        "description": c.description,
        "status": c.status,
        "created_at": _iso(c.created_at),
        "updated_at": _iso(c.updated_at),
    }


def _source_dict(s: Source) -> dict:
    auth = dict(s.auth_json or {})
    if auth:
        auth = {"_redacted": "secrets_not_exported_restore_manually"}
    return {
        "id": s.id,
        "connector_id": s.connector_id,
        "source_type": s.source_type,
        "config_json": dict(s.config_json or {}),
        "auth_json": auth,
        "enabled": s.enabled,
        "created_at": _iso(s.created_at),
        "updated_at": _iso(s.updated_at),
    }


def _stream_dict(st: Stream) -> dict:
    return {
        "id": st.id,
        "connector_id": st.connector_id,
        "source_id": st.source_id,
        "name": st.name,
        "stream_type": st.stream_type,
        "config_json": dict(st.config_json or {}),
        "polling_interval": st.polling_interval,
        "enabled": st.enabled,
        "status": st.status,
        "rate_limit_json": dict(st.rate_limit_json or {}),
        "created_at": _iso(st.created_at),
        "updated_at": _iso(st.updated_at),
    }


def _mapping_dict(m: Mapping) -> dict:
    return {
        "id": m.id,
        "stream_id": m.stream_id,
        "event_array_path": m.event_array_path,
        "event_root_path": m.event_root_path,
        "field_mappings_json": dict(m.field_mappings_json or {}),
        "raw_payload_mode": m.raw_payload_mode,
        "created_at": _iso(m.created_at),
        "updated_at": _iso(m.updated_at),
    }


def _enrichment_dict(e: Enrichment) -> dict:
    return {
        "id": e.id,
        "stream_id": e.stream_id,
        "enrichment_json": dict(e.enrichment_json or {}),
        "override_policy": e.override_policy,
        "enabled": e.enabled,
        "created_at": _iso(e.created_at),
        "updated_at": _iso(e.updated_at),
    }


def _destination_dict(d: Destination) -> dict:
    return {
        "id": d.id,
        "name": d.name,
        "destination_type": d.destination_type,
        "config_json": dict(d.config_json or {}),
        "rate_limit_json": dict(d.rate_limit_json or {}),
        "enabled": d.enabled,
        "created_at": _iso(d.created_at),
        "updated_at": _iso(d.updated_at),
    }


def _route_dict(r: Route) -> dict:
    return {
        "id": r.id,
        "stream_id": r.stream_id,
        "destination_id": r.destination_id,
        "enabled": r.enabled,
        "failure_policy": r.failure_policy,
        "formatter_config_json": dict(r.formatter_config_json or {}),
        "rate_limit_json": dict(r.rate_limit_json or {}),
        "status": r.status,
        "created_at": _iso(r.created_at),
        "updated_at": _iso(r.updated_at),
    }


def _checkpoint_dict(c: Checkpoint) -> dict:
    return {
        "id": c.id,
        "stream_id": c.stream_id,
        "checkpoint_type": c.checkpoint_type,
        "checkpoint_value_json": dict(c.checkpoint_value_json or {}),
        "updated_at": _iso(c.updated_at),
    }


def export_config(session: Session) -> dict:
    return {
        "version": 1,
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "connectors": [_connector_dict(r) for r in session.query(Connector).order_by(Connector.id.asc()).all()],
        "sources": [_source_dict(r) for r in session.query(Source).order_by(Source.id.asc()).all()],
        "destinations": [_destination_dict(r) for r in session.query(Destination).order_by(Destination.id.asc()).all()],
        "streams": [_stream_dict(r) for r in session.query(Stream).order_by(Stream.id.asc()).all()],
        "mappings": [_mapping_dict(r) for r in session.query(Mapping).order_by(Mapping.id.asc()).all()],
        "enrichments": [_enrichment_dict(r) for r in session.query(Enrichment).order_by(Enrichment.id.asc()).all()],
        "routes": [_route_dict(r) for r in session.query(Route).order_by(Route.id.asc()).all()],
        "checkpoints": [_checkpoint_dict(r) for r in session.query(Checkpoint).order_by(Checkpoint.id.asc()).all()],
    }


def main() -> None:
    p = argparse.ArgumentParser(description="Export GDC DB configuration to JSON.")
    p.add_argument(
        "--output",
        "-o",
        default=None,
        help="Output path (default: backups/gdc_config_backup_<timestamp>.json)",
    )
    args = p.parse_args()
    out = args.output
    if not out:
        backup_dir = Path("backups")
        backup_dir.mkdir(parents=True, exist_ok=True)
        ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
        out = str(backup_dir / f"gdc_config_backup_{ts}.json")

    path = Path(out)
    path.parent.mkdir(parents=True, exist_ok=True)

    db = SessionLocal()
    try:
        payload = export_config(db)
        path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        print(f"wrote {path}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
