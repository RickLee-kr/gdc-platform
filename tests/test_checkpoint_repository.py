from __future__ import annotations

from sqlalchemy.orm import Session

from app.checkpoints import repository as repo
from app.checkpoints.models import Checkpoint
from app.connectors.models import Connector
from app.sources.models import Source
from app.streams.models import Stream


def _seed_stream(db: Session) -> Stream:
    connector = Connector(name="c1", description=None, status="RUNNING")
    db.add(connector)
    db.flush()
    source = Source(connector_id=connector.id, source_type="HTTP_API_POLLING", config_json={}, auth_json={}, enabled=True)
    db.add(source)
    db.flush()
    stream = Stream(
        connector_id=connector.id,
        source_id=source.id,
        name="s1",
        stream_type="HTTP_API_POLLING",
        config_json={},
        polling_interval=60,
        enabled=True,
        status="RUNNING",
        rate_limit_json={},
    )
    db.add(stream)
    db.commit()
    db.refresh(stream)
    return stream


def test_get_checkpoint_by_stream_id(db_session: Session) -> None:
    stream = _seed_stream(db_session)
    db_session.add(Checkpoint(stream_id=stream.id, checkpoint_type="CUSTOM_FIELD", checkpoint_value_json={"x": 1}))
    db_session.commit()

    found = repo.get_checkpoint_by_stream_id(db_session, stream.id)
    assert found is not None
    assert found.stream_id == stream.id
    assert found.checkpoint_value_json == {"x": 1}


def test_upsert_checkpoint_updates_existing(db_session: Session) -> None:
    stream = _seed_stream(db_session)
    db_session.add(Checkpoint(stream_id=stream.id, checkpoint_type="CUSTOM_FIELD", checkpoint_value_json={"x": 1}))
    db_session.commit()

    row = repo.upsert_checkpoint(db_session, stream.id, "CUSTOM_FIELD", {"x": 2})
    assert row.checkpoint_value_json == {"x": 2}


def test_upsert_checkpoint_inserts_when_missing(db_session: Session) -> None:
    stream = _seed_stream(db_session)
    row = repo.upsert_checkpoint(db_session, stream.id, "CUSTOM_FIELD", {"k": "v"})
    assert row.stream_id == stream.id
    assert row.checkpoint_value_json == {"k": "v"}
