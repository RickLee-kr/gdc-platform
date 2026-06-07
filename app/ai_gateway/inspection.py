"""Prompt inspection pipeline (read-only use of existing engines)."""

from __future__ import annotations

import time
from copy import deepcopy
from dataclasses import dataclass, field
from typing import Any

from sqlalchemy.orm import Session

from app.ai_gateway.policy_engine import GatewayPolicyBatchResult, evaluate_gateway_policies
from app.classification.engine import classify_batch, evaluate_batch as evaluate_classification_batch
from app.classification.field_keys import read_classification_level
from app.classification.levels import CLASSIFICATION_INTERNAL, normalize_level
from app.protection.policy_engine import evaluate_batch as evaluate_stream_policy_batch
from app.protection.service import protect_events_for_delivery
from app.sensitive_detection.detection import detect_hits_for_batch
from app.sensitive_detection.models import (
    DETECTION_METHOD_PATTERN,
    SENSITIVITY_CLASS_PII,
    SENSITIVITY_CLASS_SECRET,
)
from app.sensitive_detection.pattern_rules import email_pattern_match, pem_pattern_match
from app.sensitive_detection.path_rules import evaluate_field_name_rules


@dataclass
class PromptInspectionResult:
    classification_level: str = CLASSIFICATION_INTERNAL
    sensitivity_classes: list[str] = field(default_factory=list)
    finding_count: int = 0
    protection_applied: bool = False
    stream_policy_matched_count: int = 0
    gateway_policy: GatewayPolicyBatchResult = field(default_factory=GatewayPolicyBatchResult)
    protected_events: list[dict[str, Any]] = field(default_factory=list)
    processing_time_ms: int = 0
    prompt_text: str = ""
    metadata: dict[str, Any] = field(default_factory=dict)


def _prompt_event(prompt: str, metadata: dict[str, Any] | None) -> dict[str, Any]:
    meta: dict[str, Any] = {}
    if isinstance(metadata, dict):
        for key, value in metadata.items():
            if key in ("prompt",):
                continue
            meta[key] = value
    return {
        "prompt": prompt,
        "prompt_text": prompt,
        "metadata": meta,
    }


def _prompt_credential_shape(value: str) -> bool:
    stripped = value.strip()
    if len(stripped) < 10:
        return False
    if pem_pattern_match(stripped):
        return True
    if stripped.startswith("sk-") and len(stripped) >= 16:
        return True
    return False


def _append_prompt_body_pattern_findings(
    prompt: str,
    findings: list[dict[str, Any]],
    seen: set[tuple[str, str]],
) -> None:
    """Supplement findings with pattern hits on prompt body (reuses existing regex)."""

    if not prompt:
        return
    for path in ("$.prompt", "$.prompt_text"):
        if pem_pattern_match(prompt):
            key = (path, SENSITIVITY_CLASS_SECRET)
            if key not in seen:
                seen.add(key)
                findings.append(
                    {
                        "field_path": path,
                        "inferred_type": "string",
                        "sensitivity_class": SENSITIVITY_CLASS_SECRET,
                        "detection_method": DETECTION_METHOD_PATTERN,
                        "matched_rule": "pattern.pem",
                        "matched_segment": "prompt_text",
                        "pattern": "pem",
                    }
                )
            return
        if email_pattern_match(prompt):
            key = (path, SENSITIVITY_CLASS_PII)
            if key not in seen:
                seen.add(key)
                findings.append(
                    {
                        "field_path": path,
                        "inferred_type": "string",
                        "sensitivity_class": SENSITIVITY_CLASS_PII,
                        "detection_method": DETECTION_METHOD_PATTERN,
                        "matched_rule": "pattern.email",
                        "matched_segment": "prompt_text",
                        "pattern": "email",
                    }
                )
            return
        if _prompt_credential_shape(prompt):
            api_key_hits = evaluate_field_name_rules("$.api_key")
            if api_key_hits:
                key = (path, SENSITIVITY_CLASS_SECRET)
                if key not in seen:
                    seen.add(key)
                    hit = api_key_hits[0]
                    findings.append(
                        {
                            "field_path": path,
                            "inferred_type": "string",
                            "sensitivity_class": SENSITIVITY_CLASS_SECRET,
                            "detection_method": hit.get("detection_method", "field_name"),
                            "matched_rule": hit.get("matched_rule", "secret.leaf.api_key"),
                            "matched_segment": hit.get("matched_segment", "api_key"),
                        }
                    )
            return


def _sensitivity_classes(findings: list[dict[str, Any]]) -> list[str]:
    classes: list[str] = []
    seen: set[str] = set()
    for item in findings:
        if not isinstance(item, dict):
            continue
        raw = item.get("sensitivity_class")
        if raw is None:
            continue
        key = str(raw)
        if key in seen:
            continue
        seen.add(key)
        classes.append(key)
    return classes


def inspect_prompt(
    db: Session | None,
    *,
    prompt: str,
    metadata: dict[str, Any] | None = None,
) -> PromptInspectionResult:
    """Run sensitive detection, classification, protection, and gateway policy."""

    started = time.monotonic()
    meta = metadata if isinstance(metadata, dict) else {}
    stream_id_raw = meta.get("stream_id")
    stream_id = int(stream_id_raw) if stream_id_raw is not None else None

    event = _prompt_event(prompt, meta)
    events = [deepcopy(event)]

    findings = detect_hits_for_batch(events)
    seen_keys: set[tuple[str, str]] = set()
    for item in findings:
        if isinstance(item, dict):
            fp = item.get("field_path")
            sc = item.get("sensitivity_class")
            if fp is not None and sc is not None:
                seen_keys.add((str(fp), str(sc)))
    _append_prompt_body_pattern_findings(prompt, findings, seen_keys)

    if stream_id is not None and db is not None:
        classification = evaluate_classification_batch(
            db,
            stream_id=stream_id,
            events=events,
            findings=findings,
        )
    else:
        classification = classify_batch(events, stream_id=0, rules=[], findings=findings)
    if classification.events_classified:
        level = normalize_level(str(classification.classification_level)) or CLASSIFICATION_INTERNAL
    else:
        level = normalize_level(read_classification_level(event)) or CLASSIFICATION_INTERNAL

    delivery_events, protect_result = protect_events_for_delivery(
        db,
        stream_id=stream_id or 0,
        enriched_events=events,
    )
    protection_applied = int(protect_result.masked_field_applications or 0) > 0

    stream_policy_matched = 0
    if stream_id is not None and db is not None:
        stream_policy = evaluate_stream_policy_batch(
            db,
            stream_id=stream_id,
            events=events,
            findings=findings,
        )
        stream_policy_matched = int(stream_policy.matched_policy_count or 0)

    gateway_result = evaluate_gateway_policies(
        db,
        classification_level=level,
        findings=findings,
    )

    duration_ms = max(0, int((time.monotonic() - started) * 1000))
    return PromptInspectionResult(
        classification_level=level,
        sensitivity_classes=_sensitivity_classes(findings),
        finding_count=len(findings),
        protection_applied=protection_applied,
        stream_policy_matched_count=stream_policy_matched,
        gateway_policy=gateway_result,
        protected_events=delivery_events,
        processing_time_ms=duration_ms,
        prompt_text=prompt,
        metadata=dict(event.get("metadata") or {}),
    )
