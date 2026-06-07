"""Mock AI provider for MVP (no outbound network)."""

from __future__ import annotations

from typing import Any


def invoke_mock_provider(
    *,
    prompt: str,
    metadata: dict[str, Any] | None = None,
    provider: str = "mock",
) -> dict[str, Any]:
    """Return a deterministic mock completion."""

    _ = metadata
    provider_name = (provider or "mock").strip() or "mock"
    preview = prompt[:120] if len(prompt) > 120 else prompt
    return {
        "provider": provider_name,
        "model": "mock-gdc-1",
        "completion": f"[mock:{provider_name}] received {len(prompt)} chars",
        "prompt_preview_len": len(preview),
    }
