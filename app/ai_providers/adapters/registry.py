"""AI provider adapter registry."""

from __future__ import annotations

from app.ai_providers.adapters.azure_openai import AzureOpenAiProviderAdapter
from app.ai_providers.adapters.base import AiProviderAdapter
from app.ai_providers.adapters.claude import ClaudeProviderAdapter
from app.ai_providers.adapters.gemini import GeminiProviderAdapter
from app.ai_providers.adapters.mock import MockProviderAdapter
from app.ai_providers.adapters.ollama import OllamaProviderAdapter
from app.ai_providers.adapters.openai import OpenAiProviderAdapter
from app.ai_providers.adapters.vllm import VllmProviderAdapter
from app.runtime.errors import DestinationSendError


class AiProviderAdapterRegistry:
    def __init__(self) -> None:
        adapters: list[AiProviderAdapter] = [
            MockProviderAdapter(),
            OpenAiProviderAdapter(),
            AzureOpenAiProviderAdapter(),
            ClaudeProviderAdapter(),
            GeminiProviderAdapter(),
            OllamaProviderAdapter(),
            VllmProviderAdapter(),
        ]
        self._by_type = {adapter.provider_type.upper(): adapter for adapter in adapters}

    def get(self, provider_type: str) -> AiProviderAdapter:
        key = str(provider_type or "").strip().upper()
        adapter = self._by_type.get(key)
        if adapter is None:
            raise DestinationSendError(f"Unsupported AI provider_type: {provider_type}")
        return adapter


_DEFAULT_REGISTRY: AiProviderAdapterRegistry | None = None


def get_ai_provider_adapter_registry() -> AiProviderAdapterRegistry:
    global _DEFAULT_REGISTRY
    if _DEFAULT_REGISTRY is None:
        _DEFAULT_REGISTRY = AiProviderAdapterRegistry()
    return _DEFAULT_REGISTRY
