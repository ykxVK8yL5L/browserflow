from __future__ import annotations

from abc import ABC, abstractmethod
from datetime import datetime, timezone
from typing import Any

from .models import (
    EmailOperationPlan,
    EmailProviderDefinition,
    EmailProviderField,
    EmailProviderImportResult,
    EmailProviderType,
    EmailProviderContext,
    EmailProviderRequest,
    EmailQuery,
    ResolvedEmailTarget,
)


class EmailProvider(ABC):
    provider_type: EmailProviderType
    implementation = "scaffold"
    display_name = ""
    provider_description = ""
    import_hint = ""
    manual_import_enabled = False
    supports_oauth = False
    supports_test_receive = False
    account_fields: list[EmailProviderField] = []

    def get_definition(self) -> EmailProviderDefinition:
        return EmailProviderDefinition(
            key=self.provider_type.value,
            label=self.display_name or self.provider_type.value,
            description=self.provider_description,
            import_hint=self.import_hint,
            manual_import_enabled=self.manual_import_enabled,
            supports_oauth=self.supports_oauth,
            supports_test_receive=self.supports_test_receive,
            account_fields=list(self.account_fields),
        )

    def parse_import_text(self, raw_text: str) -> EmailProviderImportResult:
        if not self.manual_import_enabled:
            raise ValueError(
                f"{self.provider_type.value} 账号由运行时自动创建，无需手动导入"
            )
        raise ValueError(f"{self.provider_type.value} 暂未实现导入解析")

    def _normalize_import_lines(self, raw_text: str) -> list[str]:
        return [
            line.strip() for line in str(raw_text or "").splitlines() if line.strip()
        ]

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
