"""Durable Delivery Queue Phase 1 — DB foundation (model, migration, claim/lease)."""

from __future__ import annotations

import threading
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, sessionmaker

from app.checkpoints.models import Checkpoint
from app.checkpoints.service import CheckpointService
from app.connectors.models import Connector
from app.delivery_queue.models import (
    DELIVERY_KIND_BASE_ROUTE,
    QUEUE_STATUS_DELIVERED,
    QUEUE_STATUS_EXHAUSTED,
    QUEUE_STATUS_IN_FLIGHT,
    QUEUE_STATUS_PENDING,
    QUEUE_STATUS_RETRY_WAIT,
    StreamDeliveryQueueItem,
)
from app.delivery_queue.payload import QueuePayloadSecretError
from app.delivery_queue.repository import (
    QueueItemStateError,
    claim_next,
    enqueue,
    get_queue_item,
    list_claimable_items,
    mark_delivered,
    mark_exhausted,
    mark_retry_wait,
)
from app.destinations.models import Destination
from app.enrichments.models import Enrichment
from app.mappings.models import Mapping
from app.routes.models import Route
from app.sources.models import Source
from app.streams.models import Stream


def _seed_stream_route(db: Session) -> dict[str, int]:
    suffix = uuid.uuid4().hex[:10]
    connector = Connector(name=f"dq-conn-{suffix}", description=None, status="RUNNING")
    db.add(connector)
    db.flush()
    source = Source(
        connector_id=connector.id,
        source_type="HTTP_API_POLLING",
        config_json={"base_url": "https://api.example.com"},
        auth_json={"bearer_token": "source-secret-token"},
        enabled=True,
    )
    db.add(source)
    db.flush()
    stream = Stream(
        connector_id=connector.id,
        source_id=source.id,
        name=f"dq-stream-{suffix}",
        stream_type="HTTP_API_POLLING",
        config_json={"endpoint": "/events"},
        polling_interval=60,
        enabled=True,
        status="RUNNING",
        rate_limit_json={},
    )
    db.add(stream)
    db.flush()
    db.add(
        Mapping(
            stream_id=stream.id,
            event_array_path="$.items",
            field_mappings_json={"event_id": "$.id"},
            raw_payload_mode="JSON",
        )
    )
    db.add(
        Enrichment(
            stream_id=stream.id,
            enrichment_json={"vendor": "Acme"},
            override_policy="KEEP_EXISTING",
            enabled=True,
        )
    )
    destination = Destination(
        name=f"dq-dest-{suffix}",
        destination_type="WEBHOOK_POST",
        config_json={"url": "https://receiver.example.com/events", "bearer_token": "dest-secret"},
        rate_limit_json={},
        enabled=True,
    )
    db.add(destination)
    db.flush()
    route = Route(
        stream_id=stream.id,
        destination_id=destination.id,
        enabled=True,
        failure_policy="LOG_AND_CONTINUE",
        formatter_config_json={},
        rate_limit_json={},
        status="ENABLED",
    )
    db.add(route)
    db.add(
        Checkpoint(
            stream_id=stream.id,
            checkpoint_type="EVENT_ID",
            checkpoint_value_json={"last_success_event": {"event_id": "seed-0"}},
        )
    )
    db.commit()
    return {
        "stream_id": int(stream.id),
        "route_id": int(route.id),
        "destination_id": int(destination.id),
    }


def _enqueue_default(db: Session, seeded: dict[str, int], **kwargs: Any) -> StreamDeliveryQueueItem:
    batch_id = str(kwargs.pop("batch_id", uuid.uuid4()))
    payload = kwargs.pop("payload", [{"event_id": "e1", "message": "hello"}])
    row = enqueue(
        db,
        stream_id=seeded["stream_id"],
        route_id=seeded["route_id"],
        destination_id=seeded["destination_id"],
        batch_id=batch_id,
        delivery_kind=DELIVERY_KIND_BASE_ROUTE,
        payload=payload,
        **kwargs,
    )
    db.commit()
    return row


def test_enqueue_and_persists_after_session_end(db_session: Session, db_engine: Engine) -> None:
    seeded = _seed_stream_route(db_session)
    batch_id = str(uuid.uuid4())
    row = _enqueue_default(db_session, seeded, batch_id=batch_id)
    item_id = int(row.id)
    db_session.close()

    SessionLocal = sessionmaker(bind=db_engine, expire_on_commit=False)
    with SessionLocal() as fresh:
        loaded = get_queue_item(fresh, item_id)
        assert loaded is not None
        assert loaded.status == QUEUE_STATUS_PENDING
        assert loaded.batch_id == batch_id
        assert loaded.stream_id == seeded["stream_id"]
        assert loaded.route_id == seeded["route_id"]
        assert loaded.destination_id == seeded["destination_id"]
        assert loaded.payload_json["events"][0]["event_id"] == "e1"
        assert loaded.attempt_count == 0


def test_claim_pending_to_in_flight(db_session: Session) -> None:
    seeded = _seed_stream_route(db_session)
    row = _enqueue_default(db_session, seeded)
    claimed = claim_next(db_session, lease_owner="worker-a")
    db_session.commit()
    assert claimed is not None
    assert claimed.id == row.id
    assert claimed.status == QUEUE_STATUS_IN_FLIGHT
    assert claimed.attempt_count == 1
    assert claimed.lease_owner == "worker-a"
    assert claimed.lease_expires_at is not None


def test_concurrent_double_claim_prevented(db_session: Session, db_engine: Engine) -> None:
    seeded = _seed_stream_route(db_session)
    row = _enqueue_default(db_session, seeded)
    item_id = int(row.id)
    SessionLocal = sessionmaker(bind=db_engine, expire_on_commit=False)
    barrier = threading.Barrier(2)
    results: list[int | None] = []
    errors: list[BaseException] = []
    lock = threading.Lock()

    def _worker(owner: str) -> None:
        session = SessionLocal()
        try:
            barrier.wait(timeout=5)
            claimed = claim_next(session, lease_owner=owner)
            session.commit()
            with lock:
                results.append(int(claimed.id) if claimed is not None else None)
        except BaseException as exc:
            session.rollback()
            with lock:
                errors.append(exc)
        finally:
            session.close()

    with ThreadPoolExecutor(max_workers=2) as pool:
        futs = [pool.submit(_worker, "w1"), pool.submit(_worker, "w2")]
        for fut in as_completed(futs):
            fut.result()

    assert not errors
    claimed_ids = [r for r in results if r is not None]
    assert claimed_ids.count(item_id) == 1
    assert results.count(None) == 1

    db_session.expire_all()
    refreshed = get_queue_item(db_session, item_id)
    assert refreshed is not None
    assert refreshed.status == QUEUE_STATUS_IN_FLIGHT
    assert refreshed.attempt_count == 1


def test_retry_wait_available_at_gating(db_session: Session) -> None:
    seeded = _seed_stream_route(db_session)
    future = datetime.now(timezone.utc) + timedelta(hours=1)
    row = _enqueue_default(db_session, seeded)
    claimed = claim_next(db_session, lease_owner="w")
    assert claimed is not None
    mark_retry_wait(db_session, int(claimed.id), available_at=future, last_error="temp fail")
    db_session.commit()

    assert list_claimable_items(db_session, stream_id=seeded["stream_id"]) == []
    assert claim_next(db_session, lease_owner="w2") is None

    past = datetime.now(timezone.utc) - timedelta(seconds=1)
    item = get_queue_item(db_session, int(row.id))
    assert item is not None
    item.available_at = past
    db_session.commit()

    reclaimed = claim_next(db_session, lease_owner="w3")
    db_session.commit()
    assert reclaimed is not None
    assert reclaimed.id == row.id
    assert reclaimed.status == QUEUE_STATUS_IN_FLIGHT
    assert reclaimed.attempt_count == 2


def test_in_flight_to_delivered(db_session: Session) -> None:
    seeded = _seed_stream_route(db_session)
    _enqueue_default(db_session, seeded)
    claimed = claim_next(db_session, lease_owner="w")
    assert claimed is not None
    done = mark_delivered(db_session, int(claimed.id))
    db_session.commit()
    assert done.status == QUEUE_STATUS_DELIVERED
    assert done.delivered_at is not None
    assert done.lease_owner is None


def test_in_flight_to_retry_wait(db_session: Session) -> None:
    seeded = _seed_stream_route(db_session)
    _enqueue_default(db_session, seeded)
    claimed = claim_next(db_session, lease_owner="w")
    assert claimed is not None
    available_at = datetime.now(timezone.utc) + timedelta(minutes=5)
    row = mark_retry_wait(
        db_session, int(claimed.id), available_at=available_at, last_error="502"
    )
    db_session.commit()
    assert row.status == QUEUE_STATUS_RETRY_WAIT
    assert row.last_error == "502"


def test_in_flight_to_exhausted(db_session: Session) -> None:
    seeded = _seed_stream_route(db_session)
    _enqueue_default(db_session, seeded)
    claimed = claim_next(db_session, lease_owner="w")
    assert claimed is not None
    row = mark_exhausted(db_session, int(claimed.id), last_error="max attempts")
    db_session.commit()
    assert row.status == QUEUE_STATUS_EXHAUSTED
    assert row.last_error == "max attempts"


def test_invalid_state_transition_rejected(db_session: Session) -> None:
    seeded = _seed_stream_route(db_session)
    row = _enqueue_default(db_session, seeded)
    with pytest.raises(QueueItemStateError):
        mark_delivered(db_session, int(row.id))
    db_session.rollback()

    claimed = claim_next(db_session, lease_owner="w")
    assert claimed is not None
    mark_delivered(db_session, int(claimed.id))
    db_session.commit()
    with pytest.raises(QueueItemStateError):
        mark_retry_wait(
            db_session,
            int(claimed.id),
            available_at=datetime.now(timezone.utc),
        )


def test_delivered_item_cannot_be_reclaimed(db_session: Session) -> None:
    seeded = _seed_stream_route(db_session)
    _enqueue_default(db_session, seeded)
    claimed = claim_next(db_session, lease_owner="w")
    assert claimed is not None
    mark_delivered(db_session, int(claimed.id))
    db_session.commit()

    assert claim_next(db_session, lease_owner="w2") is None
    assert list_claimable_items(db_session, stream_id=seeded["stream_id"]) == []


def test_correlation_fields_persisted(db_session: Session) -> None:
    seeded = _seed_stream_route(db_session)
    batch_id = str(uuid.uuid4())
    row = _enqueue_default(db_session, seeded, batch_id=batch_id)
    claimed = claim_next(db_session, lease_owner="corr-worker")
    db_session.commit()
    assert claimed is not None
    assert claimed.batch_id == batch_id  # run_id correlator per audit design
    assert claimed.stream_id == seeded["stream_id"]
    assert claimed.route_id == seeded["route_id"]
    assert claimed.destination_id == seeded["destination_id"]
    assert claimed.attempt_count == 1
    assert row.id == claimed.id


def test_secret_leak_rejected_on_enqueue(db_session: Session) -> None:
    seeded = _seed_stream_route(db_session)
    with pytest.raises(QueuePayloadSecretError):
        enqueue(
            db_session,
            stream_id=seeded["stream_id"],
            route_id=seeded["route_id"],
            destination_id=seeded["destination_id"],
            batch_id=str(uuid.uuid4()),
            delivery_kind=DELIVERY_KIND_BASE_ROUTE,
            payload=[{"event_id": "e1", "bearer_token": "should-not-store"}],
        )
    db_session.rollback()

    with pytest.raises(QueuePayloadSecretError):
        enqueue(
            db_session,
            stream_id=seeded["stream_id"],
            route_id=seeded["route_id"],
            destination_id=seeded["destination_id"],
            batch_id=str(uuid.uuid4()),
            delivery_kind=DELIVERY_KIND_BASE_ROUTE,
            payload={"events": [{"event_id": "e1"}], "api_key": "leak"},
        )
    db_session.rollback()

    # Destination auth must not be copied into queue payload either.
    ok = enqueue(
        db_session,
        stream_id=seeded["stream_id"],
        route_id=seeded["route_id"],
        destination_id=seeded["destination_id"],
        batch_id=str(uuid.uuid4()),
        delivery_kind=DELIVERY_KIND_BASE_ROUTE,
        payload=[{"event_id": "e1", "message": "safe"}],
    )
    db_session.commit()
    stored = get_queue_item(db_session, int(ok.id))
    assert stored is not None
    blob = str(stored.payload_json)
    assert "dest-secret" not in blob
    assert "source-secret-token" not in blob
    assert "bearer_token" not in blob


def test_destination_delete_restricted_while_queue_item_exists(db_session: Session) -> None:
    seeded = _seed_stream_route(db_session)
    _enqueue_default(db_session, seeded)
    dest = db_session.get(Destination, seeded["destination_id"])
    assert dest is not None
    db_session.delete(dest)
    with pytest.raises(IntegrityError):
        db_session.commit()
    db_session.rollback()


def test_route_delete_restricted_while_queue_item_exists(db_session: Session) -> None:
    seeded = _seed_stream_route(db_session)
    _enqueue_default(db_session, seeded)
    route = db_session.get(Route, seeded["route_id"])
    assert route is not None
    db_session.delete(route)
    with pytest.raises(IntegrityError):
        db_session.commit()
    db_session.rollback()


def test_stream_delete_clears_queue_items_via_lifecycle(db_session: Session) -> None:
    """Stream delete scope removes queue rows before route RESTRICT would block."""

    from app.streams.delete_scope import delete_stream_and_dependencies

    seeded = _seed_stream_route(db_session)
    row = _enqueue_default(db_session, seeded)
    item_id = int(row.id)
    delete_stream_and_dependencies(db_session, seeded["stream_id"])
    db_session.expire_all()
    assert get_queue_item(db_session, item_id) is None
    assert db_session.get(Stream, seeded["stream_id"]) is None
    # Destination entity is preserved (project lifecycle); RESTRICT still applies while items exist.
    assert db_session.get(Destination, seeded["destination_id"]) is not None


def test_queue_stream_fk_is_cascade(db_engine: Engine, reset_db: None) -> None:
    with db_engine.connect() as conn:
        rule = conn.execute(
            text(
                """
                SELECT rc.delete_rule
                FROM information_schema.referential_constraints rc
                JOIN information_schema.key_column_usage kcu
                  ON rc.constraint_name = kcu.constraint_name
                 AND rc.constraint_schema = kcu.constraint_schema
                WHERE kcu.table_name = 'stream_delivery_queue_items'
                  AND kcu.column_name = 'stream_id'
                """
            )
        ).scalar()
    assert rule == "CASCADE"


def test_checkpoint_unaffected_by_queue_enqueue(db_session: Session) -> None:
    seeded = _seed_stream_route(db_session)
    svc = CheckpointService()
    before = svc.get_checkpoint(db_session, seeded["stream_id"])
    assert before is not None
    _enqueue_default(db_session, seeded)
    after = svc.get_checkpoint(db_session, seeded["stream_id"])
    assert after == before

    updated = svc.update_checkpoint_after_success(
        db_session,
        seeded["stream_id"],
        "EVENT_ID",
        {"last_success_event": {"event_id": "after-queue"}},
    )
    db_session.commit()
    assert updated["last_success_event"]["event_id"] == "after-queue"
    # Queue item still pending — checkpoint advance remains independent of enqueue.
    items = list_claimable_items(db_session, stream_id=seeded["stream_id"])
    assert len(items) == 1
    assert items[0].status == QUEUE_STATUS_PENDING


def test_migration_upgrade_creates_queue_table(
    reset_db_schema: None,
    test_db_url: str,
    db_engine: Engine,
    project_root: Path,
) -> None:
    cfg = Config(str(project_root / "alembic.ini"))
    cfg.set_main_option("script_location", str(project_root / "alembic"))
    cfg.set_main_option("sqlalchemy.url", test_db_url)
    command.upgrade(cfg, "head")

    inspector = inspect(db_engine)
    assert "stream_delivery_queue_items" in set(inspector.get_table_names())
    cols = {c["name"] for c in inspector.get_columns("stream_delivery_queue_items")}
    expected = {
        "id",
        "stream_id",
        "route_id",
        "destination_id",
        "batch_id",
        "delivery_kind",
        "payload_json",
        "status",
        "attempt_count",
        "available_at",
        "lease_owner",
        "lease_expires_at",
        "created_at",
        "updated_at",
        "delivered_at",
        "last_error",
    }
    assert expected.issubset(cols)

    # Downgrade one revision then re-upgrade (project supports downgrade).
    command.downgrade(cfg, "20260823_0064_credentials")
    inspector = inspect(db_engine)
    assert "stream_delivery_queue_items" not in set(inspector.get_table_names())
    assert "credentials" in set(inspector.get_table_names())
    command.upgrade(cfg, "head")
    inspector = inspect(db_engine)
    assert "stream_delivery_queue_items" in set(inspector.get_table_names())


def test_existing_core_tables_untouched_by_queue_migration(
    reset_db: None,
    db_engine: Engine,
) -> None:
    with db_engine.connect() as conn:
        for table in ("streams", "routes", "destinations", "checkpoints", "stream_replay_events"):
            exists = conn.execute(
                text(
                    "SELECT 1 FROM information_schema.tables "
                    "WHERE table_schema='public' AND table_name=:t"
                ),
                {"t": table},
            ).scalar()
            assert exists == 1
