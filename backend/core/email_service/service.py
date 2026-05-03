from __future__ import annotations

from email.utils import parseaddr
from datetime import datetime
from typing import Any
import json

from models.database import SessionLocal
from models.db_models import EmailAccountModel
from utils.auth_utils import decrypt_data, encrypt_data

from .models import (
    EmailAccountRecord,
    EmailAddressInfo,
    EmailOperationPlan,
    EmailProviderContext,
    EmailProviderRequest,
)
from .registry import EmailProviderRegistry, build_default_email_provider_registry


class EmailService:
    def __init__(self, registry: EmailProviderRegistry | None = None) -> None:
        self.registry = registry or build_default_email_provider_registry()

    def get_provider(self, provider_key: str):
        candidate = str(provider_key or "").strip().lower()
        if not candidate:
            raise ValueError("缺少 provider")

        provider = self.registry.get(candidate)
        if provider is None:
            raise ValueError(f"不支持的 email provider: {provider_key}")
        return provider

    def parse_address(self, raw_value: Any) -> EmailAddressInfo:
        raw = str(raw_value or "").strip()
        if not raw:
            raise ValueError("缺少邮箱地址")

        _, parsed = parseaddr(raw)
        normalized = (parsed or raw).strip().lower()
        if not normalized or "@" not in normalized:
            raise ValueError(f"无效的邮箱地址: {raw}")

        local_part, domain = normalized.rsplit("@", 1)
        return EmailAddressInfo(
            raw=raw,
            normalized=normalized,
            local_part=local_part,
            domain=domain,
        )

    def load_accounts(
        self, user_id: str, provider: str = "", account_tag: str = ""
    ) -> list[EmailAccountRecord]:
        provider_filter = str(provider or "").strip().lower()
        tag_filter = str(account_tag or "").strip().lower()

        records: list[EmailAccountRecord] = []
        db = SessionLocal()
        try:
            rows = (
                db.query(EmailAccountModel)
                .filter(
                    EmailAccountModel.user_id == user_id,
                    EmailAccountModel.is_valid == True,
                )
                .order_by(EmailAccountModel.updated_at.desc())
                .all()
            )

            for row in rows:
                payload = self._decrypt_credential_payload(row.credential_data, user_id)
                if not isinstance(payload, dict):
                    continue

                record = self._build_account_record(row, payload)
                if record is None:
                    continue
                if provider_filter and record.provider != provider_filter:
                    continue
                if tag_filter and not self._matches_account_tag(record, tag_filter):
                    continue
                records.append(record)
            return records
        finally:
            db.close()

    def build_context(self) -> EmailProviderContext:
        return EmailProviderContext(
            parse_address=self.parse_address,
            load_accounts=self.load_accounts,
            upsert_account=self.upsert_account,
        )

    def dispatch_get_address(self, request: EmailProviderRequest) -> EmailOperationPlan:
        provider = self.get_provider(request.provider)
        return provider.build_get_address_plan(request, self.build_context())

    def dispatch_get_email(self, request: EmailProviderRequest) -> EmailOperationPlan:
        provider = self.get_provider(request.provider)
        return provider.build_get_email_plan(request, self.build_context())

    def _decrypt_credential_payload(
        self, encrypted_data: str, user_id: str
    ) -> dict[str, Any]:
        try:
            raw = decrypt_data(encrypted_data, user_id)
        except Exception:
            return {}

        try:
            payload = json.loads(raw)
        except Exception:
            return {}
        return payload if isinstance(payload, dict) else {}

    def upsert_account(
        self,
        *,
        user_id: str,
        provider: str,
        address: str | None,
        identifier: str | None,
        auth_type: str | None,
        secrets: dict[str, Any] | None = None,
        metadata: dict[str, Any] | None = None,
        account_tag: str = "",
        name: str | None = None,
        description: str | None = None,
        is_visible: bool = True,
        is_valid: bool = True,
    ) -> EmailAccountRecord:
        normalized_provider = str(provider or "").strip().lower()
        normalized_address = str(address or "").strip().lower() or None
        normalized_identifier = (
            str(identifier or normalized_address or "").strip() or None
        )
        normalized_tag = str(account_tag or "").strip() or (
            normalized_address or normalized_identifier or normalized_provider
        )
        payload = {
            "provider": normalized_provider,
            "type": normalized_provider,
            "identifier": normalized_identifier,
            "accountTag": normalized_tag,
            "address": normalized_address,
            "username": normalized_address or normalized_identifier,
            "authType": str(auth_type or "").strip() or None,
            **(metadata or {}),
            **(secrets or {}),
        }
        payload = {key: value for key, value in payload.items() if value is not None}

        db = SessionLocal()
        try:
            rows = (
                db.query(EmailAccountModel)
                .filter(EmailAccountModel.user_id == user_id)
                .order_by(EmailAccountModel.updated_at.desc())
                .all()
            )

            matched_row: EmailAccountModel | None = None
            for row in rows:
                existing_payload = self._decrypt_credential_payload(
                    row.credential_data, user_id
                )
                existing_provider = (
                    str(
                        existing_payload.get("provider")
                        or existing_payload.get("type")
                        or row.provider
                        or ""
                    )
                    .strip()
                    .lower()
                )
                if existing_provider != normalized_provider:
                    continue

                existing_address = (
                    str(
                        existing_payload.get("address")
                        or existing_payload.get("email")
                        or existing_payload.get("identifier")
                        or ""
                    )
                    .strip()
                    .lower()
                )
                existing_identifier = str(
                    existing_payload.get("identifier") or ""
                ).strip()

                if normalized_address and existing_address == normalized_address:
                    matched_row = row
                    break
                if (
                    normalized_identifier
                    and existing_identifier
                    and existing_identifier == normalized_identifier
                ):
                    matched_row = row
                    break

            encrypted_payload = encrypt_data(json.dumps(payload), user_id)
            resolved_provider = normalized_provider
            resolved_address = (
                str(
                    payload.get("address")
                    or payload.get("email")
                    or payload.get("identifier")
                    or ""
                )
                .strip()
                .lower()
                or None
            )

            if matched_row is None:
                matched_row = EmailAccountModel(
                    user_id=user_id,
                    name=(
                        str(name or "").strip()
                        or normalized_tag
                        or normalized_address
                        or normalized_identifier
                        or normalized_provider
                    ),
                    provider=resolved_provider,
                    address=resolved_address,
                    credential_data=encrypted_payload,
                    description=(
                        str(description or "").strip()
                        or f"{normalized_provider} account"
                    ),
                    is_visible=is_visible,
                    is_valid=is_valid,
                )
                db.add(matched_row)
            else:
                matched_row.name = (
                    str(name or "").strip()
                    or matched_row.name
                    or normalized_tag
                    or normalized_address
                    or normalized_identifier
                    or normalized_provider
                )
                matched_row.provider = resolved_provider
                matched_row.address = resolved_address
                matched_row.credential_data = encrypted_payload
                matched_row.description = (
                    str(description or "").strip()
                    or matched_row.description
                    or f"{normalized_provider} account"
                )
                matched_row.is_visible = is_visible
                matched_row.is_valid = is_valid
                matched_row.updated_at = datetime.utcnow()

            db.commit()
            db.refresh(matched_row)

            return self._build_account_record(matched_row, payload)  # type: ignore[arg-type]
        finally:
            db.close()

    def _build_account_record(
        self, row: EmailAccountModel, payload: dict[str, Any]
    ) -> EmailAccountRecord | None:
        provider = (
            str(
                payload.get("provider")
                or payload.get("type")
                or (row.provider if self.registry.has(row.provider) else "")
                or ""
            )
            .strip()
            .lower()
        )
        address = (
            str(
                payload.get("email")
                or payload.get("address")
                or payload.get("identifier")
                or ""
            )
            .strip()
            .lower()
            or None
        )
        aliases = payload.get("aliases") or payload.get("aliasEmails") or []
        if isinstance(aliases, str):
            aliases = [aliases]
        if not isinstance(aliases, list):
            aliases = []

        username = (
            str(
                payload.get("username") or payload.get("login") or address or ""
            ).strip()
            or None
        )
        account_tag = (
            str(payload.get("accountTag") or payload.get("account_tag") or "").strip()
            or row.name
        )
        identifier = (
            str(payload.get("identifier") or address or username or row.name).strip()
            or None
        )
        secrets = self._extract_account_secrets(payload)
        metadata = self._build_safe_account_metadata(payload)
        auth_type = str(
            payload.get("authType") or payload.get("auth_type") or ""
        ).strip() or ("password" if secrets.get("password") else None)

        if not provider and not address and row.provider != "email":
            return None

        if not provider:
            return None

        return EmailAccountRecord(
            credential_id=row.id,
            name=row.name,
            site=row.provider,
            provider=provider,
            identifier=identifier,
            account_tag=account_tag,
            address=address,
            aliases=[str(item).strip() for item in aliases if str(item).strip()],
            username=username,
            auth_type=auth_type,
            metadata=metadata,
            secrets=secrets,
        )

    def _matches_account_tag(self, record: EmailAccountRecord, tag_filter: str) -> bool:
        candidates = [
            record.account_tag,
            record.name,
            record.identifier,
            record.address,
        ]
        normalized = {
            str(item).strip().lower() for item in candidates if str(item).strip()
        }
        return tag_filter in normalized

    def _extract_account_secrets(self, payload: dict[str, Any]) -> dict[str, Any]:
        secret_keys = {
            "password",
            "token",
            "accessToken",
            "refreshToken",
            "clientSecret",
            "secret",
            "cookies",
            "userId",
            "user_id",
        }
        return {
            key: value
            for key, value in payload.items()
            if key in secret_keys and value not in (None, "", [], {})
        }

    def _build_safe_account_metadata(self, payload: dict[str, Any]) -> dict[str, Any]:
        excluded_keys = {
            "password",
            "token",
            "accessToken",
            "refreshToken",
            "clientSecret",
            "secret",
            "cookies",
            "userId",
            "user_id",
            "email",
            "address",
            "identifier",
            "username",
            "login",
            "provider",
            "type",
            "authType",
            "auth_type",
            "aliases",
            "aliasEmails",
            "accountTag",
            "account_tag",
        }
        return {
            str(key): value
            for key, value in payload.items()
            if key not in excluded_keys
        }


_email_service_singleton: EmailService | None = None


def get_email_service() -> EmailService:
    global _email_service_singleton
    if _email_service_singleton is None:
        _email_service_singleton = EmailService()
    return _email_service_singleton
