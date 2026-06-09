"""Unit tests for ai_streams service (M21.3)."""

from __future__ import annotations

import pytest
from sqlalchemy.orm import Session

from app.ai_providers.models import AiProvider
from app.ai_streams.models import AiStream
from app.ai_streams.schemas import AiStreamCreate, AiStreamUpdate
from app.ai_streams.service import create_ai_stream, get_ai_stream_by_slug, update_ai_stream
from app.connectors.models import Connector
from app.sources.models import Source
from app.streams.models import Stream


def _seed_stream(db: Session) -> int:
    connector = Connector(name="ai-unit-connector", description="", status="RUNNING")
    db.add(connector)
    db.flush()
    source = Source(
        connector_id=connector.id,
        source_type="AI_PROXY_RECEIVER",
        config_json={},
        auth_json={},
        enabled=True,
    )
    db.add(source)
    db.flush()
    stream = Stream(
        connector_id=connector.id,
        source_id=source.id,
        name="unit-ai-stream",
        stream_type="AI_PROXY_RECEIVER",
        config_json={},
        polling_interval=60,
        enabled=True,
        status="RUNNING",
        rate_limit_json={},
    )
    db.add(stream)
    db.flush()
    return int(stream.id)


def _seed_provider(db: Session) -> int:
    provider = AiProvider(
        name="unit-provider",
        provider_type="MOCK",
        enabled=True,
        endpoint_url="mock://local",
        auth_json={},
        default_model="mock-model",
        timeout_seconds=120,
    )
    db.add(provider)
    db.flush()
    return int(provider.id)


def test_create_ai_stream_success(db_session: Session) -> None:
    stream_id = _seed_stream(db_session)
    provider_id = _seed_provider(db_session)
    row = create_ai_stream(
        db_session,
        AiStreamCreate(
            stream_id=stream_id,
            provider_id=provider_id,
            slug="prod-chat-east",
            model="mock-model",
        ),
    )
    db_session.commit()
    assert row.slug == "prod-chat-east"
    assert int(row.stream_id) == stream_id


def test_slug_uniqueness_rejected(db_session: Session) -> None:
    stream_id = _seed_stream(db_session)
    provider_id = _seed_provider(db_session)
    create_ai_stream(
        db_session,
        AiStreamCreate(
            stream_id=stream_id,
            provider_id=provider_id,
            slug="duplicate-slug",
            model="mock-model",
        ),
    )
    db_session.flush()

    other_stream_id = _seed_stream(db_session)
    with pytest.raises(ValueError, match="slug already exists"):
        create_ai_stream(
            db_session,
            AiStreamCreate(
                stream_id=other_stream_id,
                provider_id=provider_id,
                slug="duplicate-slug",
                model="mock-model",
            ),
        )


def test_stream_id_uniqueness_rejected(db_session: Session) -> None:
    stream_id = _seed_stream(db_session)
    provider_id = _seed_provider(db_session)
    create_ai_stream(
        db_session,
        AiStreamCreate(
            stream_id=stream_id,
            provider_id=provider_id,
            slug="first-slug",
            model="mock-model",
        ),
    )
    db_session.flush()
    with pytest.raises(ValueError, match="ai_stream already exists"):
        create_ai_stream(
            db_session,
            AiStreamCreate(
                stream_id=stream_id,
                provider_id=provider_id,
                slug="second-slug",
                model="mock-model",
            ),
        )


def test_update_disabled_flag(db_session: Session) -> None:
    stream_id = _seed_stream(db_session)
    provider_id = _seed_provider(db_session)
    row = create_ai_stream(
        db_session,
        AiStreamCreate(
            stream_id=stream_id,
            provider_id=provider_id,
            slug="toggle-slug",
            model="mock-model",
            enabled=True,
        ),
    )
    db_session.commit()
    update_ai_stream(db_session, row, AiStreamUpdate(enabled=False))
    db_session.commit()
    refreshed = get_ai_stream_by_slug(db_session, "toggle-slug")
    assert refreshed is not None
    assert refreshed.enabled is False
