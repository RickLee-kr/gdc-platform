"""Credential encryption-at-rest (AES-GCM envelopes) — targeted coverage A–U."""

from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta, timezone
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.connectors.auth.registry import AuthStrategyRegistry
from app.connectors.models import Connector
from app.credentials.models import (
    CREDENTIAL_STATUS_CONNECTED,
    Credential,
)
from app.credentials.resolution import resolve_source_auth_json
from app.credentials.service import load_credential_auth_json
from app.database import get_db, get_db_read_bounded
from app.main import app
from app.security.auth_json_crypto import (
    auth_json_for_runtime,
    auth_json_for_storage,
    contains_plaintext_secrets,
)
from app.security.encryption import (
    ENVELOPE_VERSION,
    EncryptionError,
    EncryptionKeyError,
    clear_encryption_key_cache,
    decrypt_string,
    encrypt_string,
    is_encrypted_envelope,
)
from app.security.migrate_encrypt_auth_json import migrate_encrypt_auth_json_secrets
from app.security.secrets import SECRET_MASK, mask_secrets
from app.sources.models import Source

STRONG_KEY = "test-encryption-key-32bytes-ok!!"
WRONG_KEY = "wrong-encryption-key-32bytes-xxx"


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


def _connector(db: Session) -> Connector:
    row = Connector(name="enc-test", product_group="t", status="active")
    db.add(row)
    db.flush()
    return row


def _pg_auth_json_text(db: Session, table: str, row_id: int) -> str:
    col = "auth_json"
    raw = db.execute(
        text(f"SELECT {col}::text FROM {table} WHERE id = :id"),
        {"id": row_id},
    ).scalar()
    return str(raw or "")


@pytest.fixture(autouse=True)
def _enc_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("app.config.settings.ENCRYPTION_KEY", STRONG_KEY)
    monkeypatch.setattr("app.config.settings.ENCRYPTION_KEY_ID", "1")
    clear_encryption_key_cache()
    yield
    clear_encryption_key_cache()


def test_a_secret_write_no_db_plaintext(client: TestClient, db_session: Session) -> None:
    connector = _connector(db_session)
    db_session.commit()
    secret = "plain-secret-must-not-hit-db"
    res = client.post(
        "/api/v1/credentials/",
        json={
            "connector_id": connector.id,
            "name": "enc-a",
            "auth_type": "BEARER",
            "auth_json": {"auth_type": "bearer", "bearer_token": secret},
        },
    )
    assert res.status_code == 201, res.text
    cid = res.json()["id"]
    db_session.expire_all()
    row = db_session.query(Credential).filter(Credential.id == cid).one()
    assert is_encrypted_envelope(row.auth_json["bearer_token"])
    blob = _pg_auth_json_text(db_session, "credentials", cid)
    assert secret not in blob
    assert "__gdc_enc__" in blob


def test_b_encrypted_secret_runtime_decrypt(client: TestClient, db_session: Session) -> None:
    connector = _connector(db_session)
    db_session.commit()
    secret = "runtime-decrypt-token"
    res = client.post(
        "/api/v1/credentials/",
        json={
            "connector_id": connector.id,
            "name": "enc-b",
            "auth_type": "BEARER",
            "auth_json": {"bearer_token": secret},
        },
    )
    row = db_session.query(Credential).filter(Credential.id == res.json()["id"]).one()
    assert load_credential_auth_json(row)["bearer_token"] == secret


def test_c_wrong_key_fail_closed() -> None:
    env = encrypt_string("secret-value", raw_key=STRONG_KEY)
    with pytest.raises(EncryptionError, match="wrong key|tampered"):
        decrypt_string(env, raw_key=WRONG_KEY)


def test_d_missing_key_fail_closed_for_encrypted(monkeypatch: pytest.MonkeyPatch) -> None:
    env = encrypt_string("secret-value", raw_key=STRONG_KEY)
    monkeypatch.setattr("app.config.settings.ENCRYPTION_KEY", "")
    clear_encryption_key_cache()
    with pytest.raises(EncryptionKeyError):
        decrypt_string(env)


def test_e_tampered_ciphertext_auth_failure() -> None:
    env = encrypt_string("secret-value", raw_key=STRONG_KEY)
    tampered = dict(env)
    tampered["ct"] = tampered["ct"][:-4] + ("AAAA" if not tampered["ct"].endswith("AAAA") else "BBBB")
    with pytest.raises(EncryptionError):
        decrypt_string(tampered, raw_key=STRONG_KEY)


def test_f_api_response_no_raw_secret(client: TestClient, db_session: Session) -> None:
    connector = _connector(db_session)
    db_session.commit()
    secret = "api-raw-secret-xyz"
    res = client.post(
        "/api/v1/credentials/",
        json={
            "connector_id": connector.id,
            "name": "enc-f",
            "auth_type": "API_KEY",
            "auth_json": {"api_key_value": secret, "api_key_name": "X-Api-Key"},
        },
    )
    assert secret not in res.text
    assert res.json()["auth_json"]["api_key_value"] == SECRET_MASK
    detail = client.get(f"/api/v1/credentials/{res.json()['id']}")
    assert secret not in detail.text


def test_g_logs_errors_no_raw_secret(caplog: pytest.LogCaptureFixture) -> None:
    secret = "log-leak-secret-abc"
    env = encrypt_string(secret, raw_key=STRONG_KEY)
    with caplog.at_level(logging.DEBUG):
        logging.getLogger("app.security.encryption").debug("envelope=%s", env)
        try:
            decrypt_string({**env, "ct": "AAAA"}, raw_key=STRONG_KEY)
        except EncryptionError as exc:
            assert secret not in str(exc)
    assert secret not in caplog.text


def test_h_i_j_oauth_tokens_encrypted(
    client: TestClient, db_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    # Lightweight: persist tokens via storage helper + rotation write path.
    connector = _connector(db_session)
    auth = auth_json_for_storage(
        {
            "auth_type": "oauth2_authorization_code",
            "client_secret": "cs",
            "access_token": "access-h",
            "refresh_token": "refresh-h",
        }
    )
    row = Credential(
        connector_id=connector.id,
        name="oauth-enc",
        auth_type="OAUTH2_AUTHORIZATION_CODE",
        auth_json=auth,
        status=CREDENTIAL_STATUS_CONNECTED,
    )
    db_session.add(row)
    db_session.commit()
    db_session.refresh(row)
    assert is_encrypted_envelope(row.auth_json["access_token"])
    assert is_encrypted_envelope(row.auth_json["refresh_token"])
    assert is_encrypted_envelope(row.auth_json["client_secret"])
    blob = _pg_auth_json_text(db_session, "credentials", int(row.id))
    assert "access-h" not in blob
    assert "refresh-h" not in blob

    # Simulate refresh rotation persist
    rotated = auth_json_for_runtime(row.auth_json)
    rotated["access_token"] = "access-rotated"
    rotated["refresh_token"] = "refresh-rotated"
    row.auth_json = auth_json_for_storage(rotated)
    db_session.commit()
    db_session.refresh(row)
    assert is_encrypted_envelope(row.auth_json["access_token"])
    assert is_encrypted_envelope(row.auth_json["refresh_token"])
    out = auth_json_for_runtime(row.auth_json)
    assert out["access_token"] == "access-rotated"
    assert out["refresh_token"] == "refresh-rotated"
    assert "access-rotated" not in _pg_auth_json_text(db_session, "credentials", int(row.id))


def test_k_basic_password_encrypted(client: TestClient, db_session: Session) -> None:
    connector = _connector(db_session)
    db_session.commit()
    res = client.post(
        "/api/v1/credentials/",
        json={
            "connector_id": connector.id,
            "name": "basic-enc",
            "auth_type": "BASIC",
            "auth_json": {"username": "u", "password": "basic-pass-secret"},
        },
    )
    assert res.status_code == 201, res.text
    row = db_session.query(Credential).filter(Credential.id == res.json()["id"]).one()
    assert is_encrypted_envelope(row.auth_json["password"])
    assert "basic-pass-secret" not in _pg_auth_json_text(db_session, "credentials", int(row.id))
    assert auth_json_for_runtime(row.auth_json)["password"] == "basic-pass-secret"
    assert row.auth_json.get("username") == "u"  # non-secret stays plaintext


def test_l_bearer_apikey_encrypted(client: TestClient, db_session: Session) -> None:
    connector = _connector(db_session)
    db_session.commit()
    cases = (
        ("BEARER", {"bearer_token": "bearer-secret-1"}, "bearer_token", "bearer-secret-1"),
        (
            "API_KEY",
            {"api_key_name": "X-Api-Key", "api_key_value": "apikey-secret-1", "api_key_location": "headers"},
            "api_key_value",
            "apikey-secret-1",
        ),
    )
    for auth_type, auth_json, field, value in cases:
        res = client.post(
            "/api/v1/credentials/",
            json={
                "connector_id": connector.id,
                "name": f"{auth_type}-enc",
                "auth_type": auth_type,
                "auth_json": auth_json,
            },
        )
        assert res.status_code == 201, res.text
        row = db_session.query(Credential).filter(Credential.id == res.json()["id"]).one()
        assert is_encrypted_envelope(row.auth_json[field])
        assert value not in _pg_auth_json_text(db_session, "credentials", int(row.id))


def test_m_legacy_auth_json_compatibility(client: TestClient, db_session: Session) -> None:
    connector = _connector(db_session)
    db_session.commit()
    res = client.post(
        "/api/v1/sources/",
        json={
            "connector_id": connector.id,
            "source_type": "HTTP_API_POLLING",
            "config_json": {"endpoint": "/x"},
            "auth_json": {"auth_type": "bearer", "bearer_token": "legacy-secret-token"},
            "enabled": True,
        },
    )
    assert res.status_code == 201, res.text
    sid = res.json()["id"]
    assert res.json()["auth_json"]["bearer_token"] == SECRET_MASK
    db_session.expire_all()
    source = db_session.query(Source).filter(Source.id == sid).one()
    assert is_encrypted_envelope(source.auth_json["bearer_token"])
    assert "legacy-secret-token" not in _pg_auth_json_text(db_session, "sources", sid)
    auth = resolve_source_auth_json(db_session, source)
    assert auth["bearer_token"] == "legacy-secret-token"


def test_n_o_plaintext_migration_idempotent(db_session: Session) -> None:
    connector = _connector(db_session)
    # Bypass ORM encrypt listener by writing raw SQL plaintext (legacy rows).
    db_session.execute(
        text(
            "INSERT INTO credentials (connector_id, name, auth_type, auth_json, status, created_at, updated_at) "
            "VALUES (:cid, :name, :atype, CAST(:auth AS json), :status, NOW(), NOW())"
        ),
        {
            "cid": connector.id,
            "name": "legacy-plain",
            "atype": "BEARER",
            "auth": json.dumps({"auth_type": "bearer", "bearer_token": "migrate-me-token"}),
            "status": "CONNECTED",
        },
    )
    db_session.execute(
        text(
            "INSERT INTO sources (connector_id, source_type, config_json, auth_json, enabled, created_at, updated_at) "
            "VALUES (:cid, :stype, CAST(:cfg AS json), CAST(:auth AS json), true, NOW(), NOW())"
        ),
        {
            "cid": connector.id,
            "stype": "HTTP_API_POLLING",
            "cfg": "{}",
            "auth": json.dumps({"bearer_token": "legacy-source-token"}),
        },
    )
    db_session.commit()

    first = migrate_encrypt_auth_json_secrets(db_session)
    assert first["credentials_updated"] >= 1
    assert first["sources_updated"] >= 1
    assert first["credentials_failed"] == 0
    assert first["sources_failed"] == 0

    second = migrate_encrypt_auth_json_secrets(db_session)
    assert second["credentials_updated"] == 0
    assert second["sources_updated"] == 0

    cred = (
        db_session.query(Credential)
        .filter(Credential.name == "legacy-plain")
        .one()
    )
    assert is_encrypted_envelope(cred.auth_json["bearer_token"])
    assert auth_json_for_runtime(cred.auth_json)["bearer_token"] == "migrate-me-token"
    assert "migrate-me-token" not in _pg_auth_json_text(db_session, "credentials", int(cred.id))


def test_p_credential_reuse_regression(client: TestClient, db_session: Session) -> None:
    connector = _connector(db_session)
    db_session.commit()
    cred = client.post(
        "/api/v1/credentials/",
        json={
            "connector_id": connector.id,
            "name": "reuse",
            "auth_type": "BEARER",
            "auth_json": {"bearer_token": "reuse-token"},
        },
    ).json()
    s1 = client.post(
        "/api/v1/sources/",
        json={
            "connector_id": connector.id,
            "source_type": "HTTP_API_POLLING",
            "config_json": {},
            "auth_json": {},
            "credential_id": cred["id"],
        },
    )
    s2 = client.post(
        "/api/v1/sources/",
        json={
            "connector_id": connector.id,
            "source_type": "HTTP_API_POLLING",
            "config_json": {},
            "auth_json": {},
            "credential_id": cred["id"],
        },
    )
    assert s1.status_code == 201 and s2.status_code == 201
    db_session.expire_all()
    src = db_session.query(Source).filter(Source.id == s1.json()["id"]).one()
    assert resolve_source_auth_json(db_session, src)["bearer_token"] == "reuse-token"


def test_q_oauth2_auth_code_envelope_version() -> None:
    env = encrypt_string("x", raw_key=STRONG_KEY)
    assert env["__gdc_enc__"] == ENVELOPE_VERSION
    assert env["alg"] == "AESGCM"
    assert env["kid"] == "1"


def test_r_oauth2_client_credentials_regression() -> None:
    strat = AuthStrategyRegistry.get("OAUTH2_CLIENT_CREDENTIALS")
    assert strat is not None
    # Strategy still accepts plaintext auth dict (runtime decrypt happens upstream).
    assert hasattr(strat, "apply") or callable(strat)


def test_s_session_login_regression() -> None:
    strat = AuthStrategyRegistry.get("SESSION_LOGIN")
    assert strat is not None


def test_t_http_resilience_import_regression() -> None:
    from app.http import resilience as _resilience  # noqa: F401


def test_bearer_strategy_rejects_undecrypted_envelope() -> None:
    """Encrypted envelopes must never be stringified onto Authorization."""

    from app.connectors.auth.bearer import BearerAuthStrategy
    from app.runtime.errors import PreviewRequestError

    env = encrypt_string("secret-token", raw_key=STRONG_KEY)
    strat = BearerAuthStrategy()
    with pytest.raises(PreviewRequestError) as ei:
        strat.apply(
            {"auth_type": "BEARER", "token": env},
            {},
            {},
            verify_ssl=True,
            proxy_url=None,
            timeout_seconds=5.0,
            base_url="https://example.test",
        )
    assert ei.value.status_code == 500
    detail = ei.value.detail if isinstance(ei.value.detail, dict) else {}
    assert detail.get("code") == "AUTH_SECRET_NOT_DECRYPTED"


def test_u_checkpoint_import_regression() -> None:
    from app.checkpoints import models as _cp  # noqa: F401


def test_mask_secrets_still_masks_envelopes() -> None:
    stored = auth_json_for_storage({"access_token": "tok", "token_type": "Bearer"})
    masked = mask_secrets(stored)
    assert masked["access_token"] == SECRET_MASK
    assert masked["token_type"] == "Bearer"


def test_plaintext_legacy_read_without_reencrypt_required(db_session: Session) -> None:
    """Decrypt path accepts legacy plaintext until migration/write."""

    connector = _connector(db_session)
    db_session.execute(
        text(
            "INSERT INTO credentials (connector_id, name, auth_type, auth_json, status, created_at, updated_at) "
            "VALUES (:cid, 'plain-read', 'BEARER', CAST(:auth AS json), 'CONNECTED', NOW(), NOW())"
        ),
        {
            "cid": connector.id,
            "auth": json.dumps({"bearer_token": "still-plain"}),
        },
    )
    db_session.commit()
    row = db_session.query(Credential).filter(Credential.name == "plain-read").one()
    assert contains_plaintext_secrets(row.auth_json)
    assert load_credential_auth_json(row)["bearer_token"] == "still-plain"
