"""Full-event JSONata / regex mapping — preview and runtime."""

from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient

from app.mappers.full_event_mapping import (
    apply_full_event_jsonata_mapping,
    apply_full_event_mapping,
    apply_full_event_regex_mapping,
)
from app.mappers.mapper import apply_mapping, apply_mappings_with_results
from app.runtime.preview_service import run_transform_preview
from app.runtime.schemas import TransformPreviewRequest

SAMPLE_EVENT = {
    "creationTime": 1673933930200,
    "locale": None,
    "locked": False,
    "groups": [],
    "roles": [
        "executive",
        "user_admin",
        "policies_admin",
        "sys_admin",
        "analyst_l3",
        "responder_l2",
    ],
    "username": "adminuser@mec.ph",
    "lastUpdateTime": 1741571680329,
    "totpEnabled": False,
    "isDailyNotifications": False,
    "totpSid": None,
    "investigationViewConfig": None,
    "changePasswordOnNextLogin": False,
    "allowedLoginMethod": "PASSWORD",
    "userClassification": None,
}

JSONATA_EXPRESSION = """{
  "timestamp": creationTime,
  "event_type": "user_account",
  "user": username,
  "domain": $split(username, "@")[1],
  "auth_method": allowedLoginMethod,
  "roles": roles,
  "role_count": $count(roles),
  "account_locked": locked,
  "mfa_enabled": totpEnabled
}"""

REGEX_CONFIG = {
    "mapping_mode": "full_event_regex",
    "preserve_source_fields": False,
    "regex_rules": [
        {
            "output_field": "user",
            "source_path": "$.username",
            "pattern": "^([^@]+)@(.+)$",
            "capture_group": 1,
            "default_value": "unknown_user",
        },
        {
            "output_field": "domain",
            "source_path": "$.username",
            "pattern": "^([^@]+)@(.+)$",
            "capture_group": 2,
            "default_value": "unknown_domain",
        },
        {
            "output_field": "auth_method",
            "source_path": "$.allowedLoginMethod",
            "pattern": "^(.*)$",
            "capture_group": 1,
            "default_value": "UNKNOWN",
        },
        {
            "output_field": "primary_admin_role",
            "source_path": "$.roles",
            "pattern": "(sys_admin|user_admin|policies_admin)",
            "capture_group": 1,
            "default_value": "standard_user",
        },
    ],
}


@pytest.fixture
def jsonata_available() -> None:
    pytest.importorskip("jsonata")


def test_full_event_jsonata_mapping(jsonata_available: None) -> None:
    field_mappings = {
        "mapping_mode": "full_event_jsonata",
        "jsonata_expression": JSONATA_EXPRESSION,
    }
    mapped, errors, warnings = apply_full_event_jsonata_mapping(SAMPLE_EVENT, field_mappings)
    assert errors == []
    assert warnings == []
    assert mapped["timestamp"] == 1673933930200
    assert mapped["event_type"] == "user_account"
    assert mapped["user"] == "adminuser@mec.ph"
    assert mapped["domain"] == "mec.ph"
    assert mapped["auth_method"] == "PASSWORD"
    assert mapped["role_count"] == 6
    assert mapped["account_locked"] is False
    assert mapped["mfa_enabled"] is False


def test_full_event_regex_mapping() -> None:
    mapped, errors, warnings = apply_full_event_regex_mapping(SAMPLE_EVENT, REGEX_CONFIG)
    assert errors == []
    assert warnings == []
    assert mapped == {
        "user": "adminuser",
        "domain": "mec.ph",
        "auth_method": "PASSWORD",
        "primary_admin_role": "user_admin",
    }


def test_apply_mapping_does_not_treat_mapping_mode_as_jsonpath() -> None:
    """Regression: mapping_mode must not be projected via JSONPath (was {\"mapping_mode\": null})."""

    mapped = apply_mapping(SAMPLE_EVENT, REGEX_CONFIG)
    assert "mapping_mode" not in mapped
    assert mapped["user"] == "adminuser"


def test_apply_mappings_with_results_full_event_regex() -> None:
    results = apply_mappings_with_results([SAMPLE_EVENT], REGEX_CONFIG)
    assert len(results) == 1
    assert results[0].ok
    assert results[0].mapped_event["domain"] == "mec.ph"


def test_transform_preview_full_event_regex() -> None:
    res = run_transform_preview(
        TransformPreviewRequest(
            stage="mapping",
            sample_event=SAMPLE_EVENT,
            field_mappings=REGEX_CONFIG,
        )
    )
    assert res.errors == []
    assert res.save_blocked is False
    assert res.transformed_result["user"] == "adminuser"
    assert res.transformed_result["primary_admin_role"] == "user_admin"


def test_transform_preview_full_event_jsonata(jsonata_available: None) -> None:
    res = run_transform_preview(
        TransformPreviewRequest(
            stage="mapping",
            sample_event=SAMPLE_EVENT,
            field_mappings={
                "mapping_mode": "full_event_jsonata",
                "jsonata_expression": JSONATA_EXPRESSION,
            },
        )
    )
    assert res.errors == []
    assert res.save_blocked is False
    assert res.transformed_result["domain"] == "mec.ph"
    assert res.transformed_result["role_count"] == 6


def test_transform_preview_http_endpoint(jsonata_available: None) -> None:
    from app.main import app

    client = TestClient(app)
    r = client.post(
        "/api/v1/runtime/preview/transform",
        json={
            "stage": "mapping",
            "sample_event": SAMPLE_EVENT,
            "field_mappings": REGEX_CONFIG,
        },
    )
    assert r.status_code == 200
    body = r.json()
    assert body["transformed_result"]["domain"] == "mec.ph"
    assert body["errors"] == []
