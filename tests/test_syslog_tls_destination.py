"""Backend tests for the SYSLOG_TLS destination type.

Covers:
- Config validation (TLS keys only on SYSLOG_TLS, required host/port).
- Sender protocol selection and TLS context construction.
- Successful TLS delivery against a self-signed receiver (insecure mode + strict
  with CA bundle).
- Hostname mismatch failure under strict.
- Expired cert failure under strict.
- Connectivity probe response shape (success and failure cases).
- Retry compatibility through the existing route failure policy path.
- Checkpoint must not advance when TLS delivery fails (PAUSE_STREAM_ON_FAILURE).
"""

from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.checkpoints.models import Checkpoint
from app.database import get_db
from app.delivery.syslog_sender import SyslogSender, resolve_syslog_protocol
from app.delivery.syslog_tls import (
    SyslogTlsConfig,
    build_syslog_tls_context,
    normalize_syslog_tls_config,
)
from app.destinations.adapters.registry import DestinationAdapterRegistry
from app.destinations.adapters.syslog_tls import SyslogTlsDestinationAdapter
from app.destinations.config_validation import validate_destination_config
from app.destinations.models import Destination
from app.destinations.test_service import run_destination_connectivity_probe
from app.main import app
from app.routes.models import Route
from app.runners.stream_runner import StreamRunner
from app.runtime.errors import DestinationSendError
from app.runtime.stream_context import StreamContext
from app.streams.models import Stream
from tests.syslog_receiver import parse_compact_json_from_syslog_line
from tests.syslog_tls_helpers import (
    SyslogTlsTestReceiver,
    write_self_signed_cert,
)


# --- Config validation ---------------------------------------------------------


class TestConfigValidation:
    def test_tls_keys_rejected_for_syslog_tcp(self) -> None:
        with pytest.raises(ValueError, match="TLS fields"):
            validate_destination_config(
                "SYSLOG_TCP",
                {"host": "h", "port": 514, "tls_enabled": True},
            )

    def test_tls_keys_rejected_for_webhook(self) -> None:
        with pytest.raises(ValueError, match="TLS fields"):
            validate_destination_config(
                "WEBHOOK_POST",
                {"url": "https://x/y", "tls_verify_mode": "strict"},
            )

    def test_syslog_tls_requires_host(self) -> None:
        with pytest.raises(ValueError, match="host"):
            validate_destination_config("SYSLOG_TLS", {"port": 6514})

    def test_syslog_tls_rejects_invalid_verify_mode(self) -> None:
        with pytest.raises(ValueError, match="tls_verify_mode"):
            validate_destination_config(
                "SYSLOG_TLS",
                {"host": "h", "port": 6514, "tls_verify_mode": "loose"},
            )

    def test_syslog_tls_rejects_tls_enabled_false(self) -> None:
        with pytest.raises(ValueError, match="tls_enabled=true"):
            validate_destination_config(
                "SYSLOG_TLS",
                {"host": "h", "port": 6514, "tls_enabled": False},
            )

    def test_syslog_tls_requires_matching_client_cert_and_key(self) -> None:
        with pytest.raises(ValueError, match="tls_client_key_path"):
            validate_destination_config(
                "SYSLOG_TLS",
                {"host": "h", "port": 6514, "tls_client_cert_path": "/x.crt"},
            )

    def test_syslog_tls_accepts_minimum_config(self) -> None:
        validate_destination_config(
            "SYSLOG_TLS",
            {"host": "h", "port": 6514, "tls_enabled": True},
        )


# --- Sender protocol selection -------------------------------------------------


class TestProtocolSelection:
    def test_resolve_syslog_protocol_tls(self) -> None:
        assert resolve_syslog_protocol({}, "SYSLOG_TLS") == "tls"

    def test_resolve_syslog_protocol_falls_back_for_explicit_tcp(self) -> None:
        assert resolve_syslog_protocol({"protocol": "tcp"}, None) == "tcp"

    def test_resolve_syslog_protocol_falls_back_for_explicit_tls(self) -> None:
        assert resolve_syslog_protocol({"protocol": "tls"}, None) == "tls"


# --- Adapter wiring ------------------------------------------------------------


class TestAdapterRegistry:
    def test_registry_returns_dedicated_tls_adapter(self) -> None:
        reg = DestinationAdapterRegistry()
        assert isinstance(reg.get("SYSLOG_TLS"), SyslogTlsDestinationAdapter)


# --- Connectivity probe (no network) -------------------------------------------


class TestProbeShape:
    def test_invalid_config_returns_failure_payload(self) -> None:
        out = run_destination_connectivity_probe("SYSLOG_TLS", {"host": "", "port": 6514})
        assert out["success"] is False
        assert "host" in out["message"].lower()
        assert out["detail"]["error_code"] == "TLS_CONFIG_INVALID"


# --- TLS delivery against a self-signed receiver -------------------------------


@pytest.fixture
def tls_receiver_strict(tmp_path: Path) -> Any:
    cert = write_self_signed_cert(tmp_path / "tls", common_name="localhost", san_dns=["localhost"])
    recv = SyslogTlsTestReceiver(certfile=cert.cert_path, keyfile=cert.key_path)
    recv.start()
    try:
        yield recv, cert
    finally:
        recv.stop()


@pytest.fixture
def tls_receiver_hostname_mismatch(tmp_path: Path) -> Any:
    cert = write_self_signed_cert(
        tmp_path / "tls-mismatch",
        common_name="elsewhere.example",
        san_dns=["elsewhere.example"],
    )
    recv = SyslogTlsTestReceiver(certfile=cert.cert_path, keyfile=cert.key_path)
    recv.start()
    try:
        yield recv, cert
    finally:
        recv.stop()


@pytest.fixture
def tls_receiver_expired(tmp_path: Path) -> Any:
    cert = write_self_signed_cert(
        tmp_path / "tls-expired",
        common_name="localhost",
        san_dns=["localhost"],
        expired=True,
    )
    recv = SyslogTlsTestReceiver(certfile=cert.cert_path, keyfile=cert.key_path)
    recv.start()
    try:
        yield recv, cert
    finally:
        recv.stop()


def _drain_first_message(recv: SyslogTlsTestReceiver, timeout: float = 5.0) -> dict[str, Any] | None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        for line in recv.messages():
            parsed = parse_compact_json_from_syslog_line(line)
            if parsed:
                return parsed
        time.sleep(0.05)
    return None


class TestTlsSenderE2E:
    def test_tls_send_insecure_mode_delivers_payload(self, tls_receiver_strict: Any) -> None:
        recv, _cert = tls_receiver_strict
        sender = SyslogSender()
        events = [{"id": "evt-1", "message": "hello-tls", "severity": "INFO"}]
        sender.send(
            events,
            {
                "host": recv.host,
                "port": recv.port,
                "tls_enabled": True,
                "tls_verify_mode": "insecure_skip_verify",
            },
            destination_type="SYSLOG_TLS",
        )
        parsed = _drain_first_message(recv)
        assert parsed is not None, f"no message captured; handshake errors: {recv.handshake_errors()}"
        assert parsed["id"] == "evt-1"
        assert parsed["message"] == "hello-tls"

    def test_tls_send_strict_with_ca_bundle(self, tls_receiver_strict: Any) -> None:
        recv, cert = tls_receiver_strict
        sender = SyslogSender()
        events = [{"id": "evt-strict", "message": "ok"}]
        sender.send(
            events,
            {
                "host": "localhost",  # SAN = localhost
                "port": recv.port,
                "tls_enabled": True,
                "tls_verify_mode": "strict",
                "tls_ca_cert_path": str(cert.cert_path),
            },
            destination_type="SYSLOG_TLS",
        )
        parsed = _drain_first_message(recv)
        assert parsed is not None
        assert parsed["id"] == "evt-strict"

    def test_tls_send_hostname_mismatch_under_strict_raises(
        self, tls_receiver_hostname_mismatch: Any
    ) -> None:
        recv, cert = tls_receiver_hostname_mismatch
        sender = SyslogSender()
        with pytest.raises(DestinationSendError):
            sender.send(
                [{"id": "evt"}],
                {
                    "host": "127.0.0.1",  # cert is for elsewhere.example
                    "port": recv.port,
                    "tls_enabled": True,
                    "tls_verify_mode": "strict",
                    "tls_ca_cert_path": str(cert.cert_path),
                    "tls_server_name": "127.0.0.1",
                },
                destination_type="SYSLOG_TLS",
            )

    def test_tls_send_expired_cert_under_strict_raises(self, tls_receiver_expired: Any) -> None:
        recv, cert = tls_receiver_expired
        sender = SyslogSender()
        with pytest.raises(DestinationSendError):
            sender.send(
                [{"id": "evt"}],
                {
                    "host": "localhost",
                    "port": recv.port,
                    "tls_enabled": True,
                    "tls_verify_mode": "strict",
                    "tls_ca_cert_path": str(cert.cert_path),
                },
                destination_type="SYSLOG_TLS",
            )

    def test_tls_send_strict_without_ca_against_self_signed_raises(
        self, tls_receiver_strict: Any
    ) -> None:
        recv, _cert = tls_receiver_strict
        sender = SyslogSender()
        with pytest.raises(DestinationSendError):
            sender.send(
                [{"id": "evt"}],
                {
                    "host": "localhost",
                    "port": recv.port,
                    "tls_enabled": True,
                    "tls_verify_mode": "strict",
                },
                destination_type="SYSLOG_TLS",
            )


# --- Connectivity probe E2E ----------------------------------------------------


class TestTlsProbeE2E:
    def test_probe_strict_success_with_ca(self, tls_receiver_strict: Any) -> None:
        recv, cert = tls_receiver_strict
        out = run_destination_connectivity_probe(
            "SYSLOG_TLS",
            {
                "host": "localhost",
                "port": recv.port,
                "tls_enabled": True,
                "tls_verify_mode": "strict",
                "tls_ca_cert_path": str(cert.cert_path),
            },
        )
        assert out["success"] is True, out
        detail = out["detail"]
        assert detail["protocol"] == "tls"
        assert detail["verify_mode"] == "strict"
        assert detail.get("negotiated_tls_version") is not None
        assert detail.get("cipher")

    def test_probe_insecure_success_against_self_signed(self, tls_receiver_strict: Any) -> None:
        recv, _ = tls_receiver_strict
        out = run_destination_connectivity_probe(
            "SYSLOG_TLS",
            {
                "host": recv.host,
                "port": recv.port,
                "tls_enabled": True,
                "tls_verify_mode": "insecure_skip_verify",
            },
        )
        assert out["success"] is True, out
        assert out["detail"]["verify_mode"] == "insecure_skip_verify"

    def test_probe_hostname_mismatch_reports_error_code(
        self, tls_receiver_hostname_mismatch: Any
    ) -> None:
        recv, cert = tls_receiver_hostname_mismatch
        out = run_destination_connectivity_probe(
            "SYSLOG_TLS",
            {
                "host": "127.0.0.1",
                "port": recv.port,
                "tls_enabled": True,
                "tls_verify_mode": "strict",
                "tls_ca_cert_path": str(cert.cert_path),
                "tls_server_name": "127.0.0.1",
            },
        )
        assert out["success"] is False
        # The handshake fails with verification — exact subcode depends on OpenSSL message text
        assert out["detail"]["error_code"].startswith("TLS_")

    def test_probe_expired_cert_reports_error_code(self, tls_receiver_expired: Any) -> None:
        recv, cert = tls_receiver_expired
        out = run_destination_connectivity_probe(
            "SYSLOG_TLS",
            {
                "host": "localhost",
                "port": recv.port,
                "tls_enabled": True,
                "tls_verify_mode": "strict",
                "tls_ca_cert_path": str(cert.cert_path),
            },
        )
        assert out["success"] is False
        assert out["detail"]["error_code"].startswith("TLS_")


# --- Destination test endpoint -------------------------------------------------


@pytest.fixture
def client(db_session: Session) -> TestClient:
    def _override_db():
        yield db_session

    app.dependency_overrides[get_db] = _override_db
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_db, None)


class TestDestinationTestEndpointTls:
    def test_endpoint_returns_tls_detail(self, client: TestClient, db_session: Session) -> None:
        row = Destination(
            name="tls-endpoint",
            destination_type="SYSLOG_TLS",
            config_json={
                "host": "127.0.0.1",
                "port": 6514,
                "tls_enabled": True,
                "tls_verify_mode": "insecure_skip_verify",
            },
            rate_limit_json={},
            enabled=True,
        )
        db_session.add(row)
        db_session.commit()
        db_session.refresh(row)

        fake = {
            "success": True,
            "latency_ms": 1.5,
            "message": "TLS handshake completed (insecure_skip_verify) and test syslog message sent.",
            "detail": {
                "protocol": "tls",
                "verify_mode": "insecure_skip_verify",
                "negotiated_tls_version": "TLSv1.3",
                "cipher": "TLS_AES_256_GCM_SHA384",
            },
            "tested_at": "2026-05-09T12:00:00+00:00",
        }
        with patch("app.destinations.router.run_destination_connectivity_test", return_value=fake):
            res = client.post(f"/api/v1/destinations/{row.id}/test")

        assert res.status_code == 200
        body = res.json()
        assert body["success"] is True
        assert body["detail"]["protocol"] == "tls"
        assert body["detail"]["negotiated_tls_version"] == "TLSv1.3"


class TestDestinationCreateTls:
    def test_create_persists_tls_config(self, client: TestClient) -> None:
        res = client.post(
            "/api/v1/destinations/",
            json={
                "name": "lab-tls",
                "destination_type": "SYSLOG_TLS",
                "config_json": {
                    "host": "siem.example",
                    "port": 6514,
                    "tls_enabled": True,
                    "tls_verify_mode": "strict",
                    "tls_ca_cert_path": "/etc/gdc/tls/ca.pem",
                    "tls_server_name": "siem.example",
                },
                "rate_limit_json": {"max_events": 1000, "per_seconds": 1},
            },
        )
        assert res.status_code == 201, res.text
        body = res.json()
        assert body["destination_type"] == "SYSLOG_TLS"
        assert body["config_json"]["tls_enabled"] is True
        assert body["config_json"]["tls_verify_mode"] == "strict"

    def test_create_rejects_tls_keys_on_tcp_destination(self, client: TestClient) -> None:
        res = client.post(
            "/api/v1/destinations/",
            json={
                "name": "bad",
                "destination_type": "SYSLOG_TCP",
                "config_json": {"host": "h", "port": 514, "tls_enabled": True},
                "rate_limit_json": {},
            },
        )
        assert res.status_code == 422
        assert res.json()["detail"]["error_code"] == "INVALID_DESTINATION_CONFIG"


# --- Retry / checkpoint compatibility through StreamRunner ---------------------


def _build_runtime_stream(
    *, destination_type: str, config: dict[str, Any], failure_policy: str
) -> Any:
    """Build minimal duck-typed stream/route/destination objects for fan_out testing."""

    from types import SimpleNamespace

    destination = SimpleNamespace(
        id=7,
        destination_type=destination_type,
        config=config,
        enabled=True,
        name="tls-target",
        rate_limit_json={},
    )
    route = SimpleNamespace(
        id=11,
        enabled=True,
        failure_policy=failure_policy,
        retry_count=1,
        backoff_seconds=0.0,
        formatter_config_json=None,
        rate_limit_json={},
        destination=destination,
    )
    stream = SimpleNamespace(
        id=99,
        name="tls-stream",
        connector_id=1,
        source_type="HTTP_API_POLLING",
        source_config={},
        stream_config={},
        field_mappings={},
        enrichment={},
        override_policy="KEEP_EXISTING",
        routes=[route],
        status=None,
    )
    return stream


class TestRetryAndCheckpointCompatibility:
    def test_retry_and_backoff_recovers_after_first_tls_failure(self) -> None:
        sender = SyslogSender()
        events = [{"id": "x", "message": "y"}]
        attempts: dict[str, int] = {"n": 0}

        original = sender._send_tls

        def _fake(payloads: list[bytes], cfg: dict[str, Any]) -> None:
            attempts["n"] += 1
            if attempts["n"] == 1:
                raise DestinationSendError("Syslog TLS handshake failed: synthetic")

        sender._send_tls = _fake  # type: ignore[assignment]

        try:
            runner = StreamRunner(syslog_sender=sender)
            runner._run_id = "runtest"
            runtime_stream = _build_runtime_stream(
                destination_type="SYSLOG_TLS",
                config={
                    "host": "h",
                    "port": 6514,
                    "tls_enabled": True,
                    "tls_verify_mode": "insecure_skip_verify",
                },
                failure_policy="RETRY_AND_BACKOFF",
            )
            outcome = runner._fan_out(runtime_stream, events)
        finally:
            sender._send_tls = original  # type: ignore[assignment]

        assert outcome.successful_events == events
        assert attempts["n"] == 2  # initial fail + retry success

    def test_pause_on_failure_does_not_advance_checkpoint(self) -> None:
        sender = SyslogSender()
        events = [{"id": "x"}]
        sender._send_tls = lambda payloads, cfg: (_ for _ in ()).throw(  # type: ignore[assignment]
            DestinationSendError("Syslog TLS handshake failed: synthetic")
        )
        runner = StreamRunner(syslog_sender=sender)
        runner._run_id = "runtest"
        runtime_stream = _build_runtime_stream(
            destination_type="SYSLOG_TLS",
            config={
                "host": "h",
                "port": 6514,
                "tls_enabled": True,
                "tls_verify_mode": "insecure_skip_verify",
            },
            failure_policy="PAUSE_STREAM_ON_FAILURE",
        )
        outcome = runner._fan_out(runtime_stream, events)
        # No successful events => checkpoint must not advance via the runner's success path.
        assert outcome.successful_events == []
        # Stream status must be set to PAUSED by the failure policy handler.
        assert runtime_stream.status == "PAUSED"


# --- TLS context dataclass -----------------------------------------------------


class TestNormalizeTlsConfig:
    def test_strict_default_when_unset(self) -> None:
        cfg = normalize_syslog_tls_config({"host": "h", "port": 6514})
        assert cfg.verify_mode == "strict"
        assert cfg.server_name == "h"
        assert cfg.connect_timeout > 0

    def test_server_name_overrides_host_for_sni(self) -> None:
        cfg = normalize_syslog_tls_config(
            {"host": "10.0.0.5", "port": 6514, "tls_server_name": "siem.example"}
        )
        assert cfg.server_name == "siem.example"

    def test_invalid_timeout_raises(self) -> None:
        with pytest.raises(ValueError):
            normalize_syslog_tls_config({"host": "h", "port": 6514, "connect_timeout": -1})


class TestBuildContext:
    def test_strict_mode_enables_hostname_check(self) -> None:
        ctx = build_syslog_tls_context(
            SyslogTlsConfig(
                host="h",
                port=6514,
                verify_mode="strict",
                server_name="h",
                connect_timeout=5.0,
                write_timeout=5.0,
                ca_cert_path=None,
                client_cert_path=None,
                client_key_path=None,
            )
        )
        import ssl as _ssl
        assert ctx.check_hostname is True
        assert ctx.verify_mode == _ssl.CERT_REQUIRED

    def test_insecure_mode_disables_verification(self) -> None:
        ctx = build_syslog_tls_context(
            SyslogTlsConfig(
                host="h",
                port=6514,
                verify_mode="insecure_skip_verify",
                server_name="h",
                connect_timeout=5.0,
                write_timeout=5.0,
                ca_cert_path=None,
                client_cert_path=None,
                client_key_path=None,
            )
        )
        import ssl as _ssl
        assert ctx.check_hostname is False
        assert ctx.verify_mode == _ssl.CERT_NONE
