"""Bulk read model for Governance Workspace — one stream, all route effective dims."""

from __future__ import annotations

from collections import defaultdict
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.classification.models import StreamClassificationRule
from app.enrichments.models import Enrichment
from app.mappings.models import Mapping
from app.protection.models import StreamPolicyRule, StreamProtectionRule
from app.route_classification.models import RouteClassificationRule
from app.route_policy.models import RoutePolicyRule
from app.route_protection.models import RouteProtectionRule
from app.route_transform.models import RouteEnrichment, RouteMapping
from app.routes.models import Route
from app.runtime.control_service import StreamNotFoundError
from app.runtime.governance_workspace_snapshot_schemas import (
    GovernanceWorkspaceRouteSnapshot,
    GovernanceWorkspaceSnapshotResponse,
)
from app.runtime.route_classification_service import build_route_classification_effective
from app.runtime.route_policy_service import build_route_policy_effective
from app.runtime.route_processing_status import load_governance_route_overrides
from app.runtime.route_protection_service import build_route_protection_effective
from app.runtime.route_transform_service import build_route_transform_effective
from app.streams.models import Stream


def _route_display_name(route: Route) -> str:
    return f"Route #{int(route.id)}"


def _group_by_route_id(rows: list[Any]) -> dict[int, list[Any]]:
    grouped: dict[int, list[Any]] = defaultdict(list)
    for row in rows:
        grouped[int(row.route_id)].append(row)
    return grouped


def _index_by_route_id(rows: list[Any]) -> dict[int, Any]:
    return {int(row.route_id): row for row in rows}


def build_governance_workspace_snapshot(db: Session, stream_id: int) -> GovernanceWorkspaceSnapshotResponse:
    """Assemble stream-scoped workspace snapshot with bounded bulk queries (no per-route N+1)."""

    stream = db.get(Stream, stream_id)
    if stream is None:
        raise StreamNotFoundError(stream_id)

    routes = list(
        db.execute(select(Route).where(Route.stream_id == stream_id).order_by(Route.id.asc())).scalars()
    )
    route_ids = [int(route.id) for route in routes]

    # Stream-scoped rule/config loads (constant w.r.t. route count).
    stream_protection_rules = list(
        db.execute(
            select(StreamProtectionRule).where(StreamProtectionRule.stream_id == stream_id)
        ).scalars()
    )
    stream_classification_rules = list(
        db.execute(
            select(StreamClassificationRule).where(StreamClassificationRule.stream_id == stream_id)
        ).scalars()
    )
    stream_policy_rules = list(
        db.execute(select(StreamPolicyRule).where(StreamPolicyRule.stream_id == stream_id)).scalars()
    )
    stream_mapping = db.execute(select(Mapping).where(Mapping.stream_id == stream_id)).scalar_one_or_none()
    stream_enrichment = db.execute(
        select(Enrichment).where(Enrichment.stream_id == stream_id)
    ).scalar_one_or_none()

    # Prefer already-loaded stream for overrides (avoids a second Stream SELECT).
    config = stream.config_json if isinstance(stream.config_json, dict) else {}
    governance = config.get("governance") if isinstance(config, dict) else None
    raw_overrides = governance.get("route_overrides") if isinstance(governance, dict) else None
    if isinstance(raw_overrides, list):
        route_overrides: list[dict[str, Any]] = [item for item in raw_overrides if isinstance(item, dict)]
    else:
        # Fallback keeps semantics identical to per-route effective path.
        route_overrides = load_governance_route_overrides(db, stream_id)

    protection_by_route: dict[int, list[Any]] = {}
    classification_by_route: dict[int, list[Any]] = {}
    policy_by_route: dict[int, list[Any]] = {}
    mapping_by_route: dict[int, Any] = {}
    enrichment_by_route: dict[int, Any] = {}

    if route_ids:
        protection_by_route = _group_by_route_id(
            list(
                db.execute(
                    select(RouteProtectionRule).where(RouteProtectionRule.route_id.in_(route_ids))
                ).scalars()
            )
        )
        classification_by_route = _group_by_route_id(
            list(
                db.execute(
                    select(RouteClassificationRule).where(RouteClassificationRule.route_id.in_(route_ids))
                ).scalars()
            )
        )
        policy_by_route = _group_by_route_id(
            list(
                db.execute(select(RoutePolicyRule).where(RoutePolicyRule.route_id.in_(route_ids))).scalars()
            )
        )
        mapping_by_route = _index_by_route_id(
            list(db.execute(select(RouteMapping).where(RouteMapping.route_id.in_(route_ids))).scalars())
        )
        enrichment_by_route = _index_by_route_id(
            list(
                db.execute(select(RouteEnrichment).where(RouteEnrichment.route_id.in_(route_ids))).scalars()
            )
        )

    snapshots: list[GovernanceWorkspaceRouteSnapshot] = []
    for route in routes:
        rid = int(route.id)
        snapshots.append(
            GovernanceWorkspaceRouteSnapshot(
                route_id=rid,
                route_name=_route_display_name(route),
                transform=build_route_transform_effective(
                    route_id=rid,
                    stream_id=stream_id,
                    route_mapping=mapping_by_route.get(rid),
                    route_enrichment=enrichment_by_route.get(rid),
                    stream_mapping=stream_mapping,
                    stream_enrichment=stream_enrichment,
                ),
                protection=build_route_protection_effective(
                    route_id=rid,
                    stream_id=stream_id,
                    route_rule_rows=protection_by_route.get(rid, []),
                    stream_rule_rows=stream_protection_rules,
                    route_overrides=route_overrides,
                ),
                classification=build_route_classification_effective(
                    route_id=rid,
                    stream_id=stream_id,
                    route_rule_rows=classification_by_route.get(rid, []),
                    stream_rule_rows=stream_classification_rules,
                    route_overrides=route_overrides,
                ),
                policy=build_route_policy_effective(
                    route_id=rid,
                    stream_id=stream_id,
                    route_rule_rows=policy_by_route.get(rid, []),
                    stream_rule_rows=stream_policy_rules,
                    route_overrides=route_overrides,
                ),
            )
        )

    return GovernanceWorkspaceSnapshotResponse(
        stream_id=stream_id,
        route_count=len(snapshots),
        routes=snapshots,
    )
