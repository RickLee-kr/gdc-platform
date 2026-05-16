"""Development seed data for Generic Data Connector Platform.

Running ``python -m app.db.seed`` or ``python scripts/seed.py`` creates **missing**
sample rows only. Existing connectors/streams/etc. are never overwritten.

``python -m app.db.seed --platform-admin-only`` creates only the **admin** platform
user when missing (used by the dev validation lab start script so UI login works
on a fresh ``datarelay`` without inserting the generic "Sample API Connector" demo).

Destructive re-application of demo defaults was removed so developer-created data
is not reset during iterative seed runs.

Bootstrap **local** platform login (``platform_users``): if username ``admin`` is
absent, creates one ``ADMINISTRATOR``. Password is ``GDC_SEED_ADMIN_PASSWORD``
when set (minimum 8 characters), otherwise the documented first-install default
``admin``. The default-password path sets ``must_change_password=true``; seeded
override passwords do not. Never overwrites an existing ``admin`` row unless
``--reset-platform-admin-password`` is passed together with
``--platform-admin-only``.
"""

from __future__ import annotations

import os

from sqlalchemy.orm import Session

from app.auth.security import get_password_hash
from app.checkpoints.models import Checkpoint
from app.connectors.models import Connector
from app.database import SessionLocal
from app.destinations.models import Destination
from app.enrichments.models import Enrichment
from app.mappings.models import Mapping
from app.routes.models import Route
from app.sources.models import Source
from app.platform_admin.models import PlatformUser
from app.platform_admin.validation import normalize_username
from app.streams.models import Stream

_DEFAULT_BOOTSTRAP_ADMIN_PASSWORD = "admin"


def seed_default_platform_admin(db: Session) -> dict[str, object]:
    """Create ``admin`` / ``ADMINISTRATOR`` when missing (create-only)."""

    username = normalize_username("admin")
    existing = db.query(PlatformUser).filter(PlatformUser.username == username).first()
    if existing is not None:
        return {"created": False, "username": username}

    env_pw = (os.environ.get("GDC_SEED_ADMIN_PASSWORD") or "").strip()
    if env_pw:
        if len(env_pw) < 8:
            raise ValueError("GDC_SEED_ADMIN_PASSWORD must be at least 8 characters when set")
        password = env_pw
        must_change_password = False
    else:
        password = _DEFAULT_BOOTSTRAP_ADMIN_PASSWORD
        must_change_password = True

    user = PlatformUser(
        username=username,
        password_hash=get_password_hash(password),
        role="ADMINISTRATOR",
        status="ACTIVE",
        must_change_password=must_change_password,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return {"created": True, "username": username, "user_id": int(user.id)}


def reset_or_create_platform_admin_password(db: Session) -> dict[str, object]:
    """Set ``admin`` password from ``GDC_SEED_ADMIN_PASSWORD`` if the row exists; otherwise create via :func:`seed_default_platform_admin`.

    Requires ``GDC_SEED_ADMIN_PASSWORD`` (8+ characters) when updating an existing
    ``admin`` row. Bumps ``token_version`` on reset so outstanding JWTs for that
    user are rejected (same effect as a normal password change).
    """

    username = normalize_username("admin")
    existing = db.query(PlatformUser).filter(PlatformUser.username == username).first()
    if existing is None:
        return seed_default_platform_admin(db)

    env_pw = (os.environ.get("GDC_SEED_ADMIN_PASSWORD") or "").strip()
    if not env_pw:
        raise ValueError(
            "GDC_SEED_ADMIN_PASSWORD must be set (minimum 8 characters) to reset an existing platform admin password",
        )
    if len(env_pw) < 8:
        raise ValueError("GDC_SEED_ADMIN_PASSWORD must be at least 8 characters when set")

    existing.password_hash = get_password_hash(env_pw)
    existing.must_change_password = False
    existing.token_version = int(getattr(existing, "token_version", 1) or 1) + 1
    db.commit()
    db.refresh(existing)
    return {
        "created": False,
        "password_reset": True,
        "username": username,
        "user_id": int(existing.id),
    }


def seed_dev_data(db: Session) -> dict[str, int]:
    """Create sample rows when absent (create-only; no updates to existing rows)."""

    connector = db.query(Connector).filter(Connector.name == "Sample API Connector").first()
    if connector is None:
        connector = Connector(name="Sample API Connector", description="Development seed connector", status="RUNNING")
        db.add(connector)
        db.flush()

    source = db.query(Source).filter(Source.connector_id == connector.id, Source.source_type == "HTTP_API_POLLING").first()
    if source is None:
        source = Source(
            connector_id=connector.id,
            source_type="HTTP_API_POLLING",
            config_json={"base_url": "https://api.example.com"},
            auth_json={"Authorization": "Bearer sample-token"},
            enabled=True,
        )
        db.add(source)
        db.flush()

    stream = db.query(Stream).filter(Stream.source_id == source.id, Stream.name == "Sample Alerts Stream").first()
    if stream is None:
        stream = Stream(
            connector_id=connector.id,
            source_id=source.id,
            name="Sample Alerts Stream",
            stream_type="HTTP_API_POLLING",
            config_json={"endpoint": "/alerts", "method": "GET", "event_array_path": "$.items"},
            polling_interval=60,
            enabled=True,
            status="RUNNING",
            rate_limit_json={"max_requests": 60, "per_seconds": 60},
        )
        db.add(stream)
        db.flush()

    mapping = db.query(Mapping).filter(Mapping.stream_id == stream.id).first()
    mapping_payload = {
        "event_id": "$.id",
        "severity": "$.severity",
        "message": "$.message",
        "created_at": "$.created_at",
    }
    if mapping is None:
        mapping = Mapping(
            stream_id=stream.id,
            event_array_path="$.items",
            field_mappings_json=mapping_payload,
            raw_payload_mode="JSON",
        )
        db.add(mapping)
        db.flush()

    enrichment = db.query(Enrichment).filter(Enrichment.stream_id == stream.id).first()
    enrichment_payload = {
        "vendor": "SampleVendor",
        "product": "SampleProduct",
        "log_type": "sample_alert",
        "event_source": "sample_api_alerts",
        "collector_name": "generic-connector-01",
        "tenant": "default",
    }
    if enrichment is None:
        enrichment = Enrichment(
            stream_id=stream.id,
            enrichment_json=enrichment_payload,
            override_policy="KEEP_EXISTING",
            enabled=True,
        )
        db.add(enrichment)
        db.flush()

    destination = db.query(Destination).filter(Destination.name == "Sample Webhook Destination").first()
    if destination is None:
        destination = Destination(
            name="Sample Webhook Destination",
            destination_type="WEBHOOK_POST",
            config_json={
                "url": "https://receiver.example.com/events",
                "method": "POST",
                "headers": {"Content-Type": "application/json"},
                "timeout_seconds": 30,
            },
            rate_limit_json={"max_events": 100, "per_seconds": 1},
            enabled=True,
        )
        db.add(destination)
        db.flush()

    route = (
        db.query(Route).filter(Route.stream_id == stream.id, Route.destination_id == destination.id).first()
    )
    if route is None:
        route = Route(
            stream_id=stream.id,
            destination_id=destination.id,
            enabled=True,
            failure_policy="LOG_AND_CONTINUE",
            formatter_config_json={"message_format": "json"},
            rate_limit_json={"max_events": 100, "per_seconds": 1},
            status="ENABLED",
        )
        db.add(route)
        db.flush()

    checkpoint = db.query(Checkpoint).filter(Checkpoint.stream_id == stream.id).first()
    if checkpoint is None:
        checkpoint = Checkpoint(
            stream_id=stream.id,
            checkpoint_type="EVENT_ID",
            checkpoint_value_json={"last_event_id": None},
        )
        db.add(checkpoint)
        db.flush()

    db.commit()
    db.refresh(route)
    db.refresh(checkpoint)

    return {
        "connector_id": connector.id,
        "source_id": source.id,
        "stream_id": stream.id,
        "destination_id": destination.id,
        "route_id": route.id,
        "checkpoint_id": checkpoint.id,
    }


def run_seed(*, admin_only: bool, reset_platform_admin_password: bool) -> dict[str, object]:
    """Run seed against ``SessionLocal()`` (respects ``DATABASE_URL``)."""

    db = SessionLocal()
    try:
        if admin_only:
            if reset_platform_admin_password:
                admin = reset_or_create_platform_admin_password(db)
            else:
                admin = seed_default_platform_admin(db)
            return {"platform_admin": admin}
        result = seed_dev_data(db)
        admin = seed_default_platform_admin(db)
        return {**{k: v for k, v in result.items()}, "platform_admin": admin}
    finally:
        db.close()


def main(argv: list[str] | None = None) -> int:
    """CLI entry for ``python -m app.db.seed``."""

    import sys

    args = list(sys.argv[1:] if argv is None else argv)
    if "-h" in args or "--help" in args:
        print("Usage: python -m app.db.seed [options]")
        print("")
        print("  Default: create-only sample connector/stream/… (if missing) and platform admin.")
        print("  --platform-admin-only: only ensure user 'admin' exists (password from")
        print("    GDC_SEED_ADMIN_PASSWORD when set, otherwise default first-install password).")
        print("  --reset-platform-admin-password: with --platform-admin-only only; if 'admin' exists,")
        print("    set password hash from GDC_SEED_ADMIN_PASSWORD (required, 8+ characters).")
        print("    If 'admin' is missing, creates the user (same rules as without this flag).")
        return 0

    admin_only = "--platform-admin-only" in args
    reset_platform_admin_password = "--reset-platform-admin-password" in args
    known = ("--platform-admin-only", "--reset-platform-admin-password")
    unknown = [a for a in args if a not in known]
    if unknown:
        print("Unknown arguments:", ", ".join(unknown), file=sys.stderr)
        return 2

    if reset_platform_admin_password and not admin_only:
        print(
            "error: --reset-platform-admin-password requires --platform-admin-only",
            file=sys.stderr,
        )
        return 2

    try:
        out = run_seed(admin_only=admin_only, reset_platform_admin_password=reset_platform_admin_password)
    except ValueError as exc:
        print(str(exc), file=sys.stderr)
        return 1

    print(out)
    admin = out.get("platform_admin") or {}
    if admin.get("password_reset") is True:
        print("Reset platform user 'admin' password hash from GDC_SEED_ADMIN_PASSWORD (token_version bumped).")
    if admin.get("created") is True:
        if admin_only:
            print("Created platform user 'admin'. Password source: GDC_SEED_ADMIN_PASSWORD or first-install default.")
        else:
            env_pw = (os.environ.get("GDC_SEED_ADMIN_PASSWORD") or "").strip()
            if env_pw:
                print(
                    "Login: username=%r (password from GDC_SEED_ADMIN_PASSWORD; not echoed)"
                    % (admin.get("username"),),
                )
            else:
                print(
                    "Login: username=%r password=%r (change immediately; override with GDC_SEED_ADMIN_PASSWORD)"
                    % (admin.get("username"), _DEFAULT_BOOTSTRAP_ADMIN_PASSWORD),
                )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
