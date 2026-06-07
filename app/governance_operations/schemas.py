"""Pydantic schemas for Governance Operations Center API (M19.6, M20.3)."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

AttentionCategory = Literal[
    "pending_approvals",
    "open_violations",
    "pending_replays",
    "failed_replays",
    "failed_notifications",
    "quarantined_events",
]

ActionPriority = Literal["critical", "high", "medium"]
ActionCategory = Literal[
    "pending_approvals",
    "open_violations",
    "quarantined_events",
    "failed_replays",
    "failed_notifications",
    "pending_replays",
]

ACTIVITY_LIMIT_DEFAULT = 50
ACTIVITY_LIMIT_MAX = 50
QUEUE_ITEM_LIMIT = 5


class GovernanceOperationsSummaryResponse(BaseModel):
    pending_approvals: int = 0
    open_violations: int = 0
    quarantined_events: int = 0
    pending_replays: int = 0
    failed_replays: int = 0
    failed_notifications: int = 0
    pending_notifications: int = 0


class GovernanceOperationsAttentionItem(BaseModel):
    category: AttentionCategory
    count: int
    label: str
    priority: ActionPriority = "medium"


class GovernanceOperationsAttentionResponse(BaseModel):
    items: list[GovernanceOperationsAttentionItem] = Field(default_factory=list)
    is_empty: bool = True


class GovernanceOperationsActionRequiredItem(BaseModel):
    priority: ActionPriority
    category: ActionCategory
    count: int
    label: str
    recommended_action: str


class GovernanceOperationsApprovalQueueItem(BaseModel):
    policy_id: int
    policy_name: str
    approval_status: str
    requester: str | None = None
    submitted_at: datetime | None = None


class GovernanceOperationsViolationQueueItem(BaseModel):
    violation_id: str
    policy_name: str | None = None
    stream_name: str | None = None
    severity: str
    status: str


class GovernanceOperationsQuarantineQueueItem(BaseModel):
    quarantine_id: int
    stream_name: str | None = None
    policy_name: str | None = None
    status: str
    quarantine_reason: str | None = None


class GovernanceOperationsReplayQueueItem(BaseModel):
    replay_id: int
    stream_name: str | None = None
    status: str
    outcome: str | None = None
    error_message: str | None = None


class GovernanceOperationsNotificationQueueItem(BaseModel):
    notification_id: int
    event_type: str
    severity: str
    status: str
    created_at: datetime


class GovernanceOperationsQueueResponse(BaseModel):
    action_required: list[GovernanceOperationsActionRequiredItem] = Field(default_factory=list)
    pending_approvals: list[GovernanceOperationsApprovalQueueItem] = Field(default_factory=list)
    violations: list[GovernanceOperationsViolationQueueItem] = Field(default_factory=list)
    quarantine: list[GovernanceOperationsQuarantineQueueItem] = Field(default_factory=list)
    replays: list[GovernanceOperationsReplayQueueItem] = Field(default_factory=list)
    notifications: list[GovernanceOperationsNotificationQueueItem] = Field(default_factory=list)


class GovernanceOperationsActivityEntry(BaseModel):
    event_time: datetime
    event_type: str
    event_label: str
    policy_id: int | None = None
    policy_name: str | None = None
    stream_id: int | None = None
    stream_name: str | None = None
    status: str


class GovernanceOperationsActivityResponse(BaseModel):
    total: int = 0
    events: list[GovernanceOperationsActivityEntry] = Field(default_factory=list)
