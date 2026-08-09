"""Batch-local Global Transform reuse across inherited routes."""

from __future__ import annotations

import time
from typing import Any
from unittest.mock import patch

import pytest
from sqlalchemy.orm import Session

from app.config import settings
from app.route_transform.models import RouteEnrichment, RouteMapping
from app.runners.route_context import (
    RouteEffectiveConfig,
    RouteRuntimeContext,
    RouteTransformConfig,
    SharedBatchContext,
)
from app.runners import route_stage
from app.runners.route_stage import process_route_pipeline, process_routes
from app.runners.route_transform_config import transform_config_cache_key
from app.runtime.errors import MappingError
from app.runners.stream_loader import load_stream_context
from tests.test_stream_runner_e2e import (
    _FakePoller,
    _FakeWebhookSender,
    _build_runner,
    _seed_stream_runtime,
)


def _stream_transform(**overrides: Any) -> RouteTransformConfig:
    base = {
        "field_mappings": {"message": "$.message", "vendor": "$.vendor"},
        "enrichment": {"product": "GDC"},
        "override_policy": "KEEP_EXISTING",
        "mapping_source": "stream",
        "enrichment_source": "stream",
    }
    base.update(overrides)
    return RouteTransformConfig(**base)


def _route_override(route_id: int) -> RouteTransformConfig:
    return RouteTransformConfig(
        field_mappings={"only_message": "$.message"},
        enrichment={"route_tag": f"route-{route_id}"},
        override_policy="KEEP_EXISTING",
        mapping_source="route",
        enrichment_source="route",
    )


def _make_route(route_id: int, transform: RouteTransformConfig | None) -> RouteRuntimeContext:
    return RouteRuntimeContext(
        route_id=route_id,
        stream_id=10,
        destination_id=100 + route_id,
        route_name=f"route-{route_id}",
        route_type="WEBHOOK_POST",
        formatter={},
        delivery_policy="LOG_AND_CONTINUE",
        rate_limit={},
        metadata={},
        effective_config=RouteEffectiveConfig(transform=transform),
    )


def _shared_batch(
    *,
    batch_id: str = "batch-1",
    events: list[dict[str, Any]] | None = None,
) -> SharedBatchContext:
    return SharedBatchContext(
        stream_id=10,
        batch_id=batch_id,
        event_root=None,
        union_schema=[],
        extracted_events=events
        or [
            {"message": "hello", "vendor": "acme", "common": "value"},
        ],
        schema_observation={},
        sensitive_detection_result=None,
        checkpoint_cursor_before=None,
        shared_runtime_data={"stream_protection_rules": [], "route_overrides": []},
    )


def _count_transform_executions(
    contexts: list[RouteRuntimeContext],
    shared: SharedBatchContext,
) -> tuple[int, int, int]:
    """Return (apply_route_transform, apply_mappings, apply_enrichments) call counts."""

    original = route_stage._apply_route_transform
    transform_calls = {"n": 0}

    def _wrap(**kwargs: Any) -> Any:
        transform_calls["n"] += 1
        return original(**kwargs)

    with patch.object(route_stage, "_apply_route_transform", side_effect=_wrap):
        with patch.object(
            route_stage, "apply_mappings_with_results", wraps=route_stage.apply_mappings_with_results
        ) as map_mock:
            with patch.object(
                route_stage, "apply_enrichments_batch", wraps=route_stage.apply_enrichments_batch
            ) as enrich_mock:
                process_routes(contexts, shared)
                return transform_calls["n"], map_mock.call_count, enrich_mock.call_count


def test_transform_config_cache_key_stable_for_identical_effective_config() -> None:
    a = _stream_transform()
    b = _stream_transform()
    assert transform_config_cache_key(a) == transform_config_cache_key(b)
    c = _route_override(1)
    assert transform_config_cache_key(a) != transform_config_cache_key(c)


def test_global_transform_single_execution_scaling() -> None:
    """Inherited route count must not increase Global Transform executions."""

    for n in (1, 10, 100):
        contexts = [_make_route(i + 1, _stream_transform()) for i in range(n)]
        shared = _shared_batch(batch_id=f"scale-{n}")
        transform_n, map_n, enrich_n = _count_transform_executions(contexts, shared)
        assert transform_n == 1, f"n_routes={n} transform={transform_n}"
        assert map_n == 1, f"n_routes={n} mapping={map_n}"
        assert enrich_n == 1, f"n_routes={n} enrichment={enrich_n}"
        assert shared.transform_execution_count == 1


def test_inherited_plus_override_executions() -> None:
    contexts = [_make_route(i + 1, _stream_transform()) for i in range(8)]
    contexts.extend([_make_route(9, _route_override(9)), _make_route(10, _route_override(10))])
    shared = _shared_batch(batch_id="mixed")
    transform_n, map_n, enrich_n = _count_transform_executions(contexts, shared)
    # 1 shared global + 2 distinct route overrides
    assert transform_n == 3
    assert map_n == 3
    assert enrich_n == 3
    assert shared.transform_execution_count == 3


def test_no_global_transform_when_config_absent() -> None:
    contexts = [_make_route(i + 1, None) for i in range(5)]
    shared = _shared_batch(batch_id="none")
    transform_n, map_n, enrich_n = _count_transform_executions(contexts, shared)
    assert transform_n == 0
    assert map_n == 0
    assert enrich_n == 0
    assert shared.transform_execution_count == 0


def test_route_mutation_isolation_with_shared_global_transform() -> None:
    shared = _shared_batch()
    route_a = _make_route(1, _stream_transform())
    route_b = _make_route(2, _stream_transform())

    result_a = process_route_pipeline(route_a, shared)
    # Mutate route A payload after transform/protection boundary.
    assert result_a.events
    result_a.events[0]["route"] = "A"
    result_a.events[0]["common"] = "mutated-by-A"

    result_b = process_route_pipeline(route_b, shared)
    assert result_b.events
    assert result_b.events[0].get("route") != "A"
    assert result_b.events[0].get("common") == "value"
    assert result_b.events[0].get("product") == "GDC"
    assert result_a.events[0].get("product") == "GDC"
    assert shared.transform_execution_count == 1


def test_multi_batch_does_not_reuse_across_batches() -> None:
    contexts = [_make_route(1, _stream_transform()), _make_route(2, _stream_transform())]
    batch1 = _shared_batch(batch_id="b1", events=[{"message": "one", "vendor": "a"}])
    batch2 = _shared_batch(batch_id="b2", events=[{"message": "two", "vendor": "b"}])

    t1, m1, e1 = _count_transform_executions(contexts, batch1)
    t2, m2, e2 = _count_transform_executions(contexts, batch2)
    assert (t1, m1, e1) == (1, 1, 1)
    assert (t2, m2, e2) == (1, 1, 1)
    assert batch1.transform_execution_count == 1
    assert batch2.transform_execution_count == 1


def test_transform_failure_semantics_unchanged() -> None:
    bad = _stream_transform(field_mappings={"x": "$.[invalid"})
    contexts = [_make_route(1, bad), _make_route(2, bad)]
    shared = _shared_batch()
    with pytest.raises(MappingError):
        process_routes(contexts, shared)
    # Failure happens on first execution; no successful cache entry.
    assert shared.transform_execution_count == 0
    assert shared.transform_result_cache == {}


def test_performance_scaling_inherited_routes_faster_than_linear() -> None:
    """Representative CPU-ish enrichment; 100 inherited routes must stay near 1x transform cost."""

    heavy = _stream_transform(
        enrichment={
            "product": "GDC",
            **{f"field_{i}": f"value_{i}" for i in range(40)},
        }
    )
    events = [{"message": f"m{i}", "vendor": "acme", "idx": i} for i in range(25)]

    def _run(n_routes: int) -> tuple[float, int]:
        contexts = [_make_route(i + 1, heavy) for i in range(n_routes)]
        shared = _shared_batch(batch_id=f"perf-{n_routes}", events=[dict(e) for e in events])
        started = time.perf_counter()
        with patch.object(
            route_stage, "apply_mappings_with_results", wraps=route_stage.apply_mappings_with_results
        ) as map_mock:
            process_routes(contexts, shared)
            elapsed = time.perf_counter() - started
            return elapsed, map_mock.call_count

    # Warm once to avoid import/path noise dominating the sample.
    _run(1)
    t1, c1 = _run(1)
    t100, c100 = _run(100)
    assert c1 == 1
    assert c100 == 1
    # Transform work is shared; total wall time must not scale with route count.
    assert t100 < max(t1 * 25, 0.5)


def test_route_override_payload_differs_from_inherited() -> None:
    shared = _shared_batch()
    inherited = _make_route(1, _stream_transform())
    override = _make_route(2, _route_override(2))
    result = process_routes([inherited, override], shared)
    assert shared.transform_execution_count == 2
    by_id = {r.route_id: r.events[0] for r in result.stage_results if r.events}
    assert by_id[1].get("product") == "GDC"
    assert "only_message" not in by_id[1]
    assert by_id[2].get("route_tag") == "route-2"
    assert by_id[2].get("only_message") == "hello"
    assert "product" not in by_id[2]


def test_targeted_off_on_parity_inherited_and_override(
    db_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Representative OFF/ON parity for global inherit + one route override."""

    db = db_session
    fixture = _seed_stream_runtime(db, failure_policies=["LOG_AND_CONTINUE", "LOG_AND_CONTINUE"])
    stream_id = fixture["stream_id"]
    route_ids = list(fixture["route_ids"])
    assert len(route_ids) >= 2

    # Route 0 inherits stream mapping/enrichment; route 1 overrides mapping+enrichment.
    db.add(
        RouteMapping(
            route_id=route_ids[1],
            field_mappings_json={"mapped_only": "$.message"},
        )
    )
    db.add(
        RouteEnrichment(
            route_id=route_ids[1],
            enrichment_json={"route_only": "override"},
            override_policy="KEEP_EXISTING",
        )
    )
    db.commit()

    payload = {"items": [{"id": "e1", "message": "hello", "vendor": "acme"}]}

    def _run(*, flag: bool) -> tuple[dict[str, Any], list[dict[str, Any]]]:
        monkeypatch.setattr(settings, "GDC_ROUTE_PROCESSING_ENABLED", flag)
        ctx = load_stream_context(db, stream_id)
        webhook = _FakeWebhookSender()
        runner = _build_runner(poller=_FakePoller(response=payload), webhook_sender=webhook)
        summary = runner.run(ctx, db=db)
        delivered = [dict(call["events"][0]) for call in webhook.calls if call.get("events")]
        return summary, delivered

    summary_off, delivered_off = _run(flag=False)
    summary_on, delivered_on = _run(flag=True)

    assert summary_off.get("outcome") == "completed"
    assert summary_on.get("outcome") == "completed"
    assert summary_off.get("checkpoint_updated") == summary_on.get("checkpoint_updated")
    assert bool(summary_off.get("partial_success")) == bool(summary_on.get("partial_success"))

    # OFF path fans out one stream-transformed payload to all routes.
    # ON path: inherited route matches OFF keys; override route differs by design.
    assert delivered_off
    assert delivered_on
    off_keys = ("event_id", "message", "vendor", "product")
    inherited_on = next(
        ev for ev in delivered_on if "mapped_only" not in ev and "route_only" not in ev
    )
    for key in off_keys:
        assert inherited_on.get(key) == delivered_off[0].get(key)

    override_on = next(ev for ev in delivered_on if "mapped_only" in ev or "route_only" in ev)
    assert override_on.get("mapped_only") == "hello"
    assert override_on.get("route_only") == "override"


def test_log_and_continue_partial_delivery_with_shared_transform(
    db_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "GDC_ROUTE_PROCESSING_ENABLED", True)
    db = db_session
    fixture = _seed_stream_runtime(db, failure_policies=["LOG_AND_CONTINUE", "LOG_AND_CONTINUE"])
    stream_id = fixture["stream_id"]
    ctx = load_stream_context(db, stream_id)
    payload = {"items": [{"id": "e1", "message": "hello", "vendor": "acme"}]}

    webhook = _FakeWebhookSender(fail_urls={"https://receiver-0.example.com/events"})
    runner = _build_runner(poller=_FakePoller(response=payload), webhook_sender=webhook)
    summary = runner.run(ctx, db=db)

    # One route fails, one succeeds under LOG_AND_CONTINUE → checkpoint may still advance.
    assert summary.get("partial_success") is True or summary.get("outcome") == "completed"
    assert summary.get("checkpoint_updated") is True
    assert len(webhook.calls) == 2
