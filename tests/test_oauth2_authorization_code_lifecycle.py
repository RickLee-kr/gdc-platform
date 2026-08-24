"""OAuth2 Authorization Code + refresh-token lifecycle (Credential integration)."""

from __future__ import annotations

import json
import threading
import time
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any
from urllib.parse import parse_qs, urlparse

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.checkpoints.models import Checkpoint
from app.connectors.auth.normalize import normalize_connector_auth
from app.connectors.auth.registry import AuthStrategyRegistry, apply_auth_to_http_request
from app.connectors.models import Connector
from app.credentials.models import (
    CREDENTIAL_STATUS_CONNECTED,
    CREDENTIAL_STATUS_NEEDS_RECONNECT,
    CREDENTIAL_STATUS_REVOKED,
    Credential,
    CredentialOAuthState,
)
from app.credentials.oauth2_auth_code import ensure_fresh_oauth2_authorization_code_credential
from app.credentials.resolution import CredentialAuthResolutionError, resolve_source_auth_json
from app.database import get_db, get_db_read_bounded
from app.destinations.models import Destination
from app.enrichments.models import Enrichment
from app.http.resilience import HttpOutcome, ResponseClassifier, RetryPolicy
from app.main import app
from app.mappings.models import Mapping
from app.pollers.http_poller import HttpPoller
from app.routes.models import Route
from app.runners.stream_loader import load_stream_context
from app.security.secrets import SECRET_MASK, mask_secrets
from app.sources.models import Source
from app.streams.models import Stream


class _FakeOAuthProvider:
    """Local authorization-code + token endpoint for lifecycle E2E tests."""

    def __init__(self) -> None:
        self.token_calls = 0
        self.refresh_calls = 0
        self.code_exchange_calls = 0
        self.lock = threading.Lock()
        self.refresh_delay_sec = 0.0
        self.reject_refresh = False
        self.rotate_refresh = True
        self.access_token = "access-live-1"
        self.refresh_token = "refresh-live-1"
        self.next_access = "access-live-2"
        self.next_refresh = "refresh-live-2"
        self.valid_codes: set[str] = {"good-auth-code"}
        self._httpd: ThreadingHTTPServer | None = None
        self.base_url = ""

    def start(self) -> str:
        provider = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, format: str, *args: Any) -> None:  # noqa: A003
                return

            def do_POST(self) -> None:  # noqa: N802
                length = int(self.headers.get("Content-Length") or 0)
                raw = self.rfile.read(length).decode("utf-8")
                form = parse_qs(raw, keep_blank_values=True)
                with provider.lock:
                    provider.token_calls += 1
                grant = (form.get("grant_type") or [""])[0]

                def _json(status: int, body: dict[str, Any]) -> None:
                    payload = json.dumps(body).encode("utf-8")
                    self.send_response(status)
                    self.send_header("Content-Type", "application/json")
                    self.send_header("Content-Length", str(len(payload)))
                    self.end_headers()
                    self.wfile.write(payload)

                if grant == "authorization_code":
                    with provider.lock:
                        provider.code_exchange_calls += 1
                    code = (form.get("code") or [""])[0]
                    if code not in provider.valid_codes:
                        _json(400, {"error": "invalid_grant", "error_description": "bad code"})
                        return
                    _json(
                        200,
                        {
                            "access_token": provider.access_token,
                            "refresh_token": provider.refresh_token,
                            "token_type": "Bearer",
                            "expires_in": 3600,
                            "scope": "read",
                        },
                    )
                    return

                if grant == "refresh_token":
                    with provider.lock:
                        provider.refresh_calls += 1
                    if provider.refresh_delay_sec > 0:
                        time.sleep(provider.refresh_delay_sec)
                    presented = (form.get("refresh_token") or [""])[0]
                    with provider.lock:
                        expected = provider.refresh_token
                        reject = provider.reject_refresh
                    if reject or presented != expected:
                        _json(400, {"error": "invalid_grant", "error_description": "revoked"})
                        return
                    with provider.lock:
                        access = provider.next_access
                        if provider.rotate_refresh:
                            provider.refresh_token = provider.next_refresh
                        refresh = provider.refresh_token
                        provider.access_token = access
                    _json(
                        200,
                        {
                            "access_token": access,
                            "refresh_token": refresh,
                            "token_type": "Bearer",
                            "expires_in": 3600,
                            "scope": "read",
                        },
                    )
                    return

                if grant == "client_credentials":
                    _json(
                        200,
                        {"access_token": "cc-access-token", "token_type": "Bearer", "expires_in": 3600},
                    )
                    return

                self.send_response(400)
                self.end_headers()

            def do_GET(self) -> None:  # noqa: N802
                if self.path.startswith("/resource"):
                    auth = self.headers.get("Authorization") or ""
                    with provider.lock:
                        expected = f"Bearer {provider.access_token}"
                    if auth != expected:
                        self.send_response(401)
                        self.end_headers()
                        return
                    payload = json.dumps({"items": [{"id": "1"}]}).encode("utf-8")
                    self.send_response(200)
                    self.send_header("Content-Type", "application/json")
                    self.send_header("Content-Length", str(len(payload)))
                    self.end_headers()
                    self.wfile.write(payload)
                    return
                self.send_response(404)
                self.end_headers()

        httpd = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self._httpd = httpd
        self.base_url = f"http://127.0.0.1:{httpd.server_address[1]}"
        threading.Thread(target=httpd.serve_forever, daemon=True).start()
        return self.base_url

    def stop(self) -> None:
        if self._httpd is not None:
            self._httpd.shutdown()
            self._httpd.server_close()
            self._httpd = None


@pytest.fixture
def fake_oauth() -> Any:
    provider = _FakeOAuthProvider()
    provider.start()
    try:
        yield provider
    finally:
        provider.stop()


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


def _connector(db: Session, name: str = "oauth-conn") -> Connector:
    row = Connector(name=name, description=None, status="STOPPED")
    db.add(row)
    db.flush()
    return row


def _auth_json(base: str, **extra: Any) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "auth_type": "oauth2_authorization_code",
        "oauth2_authorization_url": f"{base}/authorize",
        "oauth2_token_url": f"{base}/token",
        "oauth2_client_id": "test-client",
        "oauth2_client_secret": "test-secret",
        "oauth2_scope": "read",
        "pkce_enabled": True,
    }
    payload.update(extra)
    return payload


def _create_oauth_credential(client: TestClient, connector_id: int, auth_json: dict[str, Any]) -> dict[str, Any]:
    res = client.post(
        "/api/v1/credentials/",
        json={
            "connector_id": connector_id,
            "name": "oauth-cred",
            "auth_type": "OAUTH2_AUTHORIZATION_CODE",
            "auth_json": auth_json,
        },
    )
    assert res.status_code == 201, res.text
    return res.json()


def _connect_via_callback(client: TestClient, credential_id: int) -> dict[str, Any]:
    begin = client.post(f"/api/v1/credentials/{credential_id}/oauth2/authorize")
    assert begin.status_code == 200, begin.text
    body = begin.json()
    cb = client.get(
        "/api/v1/credentials/oauth2/callback",
        params={"code": "good-auth-code", "state": body["state"]},
    )
    assert cb.status_code == 200, cb.text
    return body


def test_a_authorization_url_generation(client: TestClient, db_session: Session, fake_oauth: _FakeOAuthProvider) -> None:
    connector = _connector(db_session)
    db_session.commit()
    cred = _create_oauth_credential(client, connector.id, _auth_json(fake_oauth.base_url))
    assert cred["status"] == CREDENTIAL_STATUS_NEEDS_RECONNECT

    res = client.post(f"/api/v1/credentials/{cred['id']}/oauth2/authorize")
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["authorization_url"]
    assert body["state"]
    assert body["pkce"] is True
    qs = parse_qs(urlparse(body["authorization_url"]).query)
    assert qs["response_type"] == ["code"]
    assert qs["client_id"] == ["test-client"]
    assert qs["state"] == [body["state"]]
    assert qs["code_challenge_method"] == ["S256"]
    assert qs["code_challenge"][0]
    assert "test-secret" not in res.text
    row = db_session.query(CredentialOAuthState).filter(CredentialOAuthState.state == body["state"]).one()
    assert row.code_verifier
    assert row.consumed_at is None


def test_b_c_state_validation_and_replay(
    client: TestClient, db_session: Session, fake_oauth: _FakeOAuthProvider
) -> None:
    connector = _connector(db_session)
    db_session.commit()
    cred = _create_oauth_credential(client, connector.id, _auth_json(fake_oauth.base_url))
    begin = client.post(f"/api/v1/credentials/{cred['id']}/oauth2/authorize").json()

    bad = client.get("/api/v1/credentials/oauth2/callback", params={"code": "good-auth-code", "state": "nope"})
    assert bad.status_code == 400
    assert bad.json()["detail"]["error_code"] == "OAUTH2_STATE_INVALID"

    ok = client.get(
        "/api/v1/credentials/oauth2/callback",
        params={"code": "good-auth-code", "state": begin["state"]},
    )
    assert ok.status_code == 200, ok.text
    assert ok.json()["status"] == CREDENTIAL_STATUS_CONNECTED

    replay = client.get(
        "/api/v1/credentials/oauth2/callback",
        params={"code": "good-auth-code", "state": begin["state"]},
    )
    assert replay.status_code == 400
    assert replay.json()["detail"]["error_code"] == "OAUTH2_STATE_REPLAY"


def test_d_e_callback_exchange_persist_connected(
    client: TestClient, db_session: Session, fake_oauth: _FakeOAuthProvider
) -> None:
    connector = _connector(db_session)
    db_session.commit()
    cred = _create_oauth_credential(client, connector.id, _auth_json(fake_oauth.base_url))
    _connect_via_callback(client, cred["id"])
    assert fake_oauth.code_exchange_calls == 1

    detail = client.get(f"/api/v1/credentials/{cred['id']}")
    assert detail.status_code == 200
    body = detail.json()
    assert body["status"] == CREDENTIAL_STATUS_CONNECTED
    assert body["auth_json"]["access_token"] == SECRET_MASK
    assert body["auth_json"]["refresh_token"] == SECRET_MASK
    assert "access-live-1" not in detail.text
    assert "refresh-live-1" not in detail.text
    assert "good-auth-code" not in detail.text

    row = db_session.query(Credential).filter(Credential.id == cred["id"]).one()
    db_session.refresh(row)
    assert row.auth_json["access_token"] == "access-live-1"
    assert row.auth_json["refresh_token"] == "refresh-live-1"
    assert row.auth_json.get("token_type") == "Bearer"
    assert row.auth_json.get("scope") == "read"
    assert row.auth_json.get("expires_at")


def test_f_g_h_runtime_use_refresh_rotation(
    client: TestClient, db_session: Session, fake_oauth: _FakeOAuthProvider
) -> None:
    connector = _connector(db_session)
    db_session.commit()
    cred = _create_oauth_credential(client, connector.id, _auth_json(fake_oauth.base_url))
    _connect_via_callback(client, cred["id"])
    db_session.expire_all()

    source = Source(
        connector_id=connector.id,
        source_type="HTTP_API_POLLING",
        config_json={"base_url": fake_oauth.base_url},
        auth_json={},
        credential_id=cred["id"],
    )
    db_session.add(source)
    db_session.commit()

    auth = resolve_source_auth_json(db_session, source)
    assert auth["access_token"] == "access-live-1"
    assert fake_oauth.refresh_calls == 0

    row = db_session.query(Credential).filter(Credential.id == cred["id"]).one()
    auth_json = dict(row.auth_json)
    auth_json["expires_at"] = (datetime.now(timezone.utc) - timedelta(seconds=5)).isoformat()
    row.auth_json = auth_json
    db_session.commit()

    auth2 = resolve_source_auth_json(db_session, source)
    assert auth2["access_token"] == "access-live-2"
    assert auth2["refresh_token"] == "refresh-live-2"
    assert fake_oauth.refresh_calls == 1

    db_session.expire_all()
    row2 = db_session.query(Credential).filter(Credential.id == cred["id"]).one()
    assert row2.auth_json["refresh_token"] == "refresh-live-2"
    assert row2.status == CREDENTIAL_STATUS_CONNECTED


def test_i_concurrent_refresh_single_flight(
    client: TestClient, db_session: Session, fake_oauth: _FakeOAuthProvider
) -> None:
    connector = _connector(db_session)
    db_session.commit()
    cred = _create_oauth_credential(client, connector.id, _auth_json(fake_oauth.base_url))
    _connect_via_callback(client, cred["id"])

    row = db_session.query(Credential).filter(Credential.id == cred["id"]).one()
    auth_json = dict(row.auth_json)
    auth_json["expires_at"] = (datetime.now(timezone.utc) - timedelta(seconds=5)).isoformat()
    row.auth_json = auth_json
    db_session.commit()

    fake_oauth.refresh_delay_sec = 0.4
    results: list[str] = []
    errors: list[BaseException] = []

    def worker() -> None:
        try:
            auth = ensure_fresh_oauth2_authorization_code_credential(int(cred["id"]))
            results.append(str(auth.get("access_token")))
        except BaseException as exc:  # noqa: BLE001
            errors.append(exc)

    threads = [threading.Thread(target=worker) for _ in range(4)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=15)

    assert not errors, errors
    assert fake_oauth.refresh_calls == 1
    assert results
    assert all(tok == "access-live-2" for tok in results)


def test_j_invalid_grant_needs_reconnect(
    client: TestClient, db_session: Session, fake_oauth: _FakeOAuthProvider
) -> None:
    connector = _connector(db_session)
    db_session.commit()
    cred = _create_oauth_credential(client, connector.id, _auth_json(fake_oauth.base_url))
    _connect_via_callback(client, cred["id"])

    row = db_session.query(Credential).filter(Credential.id == cred["id"]).one()
    auth_json = dict(row.auth_json)
    auth_json["expires_at"] = (datetime.now(timezone.utc) - timedelta(seconds=5)).isoformat()
    row.auth_json = auth_json
    db_session.commit()
    fake_oauth.reject_refresh = True

    source = Source(
        connector_id=connector.id,
        source_type="HTTP_API_POLLING",
        config_json={"base_url": fake_oauth.base_url},
        auth_json={},
        credential_id=cred["id"],
    )
    db_session.add(source)
    db_session.commit()

    with pytest.raises(CredentialAuthResolutionError):
        resolve_source_auth_json(db_session, source)

    db_session.expire_all()
    row2 = db_session.query(Credential).filter(Credential.id == cred["id"]).one()
    assert row2.status == CREDENTIAL_STATUS_NEEDS_RECONNECT


def test_k_revoked_runtime_rejection(client: TestClient, db_session: Session, fake_oauth: _FakeOAuthProvider) -> None:
    connector = _connector(db_session)
    db_session.commit()
    cred = _create_oauth_credential(
        client,
        connector.id,
        _auth_json(
            fake_oauth.base_url,
            access_token="tok",
            refresh_token="ref",
            expires_at=(datetime.now(timezone.utc) + timedelta(hours=1)).isoformat(),
        ),
    )
    put = client.put(f"/api/v1/credentials/{cred['id']}", json={"status": CREDENTIAL_STATUS_REVOKED})
    assert put.status_code == 200
    assert put.json()["status"] == CREDENTIAL_STATUS_REVOKED

    source = Source(
        connector_id=connector.id,
        source_type="HTTP_API_POLLING",
        config_json={"base_url": fake_oauth.base_url},
        auth_json={},
        credential_id=cred["id"],
    )
    db_session.add(source)
    db_session.commit()
    with pytest.raises(CredentialAuthResolutionError, match="REVOKED"):
        resolve_source_auth_json(db_session, source)


def test_l_reconnect_flow(client: TestClient, db_session: Session, fake_oauth: _FakeOAuthProvider) -> None:
    connector = _connector(db_session)
    db_session.commit()
    cred = _create_oauth_credential(client, connector.id, _auth_json(fake_oauth.base_url))
    _connect_via_callback(client, cred["id"])

    reconnect = client.post(f"/api/v1/credentials/{cred['id']}/oauth2/reconnect")
    assert reconnect.status_code == 200, reconnect.text
    body = reconnect.json()
    assert body["authorization_url"]
    db_session.expire_all()
    row = db_session.query(Credential).filter(Credential.id == cred["id"]).one()
    assert row.status == CREDENTIAL_STATUS_NEEDS_RECONNECT

    fake_oauth.access_token = "access-reconnected"
    fake_oauth.refresh_token = "refresh-reconnected"
    cb = client.get(
        "/api/v1/credentials/oauth2/callback",
        params={"code": "good-auth-code", "state": body["state"]},
    )
    assert cb.status_code == 200, cb.text
    assert cb.json()["status"] == CREDENTIAL_STATUS_CONNECTED
    db_session.expire_all()
    row2 = db_session.query(Credential).filter(Credential.id == cred["id"]).one()
    assert row2.auth_json["access_token"] == "access-reconnected"


def test_m_secret_masking_no_raw_exposure(
    client: TestClient, db_session: Session, fake_oauth: _FakeOAuthProvider
) -> None:
    connector = _connector(db_session)
    db_session.commit()
    cred = _create_oauth_credential(client, connector.id, _auth_json(fake_oauth.base_url))
    _connect_via_callback(client, cred["id"])
    detail = client.get(f"/api/v1/credentials/{cred['id']}")
    for text in (detail.text,):
        assert "access-live-1" not in text
        assert "refresh-live-1" not in text
        assert "good-auth-code" not in text
        assert "test-secret" not in text

    masked = mask_secrets(
        {
            "access_token": "raw-access",
            "refresh_token": "raw-refresh",
            "client_secret": "raw-secret",
            "authorization_code": "raw-code",
            "code_verifier": "raw-verifier",
        }
    )
    assert masked["access_token"] == SECRET_MASK
    assert masked["refresh_token"] == SECRET_MASK
    assert masked["client_secret"] == SECRET_MASK
    assert masked["authorization_code"] == SECRET_MASK
    assert masked["code_verifier"] == SECRET_MASK


def test_n_oauth2_client_credentials_regression(fake_oauth: _FakeOAuthProvider) -> None:
    strat = AuthStrategyRegistry.get("OAUTH2_CLIENT_CREDENTIALS")
    auth = normalize_connector_auth(
        {
            "auth_type": "oauth2_client_credentials",
            "oauth2_token_url": f"{fake_oauth.base_url}/token",
            "oauth2_client_id": "test-client",
            "oauth2_client_secret": "test-secret",
            "oauth2_scope": "read",
        }
    )
    headers, _ = strat.apply(
        auth, {}, {}, verify_ssl=True, proxy_url=None, timeout_seconds=10.0, base_url=fake_oauth.base_url
    )
    assert headers["Authorization"] == "Bearer cc-access-token"


def test_o_basic_bearer_apikey_regression() -> None:
    basic = apply_auth_to_http_request(
        normalize_connector_auth({"auth_type": "basic", "basic_username": "u", "basic_password": "p"}),
        {},
        {},
        True,
        None,
        10.0,
        "https://example.test",
    )[0]
    assert basic["Authorization"].startswith("Basic ")

    bearer = apply_auth_to_http_request(
        normalize_connector_auth({"auth_type": "bearer", "bearer_token": "tok"}),
        {},
        {},
        True,
        None,
        10.0,
        "https://example.test",
    )[0]
    assert bearer["Authorization"] == "Bearer tok"

    api = apply_auth_to_http_request(
        normalize_connector_auth(
            {
                "auth_type": "api_key",
                "api_key_name": "X-Api-Key",
                "api_key_value": "k",
                "api_key_location": "headers",
            }
        ),
        {},
        {},
        True,
        None,
        10.0,
        "https://example.test",
    )[0]
    assert api["X-Api-Key"] == "k"


def test_p_session_login_regression() -> None:
    strat = AuthStrategyRegistry.get("SESSION_LOGIN")
    headers, params = strat.apply(
        normalize_connector_auth(
            {"auth_type": "session_login", "login_username": "u", "login_password": "p"}
        ),
        {"X-Keep": "1"},
        {"q": "1"},
        verify_ssl=True,
        proxy_url=None,
        timeout_seconds=10.0,
        base_url="https://example.test",
    )
    assert headers["X-Keep"] == "1"
    assert params["q"] == "1"


def test_q_http_resilience_regression() -> None:
    classifier = ResponseClassifier()
    assert classifier.classify_response(httpx.Response(503)).outcome == HttpOutcome.RETRY
    assert classifier.classify_response(httpx.Response(400)).outcome == HttpOutcome.FATAL
    assert classifier.classify_response(httpx.Response(429)).outcome == HttpOutcome.RATE_LIMIT
    policy = RetryPolicy(max_attempts=3, initial_backoff_seconds=1.0)
    assert policy.should_continue(1) is True
    assert policy.should_continue(3) is False


def test_r_checkpoint_regression_on_auth_failure(
    client: TestClient, db_session: Session, fake_oauth: _FakeOAuthProvider
) -> None:
    connector = _connector(db_session)
    db_session.commit()
    cred = _create_oauth_credential(client, connector.id, _auth_json(fake_oauth.base_url))
    _connect_via_callback(client, cred["id"])

    source = Source(
        connector_id=connector.id,
        source_type="HTTP_API_POLLING",
        config_json={"base_url": fake_oauth.base_url, "verify_ssl": True},
        auth_json={},
        credential_id=cred["id"],
    )
    db_session.add(source)
    db_session.flush()
    stream = Stream(
        connector_id=connector.id,
        source_id=source.id,
        name="oauth-stream",
        stream_type="HTTP_API_POLLING",
        config_json={"endpoint": "/resource", "retry_count": 0},
        polling_interval=60,
        enabled=True,
        status="RUNNING",
        rate_limit_json={},
    )
    db_session.add(stream)
    db_session.flush()
    db_session.add(
        Mapping(
            stream_id=stream.id,
            event_array_path="$.items",
            field_mappings_json={"event_id": "$.id"},
            raw_payload_mode="JSON",
        )
    )
    db_session.add(
        Enrichment(
            stream_id=stream.id,
            enrichment_json={"vendor": "OAuth"},
            override_policy="KEEP_EXISTING",
            enabled=True,
        )
    )
    dst = Destination(
        name="oauth-dest",
        destination_type="WEBHOOK_POST",
        config_json={"url": "https://dest.example"},
        rate_limit_json={},
        enabled=True,
    )
    db_session.add(dst)
    db_session.flush()
    db_session.add(
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
    db_session.add(
        Checkpoint(
            stream_id=stream.id,
            checkpoint_type="EVENT_ID",
            checkpoint_value_json={"last_id": "keep-me"},
        )
    )
    db_session.commit()

    ctx = load_stream_context(db_session, int(stream.id))
    payload = HttpPoller().fetch(
        ctx.stream["source_config"],
        ctx.stream["stream_config"],
        ctx.checkpoint,
    )
    assert payload["items"][0]["id"] == "1"

    row = db_session.query(Credential).filter(Credential.id == cred["id"]).one()
    auth_json = dict(row.auth_json)
    auth_json["expires_at"] = (datetime.now(timezone.utc) - timedelta(seconds=5)).isoformat()
    row.auth_json = auth_json
    db_session.commit()
    fake_oauth.reject_refresh = True

    with pytest.raises(Exception):
        load_stream_context(db_session, int(stream.id))

    db_session.expire_all()
    cp2 = db_session.query(Checkpoint).filter(Checkpoint.stream_id == stream.id).one()
    assert cp2.checkpoint_value_json == {"last_id": "keep-me"}
    row2 = db_session.query(Credential).filter(Credential.id == cred["id"]).one()
    assert row2.status == CREDENTIAL_STATUS_NEEDS_RECONNECT


def test_s_legacy_auth_json_fallback(db_session: Session) -> None:
    connector = _connector(db_session)
    source = Source(
        connector_id=connector.id,
        source_type="HTTP_API_POLLING",
        config_json={"base_url": "https://legacy.example"},
        auth_json={"auth_type": "bearer", "bearer_token": "legacy-token"},
        credential_id=None,
    )
    db_session.add(source)
    db_session.commit()
    auth = resolve_source_auth_json(db_session, source)
    assert auth["bearer_token"] == "legacy-token"


def test_authorization_code_strategy_uses_access_token(fake_oauth: _FakeOAuthProvider) -> None:
    strat = AuthStrategyRegistry.get("OAUTH2_AUTHORIZATION_CODE")
    auth = normalize_connector_auth(
        {
            "auth_type": "oauth2_authorization_code",
            "access_token": "strategy-token",
            "token_type": "Bearer",
            "expires_at": (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat(),
            "oauth2_token_url": f"{fake_oauth.base_url}/token",
            "oauth2_client_id": "test-client",
            "oauth2_client_secret": "test-secret",
        }
    )
    headers, _ = strat.apply(
        auth, {}, {}, verify_ssl=True, proxy_url=None, timeout_seconds=10.0, base_url=fake_oauth.base_url
    )
    assert headers["Authorization"] == "Bearer strategy-token"
    assert fake_oauth.refresh_calls == 0
