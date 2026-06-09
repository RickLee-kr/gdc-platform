"""Prompt and response inspection for AI policy enforcement (M22)."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

from sqlalchemy.orm import Session

from app.ai_gateway.inspection import _append_prompt_body_pattern_findings, _prompt_credential_shape
from app.protection.policy_engine import (
    AiPolicyBatchResult,
    evaluate_ai_prompt_policy,
    evaluate_ai_response_policy,
)
from app.sensitive_detection.detection import detect_hits_for_batch
from app.sensitive_detection.models import (
    DETECTION_METHOD_PATTERN,
    SENSITIVITY_CLASS_PII,
    SENSITIVITY_CLASS_SECRET,
)
from app.sensitive_detection.pattern_rules import pem_pattern_match

_EMBEDDED_EMAIL_RE = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")


@dataclass
class AiInspectionResult:
    target: str
    text: str
    finding_count: int = 0
    policy: AiPolicyBatchResult = field(default_factory=AiPolicyBatchResult)
    findings: list[dict[str, Any]] = field(default_factory=list)


def _message_text(messages: Any) -> str:
    if not isinstance(messages, list):
        return ""
    parts: list[str] = []
    for message in messages:
        if not isinstance(message, dict):
            continue
        content = message.get("content")
        if isinstance(content, str) and content.strip():
            parts.append(content.strip())
    return "\n".join(parts)


def extract_prompt_text(provider_request: dict[str, Any]) -> str:
    messages = provider_request.get("messages")
    if isinstance(messages, list):
        text = _message_text(messages)
        if text:
            return text
    prompt = provider_request.get("prompt")
    if isinstance(prompt, str):
        return prompt
    return ""


def extract_response_text(provider_response: dict[str, Any]) -> str:
    content = provider_response.get("content")
    if isinstance(content, str) and content.strip():
        return content.strip()
    choices = provider_response.get("choices")
    if isinstance(choices, list):
        parts: list[str] = []
        for choice in choices:
            if not isinstance(choice, dict):
                continue
            message = choice.get("message")
            if isinstance(message, dict):
                msg_content = message.get("content")
                if isinstance(msg_content, str) and msg_content.strip():
                    parts.append(msg_content.strip())
        if parts:
            return "\n".join(parts)
    return ""


def _embedded_text_findings(text: str, *, field_path: str) -> list[dict[str, Any]]:
    findings: list[dict[str, Any]] = []
    if not text:
        return findings
    if _EMBEDDED_EMAIL_RE.search(text):
        findings.append(
            {
                "field_path": field_path,
                "inferred_type": "string",
                "sensitivity_class": SENSITIVITY_CLASS_PII,
                "detection_method": DETECTION_METHOD_PATTERN,
                "matched_rule": "pattern.email",
                "matched_segment": "prompt_text",
                "pattern": "email",
            }
        )
    if pem_pattern_match(text):
        findings.append(
            {
                "field_path": field_path,
                "inferred_type": "string",
                "sensitivity_class": SENSITIVITY_CLASS_SECRET,
                "detection_method": DETECTION_METHOD_PATTERN,
                "matched_rule": "pattern.pem",
                "matched_segment": "prompt_text",
                "pattern": "pem",
            }
        )
    if _prompt_credential_shape(text):
        findings.append(
            {
                "field_path": field_path,
                "inferred_type": "string",
                "sensitivity_class": SENSITIVITY_CLASS_SECRET,
                "detection_method": DETECTION_METHOD_PATTERN,
                "matched_rule": "pattern.api_key",
                "matched_segment": "prompt_text",
                "pattern": "api_key",
            }
        )
    return findings


def _collect_findings(text: str, *, field_path: str) -> list[dict[str, Any]]:
    event = {"prompt_text": text, "response_text": text, field_path.replace("$.", ""): text}
    findings = detect_hits_for_batch([event])
    seen: set[tuple[str, str]] = set()
    for item in findings:
        if isinstance(item, dict):
            fp = item.get("field_path")
            sc = item.get("sensitivity_class")
            if fp is not None and sc is not None:
                seen.add((str(fp), str(sc)))
    _append_prompt_body_pattern_findings(text, findings, seen)
    for item in _embedded_text_findings(text, field_path=field_path):
        key = (str(item.get("field_path")), str(item.get("sensitivity_class")))
        if key not in seen:
            seen.add(key)
            findings.append(item)
    normalized: list[dict[str, Any]] = []
    for item in findings:
        if not isinstance(item, dict):
            continue
        row = dict(item)
        row["field_path"] = field_path
        normalized.append(row)
    return normalized


def inspect_prompt(
    db: Session | None,
    *,
    ai_stream_id: int,
    provider_request: dict[str, Any],
) -> AiInspectionResult:
    text = extract_prompt_text(provider_request)
    findings = _collect_findings(text, field_path="$.prompt_text")
    policy = evaluate_ai_prompt_policy(
        db,
        ai_stream_id=ai_stream_id,
        text=text,
        findings=findings,
    )
    return AiInspectionResult(
        target="prompt",
        text=text,
        finding_count=len(findings),
        policy=policy,
        findings=findings,
    )


def inspect_response(
    db: Session | None,
    *,
    ai_stream_id: int,
    provider_response: dict[str, Any],
) -> AiInspectionResult:
    text = extract_response_text(provider_response)
    findings = _collect_findings(text, field_path="$.response_text")
    policy = evaluate_ai_response_policy(
        db,
        ai_stream_id=ai_stream_id,
        text=text,
        findings=findings,
    )
    return AiInspectionResult(
        target="response",
        text=text,
        finding_count=len(findings),
        policy=policy,
        findings=findings,
    )
