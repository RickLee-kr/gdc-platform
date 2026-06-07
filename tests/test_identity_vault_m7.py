"""M7 Identity Vault — tokenization, security, runtime, preview, API."""

from __future__ import annotations

import pytest
from sqlalchemy.orm import Session

from app.protection.engine import apply_rule_to_event, protect_batch
from app.protection.identity_vault import (
    build_vault_summary,
    get_or_create_token,
    hash_original_value,
)
from app.protection.models import IdentityVaultEntry, StreamProtectionRule
from app.protection.operator_workflow import build_protection_summary
from app.runtime.preview_service import run_final_event_draft_preview
from app.runtime.schemas import FinalEventDraftPreviewRequest
from tests.test_stream_runner_e2e import (
    _FakePoller,
    _FakeWebhookSender,
    _build_runner,
    _seed_stream_runtime,
)
from app.runners.stream_loader import load_stream_context


@pytest.fixture
def vault_settings(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("app.config.settings.GDC_PROTECTION_ENABLED", True)
    monkeypatch.setattr("app.config.settings.GDC_PROTECTION_HASH_SALT", "test-protection-salt")
    monkeypatch.setattr("app.config.settings.GDC_IDENTITY_VAULT_HASH_SALT", "test-vault-salt")


def test_same_value_same_token(db_session: Session, vault_settings: None) -> None:
    db = db_session
    fixture = _seed_stream_runtime(db)
    stream_id = fixture["stream_id"]
    t1 = get_or_create_token(db, stream_id=stream_id, field_path="$.email", original_value="john@company.com")
    t2 = get_or_create_token(db, stream_id=stream_id, field_path="$.email", original_value="john@company.com")
    assert t1 == t2
    assert t1.startswith("USER_")


def test_different_value_different_token(db_session: Session, vault_settings: None) -> None:
    db = db_session
    fixture = _seed_stream_runtime(db)
    stream_id = fixture["stream_id"]
    t1 = get_or_create_token(db, stream_id=stream_id, field_path="$.email", original_value="john@company.com")
    t2 = get_or_create_token(db, stream_id=stream_id, field_path="$.email", original_value="alice@company.com")
    assert t1 != t2


def test_global_sequence_not_per_stream(db_session: Session, vault_settings: None) -> None:
    db = db_session
    f1 = _seed_stream_runtime(db)
    f2 = _seed_stream_runtime(db)
    t1 = get_or_create_token(db, stream_id=f1["stream_id"], field_path="$.a", original_value="one")
    t2 = get_or_create_token(db, stream_id=f2["stream_id"], field_path="$.b", original_value="two")
    assert int(t1.split("_")[1]) < int(t2.split("_")[1])


def test_db_never_stores_plaintext(db_session: Session, vault_settings: None) -> None:
    db = db_session
    fixture = _seed_stream_runtime(db)
    stream_id = fixture["stream_id"]
    secret = "john@company.com"
    get_or_create_token(db, stream_id=stream_id, field_path="$.email", original_value=secret)
    db.commit()
    rows = db.query(IdentityVaultEntry).filter(IdentityVaultEntry.stream_id == stream_id).all()
    assert len(rows) >= 1
    expected_hash = hash_original_value(stream_id=stream_id, field_path="$.email", original_value=secret)
    for row in rows:
        assert row.original_value_hash == expected_hash
        assert secret not in (row.field_path or "")
        assert secret not in str(row.token_value)
        assert secret not in row.original_value_hash


def test_runtime_tokenization(db_session: Session, vault_settings: None) -> None:
    db = db_session
    fixture = _seed_stream_runtime(db)
    stream_id = fixture["stream_id"]
    email = "john@company.com"

    from app.mappings.models import Mapping

    mapping = db.query(Mapping).filter_by(stream_id=stream_id).one()
    mapping.field_mappings_json = {**dict(mapping.field_mappings_json or {}), "email": "$.email"}
    db.flush()
    db.add(
        StreamProtectionRule(
            stream_id=stream_id,
            field_path="$.email",
            sensitivity_class="pii",
            protection_mode="tokenization",
            enabled=True,
            created_by="test",
        )
    )
    db.commit()

    poller = _FakePoller(
        response={"items": [{"id": "e1", "email": email, "message": "hi", "vendor": "v"}]}
    )
    sender = _FakeWebhookSender()
    runner = _build_runner(poller=poller, webhook_sender=sender)
    ctx = load_stream_context(db, stream_id)
    runner.run(ctx, db=db)
    assert sender.calls
    delivered = sender.calls[0]["events"][0]
    assert delivered["email"] != email
    assert str(delivered["email"]).startswith("USER_")
    token2 = get_or_create_token(db, stream_id=stream_id, field_path="$.email", original_value=email)
    assert delivered["email"] == token2


def test_preview_tokenization_repeatable_token(db_session: Session, vault_settings: None) -> None:
    db = db_session
    fixture = _seed_stream_runtime(db)
    stream_id = fixture["stream_id"]
    db.add(
        StreamProtectionRule(
            stream_id=stream_id,
            field_path="$.email",
            sensitivity_class="pii",
            protection_mode="tokenization",
            enabled=True,
            created_by="test",
        )
    )
    db.commit()
    email = "repeat@company.com"
    req = FinalEventDraftPreviewRequest(
        stream_id=stream_id,
        payload={"email": email},
        field_mappings={"email": "$.email"},
        max_events=1,
    )
    r1 = run_final_event_draft_preview(req, db=db)
    r2 = run_final_event_draft_preview(req, db=db)
    assert r1.final_events[0]["email"] == r2.final_events[0]["email"]
    assert str(r1.final_events[0]["email"]).startswith("USER_")


def test_preview_tokenization(db_session: Session, vault_settings: None) -> None:
    db = db_session
    fixture = _seed_stream_runtime(db)
    stream_id = fixture["stream_id"]
    db.add(
        StreamProtectionRule(
            stream_id=stream_id,
            field_path="$.email",
            sensitivity_class="pii",
            protection_mode="tokenization",
            enabled=True,
            created_by="test",
        )
    )
    db.commit()
    email = "preview@company.com"
    resp = run_final_event_draft_preview(
        FinalEventDraftPreviewRequest(
            stream_id=stream_id,
            payload={"email": email},
            field_mappings={"email": "$.email"},
            max_events=1,
        ),
        db=db,
    )
    assert resp.final_events[0]["email"] != email
    assert str(resp.final_events[0]["email"]).startswith("USER_")


def test_protect_batch_tokenization_stable(db_session: Session, vault_settings: None) -> None:
    db = db_session
    fixture = _seed_stream_runtime(db)
    stream_id = fixture["stream_id"]
    rule = StreamProtectionRule(
        stream_id=stream_id,
        field_path="$.email",
        sensitivity_class="pii",
        protection_mode="tokenization",
        enabled=True,
        created_by="test",
    )
    db.add(rule)
    db.commit()
    events = [{"email": "a@x.com"}, {"email": "b@x.com"}, {"email": "a@x.com"}]
    out = protect_batch(events, [rule], stream_id=stream_id, db=db)
    assert out.events[0]["email"] == out.events[2]["email"]
    assert out.events[0]["email"] != out.events[1]["email"]


def test_build_protection_summary_vault_counts(db_session: Session, vault_settings: None) -> None:
    db = db_session
    fixture = _seed_stream_runtime(db)
    stream_id = fixture["stream_id"]
    get_or_create_token(db, stream_id=stream_id, field_path="$.email", original_value="x@y.z")
    db.add(
        StreamProtectionRule(
            stream_id=stream_id,
            field_path="$.email",
            sensitivity_class="pii",
            protection_mode="tokenization",
            enabled=True,
            created_by="test",
        )
    )
    db.commit()
    summary = build_protection_summary(db, stream_id)
    assert summary["tokenization_count"] == 1
    assert summary["vault_entry_count"] == 1


def test_vault_summary_api_shape(db_session: Session, vault_settings: None) -> None:
    db = db_session
    fixture = _seed_stream_runtime(db)
    get_or_create_token(db, stream_id=fixture["stream_id"], field_path="$.u", original_value="u1")
    db.commit()
    payload = build_vault_summary(db)
    assert payload["vault_entries"] >= 1
    assert payload["stream_count"] >= 1
    assert "last_created_at" in payload
    assert "john@company.com" not in str(payload)


def test_apply_rule_tokenization_requires_db() -> None:
    rule = StreamProtectionRule(
        stream_id=1,
        field_path="$.email",
        sensitivity_class="pii",
        protection_mode="tokenization",
        enabled=True,
        created_by="test",
    )
    event = {"email": "a@b.c"}
    count, warn = apply_rule_to_event(event, rule, db=None)
    assert count == 0
    assert warn is not None
