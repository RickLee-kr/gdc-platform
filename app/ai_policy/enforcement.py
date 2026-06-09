"""Apply AI policy enforcement actions (M22)."""

from __future__ import annotations

import re
from copy import deepcopy
from typing import Any

from sqlalchemy.orm import Session

from app.ai_policy.errors import AiPolicyEnforcementError
from app.ai_policy.inspection import (
    AiInspectionResult,
    inspect_prompt,
    inspect_response,
)
from app.ai_policy.models import (
    AI_POLICY_ACTION_BLOCK,
    AI_POLICY_ACTION_DENY,
    AI_POLICY_ACTION_MASK,
    AI_POLICY_ACTION_REDACT,
    AI_POLICY_BLOCKING_ACTIONS,
    AI_POLICY_INSPECTION_KEYWORD,
    AI_POLICY_INSPECTION_REGEX,
    AiPolicyRule,
)
from app.protection.modes import partial_mask_value
from app.protection.policy_engine import AiPolicyMatch


def _top_match(inspection: AiInspectionResult) -> AiPolicyMatch | None:
    decision = str(inspection.policy.decision)
    if decision not in inspection.policy.matched_policies and inspection.policy.matched_policies:
        for item in inspection.policy.matched_policies:
            if str(item.action_type) == decision:
                return item
    for item in inspection.policy.matched_policies:
        if str(item.action_type) == decision:
            return item
    if inspection.policy.matched_policies:
        return inspection.policy.matched_policies[-1]
    return None


def _transform_text(
    text: str,
    *,
    action: str,
    inspection: AiInspectionResult,
    db: Session | None,
    ai_stream_id: int,
) -> str:
    if not text:
        return text
    updated = text
    if db is not None:
        from sqlalchemy import select

        rule_ids = [int(m.policy_id) for m in inspection.policy.matched_policies]
        rules = list(
            db.execute(select(AiPolicyRule).where(AiPolicyRule.id.in_(rule_ids))).scalars()
        ) if rule_ids else []
        rule_by_id = {int(r.id): r for r in rules}
    else:
        rule_by_id = {}

    for match in inspection.policy.matched_policies:
        action_type = str(match.action_type)
        if action_type not in {AI_POLICY_ACTION_MASK, AI_POLICY_ACTION_REDACT}:
            continue
        rule = rule_by_id.get(int(match.policy_id))
        condition = dict(rule.condition_json) if rule and isinstance(rule.condition_json, dict) else {}
        inspection_type = str(match.inspection_type)
        replacement = "[REDACTED]" if action_type == AI_POLICY_ACTION_REDACT else str(partial_mask_value(updated))
        if inspection_type == AI_POLICY_INSPECTION_REGEX:
            pattern = str(condition.get("pattern") or "")
            if pattern:
                flags = re.IGNORECASE if bool(condition.get("ignore_case", True)) else 0
                try:
                    if action_type == AI_POLICY_ACTION_MASK:
                        updated = re.sub(pattern, lambda _m: str(partial_mask_value(_m.group(0))), updated, flags=flags)
                    else:
                        updated = re.sub(pattern, replacement, updated, flags=flags)
                except re.error:
                    continue
        elif inspection_type == AI_POLICY_INSPECTION_KEYWORD:
            keyword = str(condition.get("keyword") or "")
            if not keyword:
                continue
            if bool(condition.get("ignore_case", True)):
                idx = updated.lower().find(keyword.lower())
            else:
                idx = updated.find(keyword)
            if idx >= 0:
                end = idx + len(keyword)
                segment = updated[idx:end]
                if action_type == AI_POLICY_ACTION_MASK:
                    updated = updated[:idx] + str(partial_mask_value(segment)) + updated[end:]
                else:
                    updated = updated[:idx] + replacement + updated[end:]
        else:
            if action_type == AI_POLICY_ACTION_MASK:
                updated = str(partial_mask_value(updated))
            else:
                updated = replacement
    if updated == text and action in {AI_POLICY_ACTION_MASK, AI_POLICY_ACTION_REDACT}:
        updated = str(partial_mask_value(text)) if action == AI_POLICY_ACTION_MASK else "[REDACTED]"
    _ = ai_stream_id
    return updated


def _apply_prompt_text(provider_request: dict[str, Any], new_text: str) -> dict[str, Any]:
    out = deepcopy(provider_request)
    messages = out.get("messages")
    if isinstance(messages, list) and messages:
        for message in reversed(messages):
            if isinstance(message, dict) and isinstance(message.get("content"), str):
                message["content"] = new_text
                return out
    out["prompt"] = new_text
    return out


def _apply_response_text(provider_response: dict[str, Any], new_text: str) -> dict[str, Any]:
    out = deepcopy(provider_response)
    if isinstance(out.get("content"), str):
        out["content"] = new_text
        return out
    choices = out.get("choices")
    if isinstance(choices, list):
        for choice in choices:
            if not isinstance(choice, dict):
                continue
            message = choice.get("message")
            if isinstance(message, dict):
                message["content"] = new_text
                return out
    out["content"] = new_text
    return out


def _enforce_inspection(
    inspection: AiInspectionResult,
    *,
    db: Session | None,
    ai_stream_id: int,
    payload: dict[str, Any],
    apply_text_fn,
) -> dict[str, Any]:
    decision = str(inspection.policy.decision)
    if decision in AI_POLICY_BLOCKING_ACTIONS:
        top = _top_match(inspection)
        raise AiPolicyEnforcementError(
            f"AI policy {decision} on {inspection.target}",
            stage=inspection.target,
            action=decision,
            policy_id=int(top.policy_id) if top is not None else None,
            policy_name=str(top.policy_name) if top is not None else "",
        )
    if decision in {AI_POLICY_ACTION_MASK, AI_POLICY_ACTION_REDACT}:
        new_text = _transform_text(
            inspection.text,
            action=decision,
            inspection=inspection,
            db=db,
            ai_stream_id=ai_stream_id,
        )
        return apply_text_fn(payload, new_text)
    return payload


def enforce_prompt_policy(
    db: Session | None,
    *,
    ai_stream_id: int,
    provider_request: dict[str, Any],
    inspection: AiInspectionResult | None = None,
) -> dict[str, Any]:
    result = inspection or inspect_prompt(
        db,
        ai_stream_id=ai_stream_id,
        provider_request=provider_request,
    )
    if not result.text and not result.policy.matched_policies:
        return provider_request
    return _enforce_inspection(
        result,
        db=db,
        ai_stream_id=ai_stream_id,
        payload=provider_request,
        apply_text_fn=_apply_prompt_text,
    )


def enforce_response_policy(
    db: Session | None,
    *,
    ai_stream_id: int,
    provider_response: dict[str, Any],
    inspection: AiInspectionResult | None = None,
) -> dict[str, Any]:
    result = inspection or inspect_response(
        db,
        ai_stream_id=ai_stream_id,
        provider_response=provider_response,
    )
    if not result.text and not result.policy.matched_policies:
        return provider_response
    return _enforce_inspection(
        result,
        db=db,
        ai_stream_id=ai_stream_id,
        payload=provider_response,
        apply_text_fn=_apply_response_text,
    )


def inspection_log_fields(
    inspection: AiInspectionResult,
    *,
    stream_id: int | None = None,
    request_id: str | None = None,
) -> dict[str, Any]:
    top = _top_match(inspection)
    fields = {
        "stage": f"ai_policy_{inspection.target}",
        "ai_policy_target": inspection.target,
        "ai_policy_decision": str(inspection.policy.decision),
        "ai_policy_matched_count": int(inspection.policy.matched_policy_count),
        "ai_policy_finding_count": int(inspection.finding_count),
        "ai_policy_rule_id": int(top.policy_id) if top is not None else None,
        "ai_policy_rule_name": str(top.policy_name) if top is not None else None,
        "message": f"AI policy {inspection.target} inspection: {inspection.policy.decision}",
    }
    if stream_id is not None:
        fields["stream_id"] = int(stream_id)
    if request_id:
        fields["request_id"] = str(request_id)
    return fields
