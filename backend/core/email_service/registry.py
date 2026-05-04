from __future__ import annotations

from .base import EmailProvider
from .providers import (
    GeneratorEmailProvider,
    ImapEmailProvider,
    InboxesEmailProvider,
    OutlookEmailProvider,
)


class EmailProviderRegistry:
    def __init__(self) -> None:
        self._providers: dict[str, EmailProvider] = {}

    def register(self, provider: EmailProvider) -> None:
        self._providers[provider.provider_type.value] = provider

    def has(self, provider_key: str) -> bool:
        return self.get(provider_key) is not None

    def get(self, provider_key: str) -> EmailProvider | None:
        return self._providers.get(provider_key.lower().strip())

    def keys(self) -> list[str]:
        return list(self._providers.keys())

    def providers(self) -> list[EmailProvider]:
        return list(self._providers.values())


def build_default_email_provider_registry() -> EmailProviderRegistry:
    registry = EmailProviderRegistry()
    registry.register(ImapEmailProvider())
    registry.register(OutlookEmailProvider())
    registry.register(InboxesEmailProvider())
    registry.register(GeneratorEmailProvider())
    return registry
