"""AI policy enforcement errors — not replay or failover eligible."""

from __future__ import annotations


class AiPolicyEnforcementError(Exception):
    """Raised when prompt/response policy enforcement blocks delivery."""

    def __init__(
        self,
        message: str,
        *,
        stage: str,
        action: str,
        policy_id: int | None = None,
        policy_name: str = "",
    ) -> None:
        super().__init__(message)
        self.stage = str(stage)
        self.action = str(action)
        self.policy_id = policy_id
        self.policy_name = policy_name
