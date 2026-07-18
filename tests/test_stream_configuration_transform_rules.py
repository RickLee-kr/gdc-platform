"""Configuration API coverage for Transform Rule section mapping."""

from __future__ import annotations

from typing import Any

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.enrichments.models import Enrichment
from tests.test_stream_runner_e2e import _seed_stream_runtime


def _section_by_title(body: dict[str, Any], title: str) -> dict[str, Any]:
    for section in body.get("sections") or []:
        if section.get("title") == title:
            return section
    raise AssertionError(f"missing section {title!r}; titles={[s.get('title') for s in body.get('sections') or []]}")


def _field_map(section: dict[str, Any]) -> dict[str, str]:
    """Map label -> value; later duplicates overwrite (last rule wins for simple asserts)."""

    out: dict[str, str] = {}
    for field in section.get("fields") or []:
        out[str(field["label"])] = str(field["value"])
    return out


def _field_values(section: dict[str, Any], label: str) -> list[str]:
    return [str(f["value"]) for f in section.get("fields") or [] if f.get("label") == label]


def _set_enrichment_rules(db: Session, stream_id: int, rules: dict[str, Any], *, legacy: dict[str, Any] | None = None) -> None:
    row = db.query(Enrichment).filter(Enrichment.stream_id == stream_id).one()
    payload: dict[str, Any] = dict(legacy or {})
    payload["__rules"] = rules
    row.enrichment_json = payload
    db.add(row)
    db.commit()


def test_configuration_api_returns_all_transform_rule_types(
    runtime_api_client: TestClient,
    db_session: Session,
) -> None:
    fixture = _seed_stream_runtime(db_session)
    stream_id = int(fixture["stream_id"])
    _set_enrichment_rules(
        db_session,
        stream_id,
        {
            "event_time_utc": {
                "type": "timestamp_conversion",
                "enabled": True,
                "source_field": "event_time",
                "input_format": "unix_ms",
                "output_format": "utc_iso8601",
                "timezone": {"mode": "custom", "iana": "Asia/Seoul"},
                "on_failure": "set_null",
            },
            "severity_int": {
                "type": "type_conversion",
                "enabled": True,
                "source_field": "severity",
                "target_type": "integer",
                "on_failure": "keep_original",
            },
            "email_norm": {
                "type": "normalize",
                "enabled": True,
                "source_field": "raw_email",
                "operation": "normalize_email",
                "on_failure": "keep_original",
            },
            "host_copy": {
                "type": "jsonata",
                "enabled": True,
                "template": "copy_field",
                "template_params": {"source_field": "hostname"},
                "target_field": "host_copy",
                "expression": "hostname",
                "advanced_override": False,
            },
        },
        legacy={"vendor": "legacy-static"},
    )

    res = runtime_api_client.get(f"/api/v1/runtime/streams/{stream_id}/configuration")
    assert res.status_code == 200
    body = res.json()

    ts = _field_map(_section_by_title(body, "Timestamp Conversion"))
    assert ts["Source Field"] == "event_time"
    assert ts["Target Field"] == "event_time_utc"
    assert ts["Input Format"] == "unix_ms"
    assert ts["Output Format"] == "utc_iso8601"
    assert ts["Timezone"] == "custom:Asia/Seoul"
    assert ts["On Failure"] == "set_null"
    assert ts["Enabled"] == "true"

    tc = _field_map(_section_by_title(body, "Type Conversion"))
    assert tc["Source Field"] == "severity"
    assert tc["Target Field"] == "severity_int"
    assert tc["Target Type"] == "integer"
    assert tc["On Failure"] == "keep_original"
    assert tc["Enabled"] == "true"

    norm = _field_map(_section_by_title(body, "Normalize"))
    assert norm["Source Field"] == "raw_email"
    assert norm["Target Field"] == "email_norm"
    assert norm["Operation"] == "normalize_email"
    assert norm["On Failure"] == "keep_original"
    assert norm["Enabled"] == "true"

    jt = _field_map(_section_by_title(body, "JSONata Template"))
    assert jt["Template"] == "copy_field"
    assert "hostname" in jt["Template Params"]
    assert jt["Target Field"] == "host_copy"
    assert jt["Generated Expression"] == "hostname"
    assert jt["Expression"] == "hostname"
    assert jt["Advanced Override"] == "false"
    assert jt["Enabled"] == "true"

    transform = _field_map(_section_by_title(body, "Transform"))
    assert transform.get("Enrichment") == "enabled"


def test_configuration_api_skips_disabled_rules_and_keeps_legacy_keys(
    runtime_api_client: TestClient,
    db_session: Session,
) -> None:
    fixture = _seed_stream_runtime(db_session)
    stream_id = int(fixture["stream_id"])
    _set_enrichment_rules(
        db_session,
        stream_id,
        {
            "active_ts": {
                "type": "timestamp_conversion",
                "enabled": True,
                "tsSourceField": "created",
                "tsInputFormat": "iso8601",
                "tsOutputFormat": "unix_s",
                "tsTimezoneMode": "utc",
                "tsOnFailure": "keep_original",
            },
            "disabled_ts": {
                "type": "timestamp_conversion",
                "enabled": False,
                "source_field": "should_not_appear",
                "input_format": "unix_s",
                "output_format": "utc_iso8601",
                "timezone": "utc",
                "on_failure": "set_null",
            },
            "disabled_tc": {
                "type": "type_conversion",
                "enabled": False,
                "source_field": "hidden",
                "target_type": "boolean",
                "on_failure": "set_null",
            },
        },
        legacy={"product": "GDC-LEGACY"},
    )

    res = runtime_api_client.get(f"/api/v1/runtime/streams/{stream_id}/configuration")
    assert res.status_code == 200
    body = res.json()

    ts_targets = _field_values(_section_by_title(body, "Timestamp Conversion"), "Target Field")
    assert ts_targets == ["active_ts"]
    ts = _field_map(_section_by_title(body, "Timestamp Conversion"))
    assert ts["Source Field"] == "created"
    assert "should_not_appear" not in ts.values()

    tc = _section_by_title(body, "Type Conversion")
    assert _field_map(tc).get("Rules") == "Not configured"

    transform = _field_map(_section_by_title(body, "Transform"))
    assert transform.get("Enrichment") == "enabled"
    # Legacy static keys remain stored; Configuration still loads without treating them as typed rules.
    row = db_session.query(Enrichment).filter(Enrichment.stream_id == stream_id).one()
    assert (row.enrichment_json or {}).get("product") == "GDC-LEGACY"


def test_configuration_api_empty_transform_rule_sections(
    runtime_api_client: TestClient,
    db_session: Session,
) -> None:
    fixture = _seed_stream_runtime(db_session)
    stream_id = int(fixture["stream_id"])
    # Seed only static enrichment (no __rules)
    row = db_session.query(Enrichment).filter(Enrichment.stream_id == stream_id).one()
    row.enrichment_json = {"vendor": "only-static"}
    db_session.add(row)
    db_session.commit()

    res = runtime_api_client.get(f"/api/v1/runtime/streams/{stream_id}/configuration")
    assert res.status_code == 200
    body = res.json()
    for title in ("Timestamp Conversion", "Type Conversion", "Normalize", "JSONata Template"):
        section = _section_by_title(body, title)
        fields = _field_map(section)
        assert fields.get("Rules") == "Not configured"
