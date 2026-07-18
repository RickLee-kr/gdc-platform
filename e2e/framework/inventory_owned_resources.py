#!/usr/bin/env python3
"""Inventory FULL E2E leftovers that correlate with evidence IDs (ownership gate)."""
from __future__ import annotations

import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

REPORTS = Path(__file__).resolve().parents[1] / "reports"


def main() -> int:
    write_run_id = os.environ.get("GDC_E2E_INVENTORY_RUN_ID") or f"stale-owned-{int(datetime.now(tz=timezone.utc).timestamp())}"
    url = os.environ.get("DATABASE_URL") or "postgresql://gdc:gdc@127.0.0.1:55441/gdc"
    try:
        import psycopg
    except ImportError:
        import psycopg2 as psycopg  # type: ignore

    evidence_stream_ids: set[int] = set()
    evidence_connector_ids: set[int] = set()
    evidence_destination_ids: set[int] = set()
    pats = [
        (re.compile(r'"stream_id"\s*:\s*(\d+)'), evidence_stream_ids),
        (re.compile(r'"streamId"\s*:\s*(\d+)'), evidence_stream_ids),
        (re.compile(r'"connector_id"\s*:\s*(\d+)'), evidence_connector_ids),
        (re.compile(r'"connectorId"\s*:\s*(\d+)'), evidence_connector_ids),
        (re.compile(r'"destination_id"\s*:\s*(\d+)'), evidence_destination_ids),
        (re.compile(r'"destinationId"\s*:\s*(\d+)'), evidence_destination_ids),
    ]
    interesting = {
        "result.json",
        "run-once.json",
        "pipeline-stages.json",
        "delivery-logs.json",
        "stream-config.json",
        "runtime-status.json",
        "scenario.json",
        "checkpoint.json",
        "routes.json",
    }
    if REPORTS.exists():
        for p in REPORTS.rglob("*.json"):
            if p.name not in interesting and "stream" not in p.name and "connector" not in p.name:
                continue
            try:
                text = p.read_text(errors="ignore")[:200000]
            except OSError:
                continue
            for pat, bucket in pats:
                for m in pat.finditer(text):
                    bucket.add(int(m.group(1)))

    conn = psycopg.connect(url)
    cur = conn.cursor()
    now = datetime.now(tz=timezone.utc).isoformat()
    resources: list[dict] = []

    def add(kind: str, id_: int, name: str | None = None, meta: dict | None = None) -> None:
        resources.append(
            {
                "kind": kind,
                "id": id_,
                "name": name,
                "createdAt": now,
                "ownership": "full-e2e-lab",
                "meta": meta or {"source": "inventory-owned", "evidence_correlated": True},
            }
        )

    cur.execute("SELECT id, name FROM streams WHERE name LIKE %s ORDER BY id", ("[FULL E2E]%",))
    streams = cur.fetchall()
    owned_streams = [s for s in streams if s[0] in evidence_stream_ids]
    unowned_streams = [s for s in streams if s[0] not in evidence_stream_ids]

    owned_stream_ids = [s[0] for s in owned_streams]
    owned_stream_connector_ids: set[int] = set()
    if owned_stream_ids:
        cur.execute("SELECT DISTINCT connector_id FROM streams WHERE id = ANY(%s)", (owned_stream_ids,))
        owned_stream_connector_ids = {int(r[0]) for r in cur.fetchall() if r[0] is not None}

    cur.execute("SELECT id, name FROM connectors WHERE name LIKE %s ORDER BY id", ("[FULL E2E]%",))
    connectors = cur.fetchall()
    # Browser helper createWebhookReceiverViaUi always names: "[FULL E2E] UI webhook ..."
    # Orphan UI connectors with that exact product-test naming are owned by Full E2E.
    def _is_ui_e2e_orphan(name: str, connector_id: int) -> bool:
        if not str(name).startswith("[FULL E2E] UI "):
            return False
        cur.execute("SELECT 1 FROM streams WHERE connector_id=%s LIMIT 1", (connector_id,))
        return cur.fetchone() is None

    owned_connectors = [
        c
        for c in connectors
        if c[0] in evidence_connector_ids
        or c[0] in owned_stream_connector_ids
        or _is_ui_e2e_orphan(str(c[1]), int(c[0]))
    ]
    unowned_connectors = [c for c in connectors if c not in owned_connectors]

    owned_dest_ids: set[int] = set()
    if owned_stream_ids:
        cur.execute(
            "SELECT DISTINCT destination_id FROM routes WHERE stream_id = ANY(%s)",
            (owned_stream_ids,),
        )
        owned_dest_ids = {int(r[0]) for r in cur.fetchall() if r[0] is not None}

    cur.execute("SELECT id, name FROM destinations WHERE name LIKE %s ORDER BY id", ("[FULL E2E]%",))
    destinations = cur.fetchall()
    owned_destinations = [
        d for d in destinations if d[0] in evidence_destination_ids or d[0] in owned_dest_ids
    ]
    unowned_destinations = [d for d in destinations if d not in owned_destinations]

    cur.execute(
        """
        SELECT r.id, r.stream_id, r.destination_id
        FROM routes r
        JOIN streams s ON s.id = r.stream_id
        WHERE s.name LIKE %s
        """,
        ("[FULL E2E]%",),
    )
    routes = cur.fetchall()
    owned_routes = [r for r in routes if r[1] in evidence_stream_ids]
    unowned_routes = [r for r in routes if r[1] not in evidence_stream_ids]

    for s in owned_streams:
        add("stream", int(s[0]), s[1], {"stream_id": int(s[0])})
        add("checkpoint", int(s[0]), s[1], {"stream_id": int(s[0])})
        add("dedup_key", int(s[0]), s[1], {"stream_id": int(s[0])})
    for r in owned_routes:
        add("route", int(r[0]), meta={"stream_id": int(r[1]), "destination_id": int(r[2])})
    for d in owned_destinations:
        add("destination", int(d[0]), d[1])
    for c in owned_connectors:
        add("connector", int(c[0]), c[1])
        cur.execute("SELECT id FROM sources WHERE connector_id=%s", (c[0],))
        for (sid,) in cur.fetchall():
            add("source", int(sid), meta={"connector_id": int(c[0])})

    report = {
        "owned": {
            "streams": len(owned_streams),
            "routes": len(owned_routes),
            "destinations": len(owned_destinations),
            "connectors": len(owned_connectors),
        },
        "unowned": {
            "streams": [{"id": s[0], "name": s[1]} for s in unowned_streams],
            "routes": [{"id": r[0], "stream_id": r[1]} for r in unowned_routes],
            "destinations": [{"id": d[0], "name": d[1]} for d in unowned_destinations],
            "connectors": [{"id": c[0], "name": c[1]} for c in unowned_connectors],
        },
        "resources": resources,
        "write_run_id": write_run_id,
    }
    conn.close()
    out_dir = REPORTS / write_run_id
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "ownership-inventory.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    registry = {
        "runId": write_run_id,
        "ownership": "full-e2e-lab",
        "updatedAt": now,
        "resources": resources,
    }
    (out_dir / "created-resources.json").write_text(json.dumps(registry, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"write_run_id": write_run_id, "owned": report["owned"], "unowned_counts": {
        k: len(v) for k, v in report["unowned"].items()
    }, "registry": str(out_dir / "created-resources.json")}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
