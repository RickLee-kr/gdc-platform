"""Shared test helpers for AI policy tests."""

from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from app.ai_providers.models import AiProvider
from app.ai_streams.models import AiStream


def seed_ai_stream_for_policy(db: Session, *, slug: str) -> dict[str, Any]:
    from app.checkpoints.models import Checkpoint
    from app.connectors.models import Connector
    from app.sources.models import Source
    from app.streams.models import Stream

    provider = AiProvider(
        name=f"policy-{slug}",
        provider_type="MOCK",
        enabled=True,
        endpoint_url="mock://local",
        auth_json={},
        default_model="mock-model",
        timeout_seconds=120,
    )
    connector = Connector(name=f"policy-conn-{slug}", description="", status="RUNNING")
    db.add_all([provider, connector])
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
        name=f"policy-stream-{slug}",
        stream_type="AI_PROXY_RECEIVER",
        config_json={},
        polling_interval=60,
        enabled=True,
        status="RUNNING",
        rate_limit_json={"max_requests": 100, "per_seconds": 60},
    )
    db.add(stream)
    db.flush()

    ai_stream = AiStream(
        stream_id=int(stream.id),
        provider_id=int(provider.id),
        slug=slug,
        model="mock-model",
        enabled=True,
    )
    db.add(ai_stream)
    db.add(
        Checkpoint(
            stream_id=int(stream.id),
            checkpoint_type="AI_PROXY_PUSH",
            checkpoint_value_json={"last_request_id": None},
        )
    )
    db.commit()
    return {
        "stream_id": int(stream.id),
        "ai_stream_id": int(ai_stream.id),
        "provider_id": int(provider.id),
        "slug": slug,
    }
