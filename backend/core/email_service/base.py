from __future__ import annotations

from abc import ABC, abstractmethod
from datetime import datetime, timezone
from typing import Any

from .models import (
    EmailOperationPlan,
    EmailProviderType,
    EmailProviderContext,
    EmailProviderRequest,
    EmailQuery,
    ResolvedEmailTarget,
)


class EmailProvider(ABC):
    provider_type: EmailProviderType
    implementation = "scaffold"

    def build_plan(
        self,
        *,
        action: str,
        target: ResolvedEmailTarget,
        query: EmailQuery | None = None,
        extra: dict[str, Any] | None = None,
    ) -> EmailOperationPlan:
        details = dict(extra or {})
        if query is not None:
            details["query"] = query.to_dict()

        return EmailOperationPlan(
            action=action,
            provider=self.provider_type.value,
            supported=True,
            target=target,
            implementation=self.implementation,
            generated_at=datetime.now(timezone.utc).isoformat(),
            details=details,
        )

    @abstractmethod
    def build_get_address_plan(
        self,
        request: EmailProviderRequest,
        context: EmailProviderContext,
    ) -> EmailOperationPlan:
        raise NotImplementedError

    @abstractmethod
    def build_get_email_plan(
        self,
        request: EmailProviderRequest,
        context: EmailProviderContext,
    ) -> EmailOperationPlan:
        raise NotImplementedError

    async def execute_get_address(
        self,
        request: EmailProviderRequest,
        context: EmailProviderContext,
    ) -> dict[str, Any]:
        raise NotImplementedError

    async def execute_get_email(
        self,
        request: EmailProviderRequest,
        context: EmailProviderContext,
    ) -> dict[str, Any]:
        raise NotImplementedError
