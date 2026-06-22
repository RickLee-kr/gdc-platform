"""Development seed data for Generic Data Connector Platform.

Running ``python -m app.db.seed`` or ``python scripts/seed.py`` creates **missing**
sample rows only. Existing connectors/streams/etc. are never overwritten.

``python -m app.db.seed --platform-admin-only`` creates only the **admin** platform
user when missing (used by the dev validation lab start script so UI login works
on a fresh ``gdc`` catalog without inserting the generic "Sample API Connector" demo).

Platform admin password behavior is centralized in
``app.platform_admin.admin_password_policy`` (bootstrap create-only; explicit recovery
via ``GDC_RECONCILE_ADMIN_PASSWORD=true``). See ``docs/operations/admin-password-reset.md``.
"""

from __future__ import annotations

import os

from sqlalchemy.orm import Session

from app.checkpoints.models import Checkpoint
from app.connectors.models import Connector
from app.database import SessionLocal
from app.destinations.models import Destination
from app.enrichments.models import Enrichment
from app.mappings.models import Mapping
from app.platform_admin.admin_password_policy import (
    ADMIN_USERNAME,
    DEFAULT_BOOTSTRAP_PASSWORD,
    ENV_RECONCILE_FLAG,
    ENV_SEED_PASSWORD,
    RECONCILE_REASON_DISABLED,
    RECONCILE_REASON_EXPLICIT_RESET,
    RECONCILE_REASON_PASSWORD_UNSET,
    ensure_platform_admin,
    format_admin_reset_report,
    read_reconcile_flag_from_env,
    read_seed_password_from_env,
    resolve_reconcile_enabled,
)
from app.routes.models import Route
import app.route_transform.models  # noqa: F401 — register RouteMapping/RouteEnrichment mappers
from app.sources.models import Source
from app.streams.models import Stream

# Backward-compatible aliases for tests and callers.
_DEFAULT_BOOTSTRAP_ADMIN_PASSWORD = DEFAULT_BOOTSTRAP_PASSWORD
_ADMIN_USERNAME = ADMIN_USERNAME


def _seed_admin_password_from_env() -> str:
    return read_seed_password_from_env()


def _reconcile_admin_password_from_env() -> bool | None:
    return read_reconcile_flag_from_env()


def _resolve_reconcile_admin_password(explicit: bool | None) -> bool | None:
    if explicit is not None:
        return explicit
    return read_reconcile_flag_from_env()


def _should_reconcile_admin_password(explicit: bool | None) -> bool:
    return resolve_reconcile_enabled(explicit)


def seed_default_platform_admin(db: Session, *, reconcile_admin_password: bool | None = None) -> dict[str, object]:
    return ensure_platform_admin(db, reconcile_admin_password=reconcile_admin_password)


def reset_or_create_platform_admin_password(db: Session) -> dict[str, object]:
    out = ensure_platform_admin(db, force_reset=True)
    if out.get("created") is True:
        return out
    return {
        **out,
        "password_reset": True,
        "must_change_password": True,
    }


def reconcile_or_create_platform_admin_password(db: Session) -> dict[str, object]:
    return ensure_platform_admin(db, reconcile_admin_password=True)


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


def run_seed(
    *,
    admin_only: bool,
    reset_platform_admin_password: bool,
    reconcile_admin_password: bool | None = None,
) -> dict[str, object]:
    """Run seed against ``SessionLocal()`` (respects ``DATABASE_URL``)."""

    db = SessionLocal()
    try:
        if admin_only:
            if reset_platform_admin_password:
                admin = reset_or_create_platform_admin_password(db)
            else:
                admin = seed_default_platform_admin(db, reconcile_admin_password=reconcile_admin_password)
            return {"platform_admin": admin}
        result = seed_dev_data(db)
        admin = seed_default_platform_admin(db, reconcile_admin_password=reconcile_admin_password)
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
        print(f"    {ENV_SEED_PASSWORD} when set, otherwise default first-install password).")
        print("  --reconcile-admin-password: explicit recovery — update existing admin hash.")
        print(f"  {ENV_RECONCILE_FLAG}=true: same as --reconcile-admin-password (requires password).")
        print("  --no-password-reconcile: disable password hash reconciliation.")
        print("  --reset-platform-admin-password: alias for explicit reset (--platform-admin-only).")
        print("")
        print("  Official operator recovery: ./scripts/admin/reset-admin-password.sh")
        print("  See docs/operations/admin-password-reset.md")
        return 0

    admin_only = "--platform-admin-only" in args
    reset_platform_admin_password = "--reset-platform-admin-password" in args
    explicit_reconcile = "--reconcile-admin-password" in args
    explicit_no_reconcile = "--no-password-reconcile" in args
    known = (
        "--platform-admin-only",
        "--reset-platform-admin-password",
        "--reconcile-admin-password",
        "--no-password-reconcile",
    )
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
    if explicit_reconcile and explicit_no_reconcile:
        print(
            "error: --reconcile-admin-password and --no-password-reconcile are mutually exclusive",
            file=sys.stderr,
        )
        return 2

    reconcile_admin_password: bool | None
    if explicit_reconcile or reset_platform_admin_password:
        reconcile_admin_password = True
    elif explicit_no_reconcile:
        reconcile_admin_password = False
    else:
        reconcile_admin_password = _resolve_reconcile_admin_password(None)

    try:
        out = run_seed(
            admin_only=admin_only,
            reset_platform_admin_password=reset_platform_admin_password,
            reconcile_admin_password=reconcile_admin_password,
        )
    except ValueError as exc:
        print(str(exc), file=sys.stderr)
        return 1

    admin = out.get("platform_admin") or {}
    print(out)

    if admin.get("password_reconcile") is True or admin.get("created") is True:
        print(format_admin_reset_report(admin))
    elif admin.get("password_reconcile") is False:
        reason = admin.get("password_reconcile_reason")
        if reason == RECONCILE_REASON_DISABLED:
            print("[bootstrap] admin password reconciliation disabled (create-only bootstrap)")
        elif reason == RECONCILE_REASON_PASSWORD_UNSET:
            print(f"[bootstrap] admin password reconciliation skipped: {ENV_SEED_PASSWORD} unset")

    if admin.get("password_reset") is True:
        print("Platform admin password reset completed.")
        print("User must change password on next login.")

    if admin.get("created") is True and not admin.get("password_reconcile"):
        if admin_only:
            print("Created platform user 'admin'. Password source: env override or fixed first-install default.")
        else:
            env_pw = (os.environ.get(ENV_SEED_PASSWORD) or "").strip()
            if env_pw:
                print(
                    "Login: username=%r (password from %s; not echoed)"
                    % (admin.get("username"), ENV_SEED_PASSWORD),
                )
            else:
                print(
                    "Login: username=%r password=%r (change immediately; override with %s)"
                    % (admin.get("username"), DEFAULT_BOOTSTRAP_PASSWORD, ENV_SEED_PASSWORD),
                )
    return 0


def _run_seed_cli() -> None:
    """Compatibility entry point for ``scripts/seed.py``."""

    raise SystemExit(main())


if __name__ == "__main__":
    raise SystemExit(main())
