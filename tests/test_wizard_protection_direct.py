"""Wizard-origin direct protection rules and runtime application."""

from __future__ import annotations

import pytest
from sqlalchemy.orm import Session

from app.protection.engine import protect_batch
from app.protection.models import PROTECTION_MODE_HASH, PROTECTION_MODE_PARTIAL_MASK, PROTECTION_MODE_TOKENIZATION, StreamProtectionRule
from app.protection.operator_workflow import upsert_protection_rule_direct, upsert_protection_rules_direct_bulk


@pytest.fixture
def vault_settings(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("app.config.settings.GDC_PROTECTION_ENABLED", True)
    monkeypatch.setattr("app.config.settings.GDC_PROTECTION_HASH_SALT", "test-salt")
    monkeypatch.setattr("app.config.settings.GDC_IDENTITY_VAULT_HASH_SALT", "test-vault-salt")


def _seed_stream(db_session: Session) -> int:
    from app.connectors.models import Connector
    from app.sources.models import Source
    from app.streams.models import Stream

    connector = Connector(name="wizard-prot-conn", description="", status="STOPPED")
    db_session.add(connector)
    db_session.flush()
    source = Source(
        connector_id=connector.id,
        source_type="HTTP_API_POLLING",
        config_json={},
        auth_json={},
        enabled=True,
    )
    db_session.add(source)
    db_session.flush()
    stream = Stream(
        connector_id=connector.id,
        source_id=source.id,
        name="wizard-protection-test",
        stream_type="HTTP_API_POLLING",
        config_json={},
        enabled=True,
        status="STOPPED",
    )
    db_session.add(stream)
    db_session.commit()
    return int(stream.id)


def test_upsert_direct_rule_without_finding(db_session: Session) -> None:
    stream_id = _seed_stream(db_session)
    rule, outcome = upsert_protection_rule_direct(
        db_session,
        stream_id=stream_id,
        field_path="$.email",
        sensitivity_class="pii",
        protection_mode=PROTECTION_MODE_PARTIAL_MASK,
        enabled=True,
        actor_username="wizard",
    )
    db_session.commit()
    assert outcome == "created"
    assert rule is not None
    assert rule.source_finding_id is None
    assert rule.created_by == "wizard"

    rule2, outcome2 = upsert_protection_rule_direct(
        db_session,
        stream_id=stream_id,
        field_path="$.email",
        sensitivity_class="pii",
        protection_mode=PROTECTION_MODE_HASH,
        enabled=True,
        actor_username="wizard",
    )
    db_session.commit()
    assert outcome2 == "updated"
    assert rule2 is not None
    assert rule2.id == rule.id
    assert rule2.protection_mode == PROTECTION_MODE_HASH


def test_case1_mapping_rename_partial_mask(
    db_session: Session,
    vault_settings: None,
) -> None:
    """$.user.email → email mapping; protect $.email with partial_mask."""
    stream_id = _seed_stream(db_session)
    upsert_protection_rule_direct(
        db_session,
        stream_id=stream_id,
        field_path="$.email",
        sensitivity_class="pii",
        protection_mode=PROTECTION_MODE_PARTIAL_MASK,
        enabled=True,
        actor_username="wizard",
    )
    db_session.commit()

    rules = db_session.query(StreamProtectionRule).filter_by(stream_id=stream_id).all()
    result = protect_batch([{"email": "user@test.com"}], rules, stream_id=stream_id, db=db_session)
    assert result.events[0]["email"] != "user@test.com"
    assert result.events[0]["email"].startswith("u***@")


def test_case2_pass_through_hash(
    db_session: Session,
    vault_settings: None,
) -> None:
    stream_id = _seed_stream(db_session)
    upsert_protection_rule_direct(
        db_session,
        stream_id=stream_id,
        field_path="$.email",
        sensitivity_class="pii",
        protection_mode=PROTECTION_MODE_HASH,
        enabled=True,
        actor_username="wizard",
    )
    db_session.commit()
    rules = db_session.query(StreamProtectionRule).filter_by(stream_id=stream_id).all()
    original = {"email": "user@test.com", "phone": "010"}
    result = protect_batch([original], rules, stream_id=stream_id, db=db_session)
    out = result.events[0]
    assert out["phone"] == "010"
    assert out["email"] != "user@test.com"
    assert isinstance(out["email"], str)
    assert out["email"].startswith("sha256:")


def test_case3_tokenize(
    db_session: Session,
    vault_settings: None,
) -> None:
    stream_id = _seed_stream(db_session)
    upsert_protection_rule_direct(
        db_session,
        stream_id=stream_id,
        field_path="$.credit_card",
        sensitivity_class="pii",
        protection_mode=PROTECTION_MODE_TOKENIZATION,
        enabled=True,
        actor_username="wizard",
    )
    db_session.commit()
    rules = db_session.query(StreamProtectionRule).filter_by(stream_id=stream_id).all()
    result = protect_batch(
        [{"credit_card": "4111111111111111"}],
        rules,
        stream_id=stream_id,
        db=db_session,
    )
    out = result.events[0]["credit_card"]
    assert out != "4111111111111111"
    assert isinstance(out, str)
    assert len(out) > 0


def test_case4_wizard_and_finding_rules_coexist(
    db_session: Session,
    vault_settings: None,
) -> None:
    from app.sensitive_detection.detection import persist_sensitive_hits
    from app.sensitive_detection.models import FINDING_STATUS_ACKNOWLEDGED, StreamSensitiveFinding
    from app.protection.operator_workflow import create_protection_rule

    stream_id = _seed_stream(db_session)
    upsert_protection_rule_direct(
        db_session,
        stream_id=stream_id,
        field_path="$.email",
        sensitivity_class="pii",
        protection_mode=PROTECTION_MODE_PARTIAL_MASK,
        enabled=True,
        actor_username="wizard",
    )
    db_session.commit()

    persist_sensitive_hits(db_session, stream_id=stream_id, events=[{"phone": "01012345678"}])
    db_session.commit()
    finding = db_session.query(StreamSensitiveFinding).filter_by(stream_id=stream_id).one()
    finding.status = FINDING_STATUS_ACKNOWLEDGED
    finding.confirm_run_count = 3
    db_session.commit()

    create_protection_rule(
        db_session,
        stream_id=stream_id,
        field_path=finding.field_path,
        sensitivity_class=finding.sensitivity_class,
        protection_mode=PROTECTION_MODE_HASH,
        source_finding_id=int(finding.id),
        enabled=True,
        actor_username="operator",
    )
    db_session.commit()

    rules = db_session.query(StreamProtectionRule).filter_by(stream_id=stream_id, enabled=True).all()
    assert len(rules) == 2
    result = protect_batch(
        [{"email": "user@test.com", "phone": "01012345678"}],
        rules,
        stream_id=stream_id,
        db=db_session,
    )
    out = result.events[0]
    assert out["email"] != "user@test.com"
    assert str(out["email"]).startswith("u***@")
    assert out["phone"] != "01012345678"
    assert str(out["phone"]).startswith("sha256:")


def test_bulk_upsert_direct_rules(db_session: Session) -> None:
    stream_id = _seed_stream(db_session)
    _rules, created, updated, skipped = upsert_protection_rules_direct_bulk(
        db_session,
        stream_id=stream_id,
        rules=[
            {
                "field_path": "$.email",
                "sensitivity_class": "pii",
                "protection_mode": PROTECTION_MODE_PARTIAL_MASK,
                "enabled": True,
            },
            {
                "field_path": "$.api_key",
                "sensitivity_class": "secret",
                "protection_mode": PROTECTION_MODE_HASH,
                "enabled": True,
            },
        ],
        actor_username="wizard",
    )
    db_session.commit()
    assert created == 2
    assert updated == 0
    assert skipped == []

    _rules2, created2, updated2, skipped2 = upsert_protection_rules_direct_bulk(
        db_session,
        stream_id=stream_id,
        rules=[
            {
                "field_path": "$.email",
                "sensitivity_class": "pii",
                "protection_mode": PROTECTION_MODE_HASH,
                "enabled": True,
            },
        ],
        actor_username="wizard",
    )
    db_session.commit()
    assert created2 == 0
    assert updated2 == 1
    assert skipped2 == []


def test_wizard_upsert_skips_existing_finding_rule(db_session: Session) -> None:
    from app.sensitive_detection.detection import persist_sensitive_hits
    from app.sensitive_detection.models import FINDING_STATUS_ACKNOWLEDGED, StreamSensitiveFinding
    from app.protection.operator_workflow import create_protection_rule, wizard_protection_skip_reason

    stream_id = _seed_stream(db_session)
    persist_sensitive_hits(db_session, stream_id=stream_id, events=[{"email": "user@test.com"}])
    db_session.commit()
    finding = db_session.query(StreamSensitiveFinding).filter_by(stream_id=stream_id).one()
    finding.status = FINDING_STATUS_ACKNOWLEDGED
    finding.confirm_run_count = 3
    db_session.commit()

    finding_rule = create_protection_rule(
        db_session,
        stream_id=stream_id,
        field_path=finding.field_path,
        sensitivity_class=finding.sensitivity_class,
        protection_mode=PROTECTION_MODE_HASH,
        source_finding_id=int(finding.id),
        enabled=True,
        actor_username="operator",
    )
    db_session.commit()

    rule, outcome = upsert_protection_rule_direct(
        db_session,
        stream_id=stream_id,
        field_path="$.email",
        sensitivity_class="pii",
        protection_mode=PROTECTION_MODE_PARTIAL_MASK,
        enabled=True,
        actor_username="wizard",
    )
    db_session.commit()
    assert outcome == "skipped"
    assert rule is not None
    assert rule.id == finding_rule.id
    assert rule.protection_mode == PROTECTION_MODE_HASH
    assert rule.source_finding_id == int(finding.id)
    assert rule.created_by == "operator"

    _rules, created, updated, skipped = upsert_protection_rules_direct_bulk(
        db_session,
        stream_id=stream_id,
        rules=[
            {
                "field_path": "$.email",
                "sensitivity_class": "pii",
                "protection_mode": PROTECTION_MODE_PARTIAL_MASK,
                "enabled": True,
            },
        ],
        actor_username="wizard",
    )
    db_session.commit()
    assert created == 0
    assert updated == 0
    assert len(skipped) == 1
    assert skipped[0]["field_path"] == "$.email"
    assert skipped[0]["reason"] == wizard_protection_skip_reason("$.email")
    assert skipped[0]["existing_rule_id"] == finding_rule.id
