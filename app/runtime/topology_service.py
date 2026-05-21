"""Read-only runtime topology aggregation for operator graph views."""

from __future__ import annotations

from sqlalchemy.orm import Session, joinedload

from app.connectors.models import Connector
from app.destinations.models import Destination
from app.enrichments.models import Enrichment
from app.mappings.models import Mapping
from app.routes.models import Route
from app.runtime import health_service
from app.runtime.topology_schemas import (
    RuntimeTopologyResponse,
    TopologyConnectorNode,
    TopologyDestinationNode,
    TopologyRouteNode,
    TopologySourceNode,
    TopologyStreamNode,
    TopologySummary,
)
from app.sources.models import Source
from app.streams.models import Stream


def _mapping_stream_ids(db: Session) -> dict[int, bool]:
    rows = db.query(Mapping.stream_id, Mapping.field_mappings_json).all()
    out: dict[int, bool] = {}
    for stream_id, field_mappings in rows:
        mappings = field_mappings if isinstance(field_mappings, dict) else {}
        out[int(stream_id)] = len(mappings) > 0
    return out


def _enrichment_by_stream(db: Session) -> dict[int, tuple[bool, bool]]:
    rows = db.query(Enrichment.stream_id, Enrichment.enrichment_json, Enrichment.enabled).all()
    out: dict[int, tuple[bool, bool]] = {}
    for stream_id, enrichment_json, enabled in rows:
        payload = enrichment_json if isinstance(enrichment_json, dict) else {}
        out[int(stream_id)] = (len(payload) > 0, bool(enabled))
    return out


def get_runtime_topology(
    db: Session,
    *,
    window: str | None = "24h",
    scoring_mode: str | None = "current_runtime",
    snapshot_id: str | None = None,
) -> RuntimeTopologyResponse:
    """Build connector → source → stream → route → destination graph from live config."""

    mode = "historical_analytics" if scoring_mode == "historical_analytics" else "current_runtime"

    connectors = db.query(Connector).order_by(Connector.id.asc()).all()
    sources = db.query(Source).order_by(Source.id.asc()).all()
    streams = db.query(Stream).order_by(Stream.id.asc()).all()
    routes = (
        db.query(Route)
        .options(joinedload(Route.destination))
        .order_by(Route.stream_id.asc(), Route.id.asc())
        .all()
    )

    mapping_flags = _mapping_stream_ids(db)
    enrichment_flags = _enrichment_by_stream(db)

    health_kw = dict(
        window=window,
        since=None,
        stream_id=None,
        route_id=None,
        destination_id=None,
        scoring_mode=mode,
        snapshot_id=snapshot_id,
    )
    stream_health_resp = health_service.list_stream_health(db, **health_kw)
    route_health_resp = health_service.list_route_health(db, **health_kw)
    destination_health_resp = health_service.list_destination_health(db, **health_kw)
    time_window = stream_health_resp.time

    stream_health = {row.stream_id: row for row in stream_health_resp.rows}
    route_health = {row.route_id: row for row in route_health_resp.rows}
    destination_health = {row.destination_id: row for row in destination_health_resp.rows}

    streams_by_source: dict[int, int] = {}
    streams_by_connector: dict[int, int] = {}
    routes_by_stream: dict[int, int] = {}
    routes_by_destination: dict[int, int] = {}

    stream_nodes: list[TopologyStreamNode] = []
    for stream in streams:
        sid = int(stream.id)
        cid = int(stream.connector_id)
        src_id = int(stream.source_id)
        streams_by_source[src_id] = streams_by_source.get(src_id, 0) + 1
        streams_by_connector[cid] = streams_by_connector.get(cid, 0) + 1
        has_mapping = mapping_flags.get(sid, False)
        has_enrichment, enrichment_enabled = enrichment_flags.get(sid, (False, False))
        health = stream_health.get(sid)
        stream_nodes.append(
            TopologyStreamNode(
                stream_id=sid,
                stream_name=str(stream.name),
                connector_id=cid,
                source_id=src_id,
                stream_type=str(stream.stream_type or ""),
                enabled=bool(stream.enabled),
                status=str(stream.status or "STOPPED"),
                has_mapping=has_mapping,
                has_enrichment=has_enrichment,
                enrichment_enabled=enrichment_enabled if has_enrichment else False,
                route_count=0,
                health_level=health.level if health is not None else None,
                health_score=health.score if health is not None else None,
                last_success_at=health.metrics.last_success_at if health is not None else None,
                last_failure_at=health.metrics.last_failure_at if health is not None else None,
            )
        )

    route_nodes: list[TopologyRouteNode] = []
    destination_ids: set[int] = set()
    for route in routes:
        rid = int(route.id)
        sid = int(route.stream_id)
        did = int(route.destination_id)
        destination_ids.add(did)
        routes_by_stream[sid] = routes_by_stream.get(sid, 0) + 1
        routes_by_destination[did] = routes_by_destination.get(did, 0) + 1
        destination = route.destination
        health = route_health.get(rid)
        route_nodes.append(
            TopologyRouteNode(
                route_id=rid,
                stream_id=sid,
                destination_id=did,
                enabled=bool(route.enabled),
                status=str(route.status or "ENABLED"),
                failure_policy=str(route.failure_policy or ""),
                destination_name=str(destination.name) if destination is not None else None,
                destination_type=str(destination.destination_type) if destination is not None else None,
                destination_enabled=bool(destination.enabled) if destination is not None else False,
                health_level=health.level if health is not None else None,
                health_score=health.score if health is not None else None,
                last_success_at=health.metrics.last_success_at if health is not None else None,
                last_failure_at=health.metrics.last_failure_at if health is not None else None,
            )
        )

    for node in stream_nodes:
        node.route_count = routes_by_stream.get(node.stream_id, 0)

    destination_rows = (
        db.query(Destination).filter(Destination.id.in_(destination_ids)).order_by(Destination.id.asc()).all()
        if destination_ids
        else []
    )
    destination_nodes: list[TopologyDestinationNode] = []
    for dest in destination_rows:
        did = int(dest.id)
        health = destination_health.get(did)
        destination_nodes.append(
            TopologyDestinationNode(
                destination_id=did,
                name=str(dest.name),
                destination_type=str(dest.destination_type or ""),
                enabled=bool(dest.enabled),
                route_count=routes_by_destination.get(did, 0),
                health_level=health.level if health is not None else None,
                health_score=health.score if health is not None else None,
                last_success_at=health.metrics.last_success_at if health is not None else None,
                last_failure_at=health.metrics.last_failure_at if health is not None else None,
            )
        )

    connector_nodes = [
        TopologyConnectorNode(
            id=int(c.id),
            name=str(c.name),
            status=str(c.status or "STOPPED"),
            source_count=sum(1 for s in sources if int(s.connector_id) == int(c.id)),
            stream_count=streams_by_connector.get(int(c.id), 0),
        )
        for c in connectors
    ]
    source_nodes = [
        TopologySourceNode(
            id=int(s.id),
            connector_id=int(s.connector_id),
            source_type=str(s.source_type or ""),
            enabled=bool(s.enabled),
            stream_count=streams_by_source.get(int(s.id), 0),
        )
        for s in sources
    ]

    enabled_streams = sum(1 for n in stream_nodes if n.enabled)
    enabled_routes = sum(1 for n in route_nodes if n.enabled)

    summary = TopologySummary(
        connector_count=len(connector_nodes),
        source_count=len(source_nodes),
        stream_count=len(stream_nodes),
        route_count=len(route_nodes),
        destination_count=len(destination_nodes),
        streams_with_mapping=sum(1 for n in stream_nodes if n.has_mapping),
        streams_with_enrichment=sum(1 for n in stream_nodes if n.has_enrichment),
        enabled_streams=enabled_streams,
        disabled_streams=len(stream_nodes) - enabled_streams,
        enabled_routes=enabled_routes,
        disabled_routes=len(route_nodes) - enabled_routes,
    )

    return RuntimeTopologyResponse(
        time=time_window,
        scoring_mode=mode,
        summary=summary,
        connectors=connector_nodes,
        sources=source_nodes,
        streams=stream_nodes,
        routes=route_nodes,
        destinations=destination_nodes,
    )
