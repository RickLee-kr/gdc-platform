"""Connected Credential foundation: CRUD, masking, Source link, runtime resolution."""

from __future__ import annotations

from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.checkpoints.models import Checkpoint
from app.connectors.models import Connector
from app.credentials.models import Credential
from app.credentials.resolution import CredentialAuthResolutionError, resolve_source_auth_json
from app.database import get_db, get_db_read_bounded
from app.destinations.models import Destination
from app.enrichments.models import Enrichment
from app.main import app
from app.mappings.models import Mapping
from app.routes.models import Route
from app.runners.stream_loader import load_stream_context
from app.security.secrets import SECRET_MASK
from app.sources.models import Source
from app.streams.models import Stream


@pytest.fixture
def client(db_session: Session) -> TestClient:
    def _override_db() -> Any:
        yield db_session

    app.dependency_overrides[get_db] = _override_db
    app.dependency_overrides[get_db_read_bounded] = _override_db
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_db, None)
        app.dependency_overrides.pop(get_db_read_bounded, None)


def _connector(db: Session, name: str = "cred-conn") -> Connector:
    row = Connector(name=name, description=None, status="STOPPED")
    db.add(row)
    db.flush()
    return row


def _stream_bundle(
    db: Session,
    *,
    source: Source,
    stream_name: str = "alerts",
) -> Stream:
    stream = Stream(
        connector_id=int(source.connector_id),
        source_id=int(source.id),
        name=stream_name,
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
    dst = Destination(
        name=f"dest-{stream_name}",
        destination_type="WEBHOOK_POST",
        config_json={"url": "https://dest.example"},
        rate_limit_json={},
        enabled=True,
    )
    db.add(dst)
    db.flush()
    db.add(
        Route(
            stream_id=stream.id,
            destination_id=dst.id,
            enabled=True,
            failure_policy="LOG_AND_CONTINUE",
            formatter_config_json={},
            rate_limit_json={},
            status="ENABLED",
        )
    )
    db.add(
        Checkpoint(
            stream_id=stream.id,
            checkpoint_type="EVENT_ID",
            checkpoint_value_json={"last_id": "1"},
        )
    )
    db.commit()
    return stream


def test_credential_create_and_mask_secrets(client: TestClient, db_session: Session) -> None:
    connector = _connector(db_session)
    db_session.commit()

    res = client.post(
        "/api/v1/credentials/",
        json={
            "connector_id": connector.id,
            "name": "prod-bearer",
            "auth_type": "BEARER",
            "auth_json": {"auth_type": "bearer", "bearer_token": "super-secret-token"},
            "status": "CONNECTED",
        },
    )
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["name"] == "prod-bearer"
    assert body["auth_type"] == "BEARER"
    assert body["status"] == "CONNECTED"
    assert body["auth_json"]["bearer_token"] == SECRET_MASK
    assert "super-secret-token" not in res.text

    row = db_session.query(Credential).filter(Credential.id == body["id"]).one()
    from app.security.auth_json_crypto import auth_json_for_runtime
    from app.security.encryption import is_encrypted_envelope

    assert is_encrypted_envelope(row.auth_json["bearer_token"])
    assert "super-secret-token" not in str(row.auth_json)
    assert auth_json_for_runtime(row.auth_json)["bearer_token"] == "super-secret-token"

    detail = client.get(f"/api/v1/credentials/{body['id']}")
    assert detail.status_code == 200
    assert detail.json()["auth_json"]["bearer_token"] == SECRET_MASK
    assert "super-secret-token" not in detail.text


def test_source_credential_id_reference_and_reuse(client: TestClient, db_session: Session) -> None:
    connector = _connector(db_session)
    db_session.commit()

    cred = client.post(
        "/api/v1/credentials/",
        json={
            "connector_id": connector.id,
            "name": "shared",
            "auth_type": "API_KEY",
            "auth_json": {
                "auth_type": "api_key",
                "api_key_name": "X-Api-Key",
                "api_key_value": "key-secret",
                "api_key_location": "headers",
            },
        },
    ).json()

    s1 = client.post(
        "/api/v1/sources/",
        json={
            "connector_id": connector.id,
            "source_type": "HTTP_API_POLLING",
            "config_json": {"base_url": "https://a.example"},
            "auth_json": {},
            "credential_id": cred["id"],
        },
    )
    s2 = client.post(
        "/api/v1/sources/",
        json={
            "connector_id": connector.id,
            "source_type": "HTTP_API_POLLING",
            "config_json": {"base_url": "https://b.example"},
            "auth_json": {},
            "credential_id": cred["id"],
        },
    )
    assert s1.status_code == 201, s1.text
    assert s2.status_code == 201, s2.text
    assert s1.json()["credential_id"] == cred["id"]
    assert s2.json()["credential_id"] == cred["id"]

    conflict = client.delete(f"/api/v1/credentials/{cred['id']}")
    assert conflict.status_code == 409
    assert conflict.json()["detail"]["error_code"] == "CREDENTIAL_IN_USE"


def test_invalid_credential_id_on_source(client: TestClient, db_session: Session) -> None:
    connector = _connector(db_session)
    other = _connector(db_session, name="other")
    db_session.commit()
    cred = client.post(
        "/api/v1/credentials/",
        json={
            "connector_id": other.id,
            "name": "other-cred",
            "auth_type": "BEARER",
            "auth_json": {"auth_type": "bearer", "bearer_token": "x"},
        },
    ).json()

    missing = client.post(
        "/api/v1/sources/",
        json={
            "connector_id": connector.id,
            "source_type": "HTTP_API_POLLING",
            "config_json": {},
            "credential_id": 999999,
        },
    )
    assert missing.status_code == 404

    mismatch = client.post(
        "/api/v1/sources/",
        json={
            "connector_id": connector.id,
            "source_type": "HTTP_API_POLLING",
            "config_json": {},
            "credential_id": cred["id"],
        },
    )
    assert mismatch.status_code == 422
    assert mismatch.json()["detail"]["error_code"] == "INVALID_CREDENTIAL_REF"


def test_runtime_auth_resolution_prefers_credential(db_session: Session) -> None:
    db = db_session
    connector = _connector(db)
    cred = Credential(
        connector_id=connector.id,
        name="rt",
        auth_type="BEARER",
        auth_json={"auth_type": "bearer", "bearer_token": "from-credential"},
        status="CONNECTED",
    )
    db.add(cred)
    db.flush()
    source = Source(
        connector_id=connector.id,
        source_type="HTTP_API_POLLING",
        config_json={"base_url": "https://api.example.com"},
        auth_json={"auth_type": "bearer", "bearer_token": "legacy-should-not-win"},
        credential_id=cred.id,
        enabled=True,
    )
    db.add(source)
    db.flush()
    stream = _stream_bundle(db, source=source)

    ctx = load_stream_context(db, stream.id)
    assert ctx.stream["source_config"]["bearer_token"] == "from-credential"
    assert ctx.stream["source_config"]["base_url"] == "https://api.example.com"


def test_legacy_auth_json_fallback(db_session: Session) -> None:
    db = db_session
    connector = _connector(db)
    source = Source(
        connector_id=connector.id,
        source_type="HTTP_API_POLLING",
        config_json={"base_url": "https://legacy.example.com"},
        auth_json={"auth_type": "basic", "basic_username": "u", "basic_password": "legacy-pass"},
        credential_id=None,
        enabled=True,
    )
    db.add(source)
    db.flush()
    stream = _stream_bundle(db, source=source, stream_name="legacy")

    assert resolve_source_auth_json(db, source)["basic_password"] == "legacy-pass"
    ctx = load_stream_context(db, stream.id)
    assert ctx.stream["source_config"]["basic_password"] == "legacy-pass"


def test_revoked_and_missing_credential_status(db_session: Session) -> None:
    db = db_session
    connector = _connector(db)
    cred = Credential(
        connector_id=connector.id,
        name="revoked",
        auth_type="BEARER",
        auth_json={"auth_type": "bearer", "bearer_token": "t"},
        status="REVOKED",
    )
    db.add(cred)
    db.flush()
    source = Source(
        connector_id=connector.id,
        source_type="HTTP_API_POLLING",
        config_json={"base_url": "https://api.example.com"},
        auth_json={},
        credential_id=cred.id,
        enabled=True,
    )
    db.add(source)
    db.flush()
    stream = _stream_bundle(db, source=source, stream_name="revoked")

    with pytest.raises(CredentialAuthResolutionError, match="REVOKED"):
        resolve_source_auth_json(db, source)
    with pytest.raises(CredentialAuthResolutionError, match="REVOKED"):
        load_stream_context(db, stream.id)

    # DB FK prevents persisting an unknown credential_id; resolution still
    # rejects a dangling reference when encountered at runtime.
    dangling = Source(
        connector_id=connector.id,
        source_type="HTTP_API_POLLING",
        config_json={"base_url": "https://api.example.com"},
        auth_json={},
        credential_id=999999,
        enabled=True,
    )
    with pytest.raises(CredentialAuthResolutionError, match="not found"):
        resolve_source_auth_json(db, dangling)


def test_credential_masked_update_preserves_secret(client: TestClient, db_session: Session) -> None:
    connector = _connector(db_session)
    db_session.commit()
    created = client.post(
        "/api/v1/credentials/",
        json={
            "connector_id": connector.id,
            "name": "mask-upd",
            "auth_type": "BEARER",
            "auth_json": {"auth_type": "bearer", "bearer_token": "keep-me"},
        },
    ).json()
    upd = client.put(
        f"/api/v1/credentials/{created['id']}",
        json={"auth_json": {"auth_type": "bearer", "bearer_token": SECRET_MASK}},
    )
    assert upd.status_code == 200
    assert upd.json()["auth_json"]["bearer_token"] == SECRET_MASK
    row = db_session.query(Credential).filter(Credential.id == created["id"]).one()
    from app.security.auth_json_crypto import auth_json_for_runtime
    from app.security.encryption import is_encrypted_envelope

    assert is_encrypted_envelope(row.auth_json["bearer_token"])
    assert auth_json_for_runtime(row.auth_json)["bearer_token"] == "keep-me"


def test_migration_adds_nullable_credential_id(db_session: Session) -> None:
    """Existing sources remain valid with credential_id NULL after foundation migration."""

    connector = _connector(db_session)
    source = Source(
        connector_id=connector.id,
        source_type="HTTP_API_POLLING",
        config_json={},
        auth_json={"auth_type": "no_auth"},
        enabled=True,
    )
    db_session.add(source)
    db_session.commit()
    db_session.refresh(source)
    assert source.credential_id is None
    assert source.auth_json["auth_type"] == "no_auth"
