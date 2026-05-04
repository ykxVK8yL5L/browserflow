from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from typing import Any
from urllib.parse import quote

from curl_cffi import requests

from ..base import EmailProvider
from ..models import (
    EmailOperationPlan,
    EmailProviderField,
    EmailProviderImportResult,
    EmailProviderContext,
    EmailProviderRequest,
    EmailProviderType,
    EmailQuery,
    ResolvedEmailTarget,
)


class OutlookEmailProvider(EmailProvider):
    provider_type = EmailProviderType.OUTLOOK
    implementation = "microsoft_graph_refresh_token"
    display_name = "Outlook"
    provider_description = "通过 Microsoft Graph + refresh_token 读取 Outlook 邮件。"
    import_hint = "邮箱----密码----Client_ID----Refresh_Token"
    manual_import_enabled = True
    supports_oauth = True
    supports_test_receive = True
    account_fields = [
        EmailProviderField(
            key="password",
            label="密码",
            input_type="password",
            placeholder="留空则保持不变",
            preserve_on_blank=True,
        ),
        EmailProviderField(
            key="clientId",
            label="Client ID",
        ),
        EmailProviderField(
            key="refreshToken",
            label="Refresh Token",
            input_type="password",
            placeholder="留空则保持不变",
            preserve_on_blank=True,
        ),
    ]

    graph_base_url = "https://graph.microsoft.com/v1.0"
    token_url_template = "https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token"
    default_scopes = [
        "offline_access",
        "https://graph.microsoft.com/Mail.Read",
        "https://graph.microsoft.com/Mail.ReadWrite",
        "https://graph.microsoft.com/User.Read",
    ]

    def parse_import_text(self, raw_text: str) -> EmailProviderImportResult:
        lines = self._normalize_import_lines(raw_text)
        items: list[dict[str, Any]] = []
        for index, line in enumerate(lines):
            parts = line.split("----")
            raw_address, raw_password, raw_client_id, *refresh_parts = parts
            address = str(raw_address or "").strip().lower()
            password = str(raw_password or "").strip()
            client_id = str(raw_client_id or "").strip()
            refresh_token = "----".join(refresh_parts).strip()
            if not address or not password or not client_id or not refresh_token:
                raise ValueError(
                    f"第 {index + 1} 行格式错误，应为 邮箱----密码----Client_ID----Refresh_Token"
                )
            items.append(
                {
                    "provider": self.provider_type.value,
                    "type": self.provider_type.value,
                    "identifier": address,
                    "accountTag": address,
                    "address": address,
                    "username": address,
                    "password": password,
                    "clientId": client_id,
                    "refreshToken": refresh_token,
                    "authType": "oauth2",
                    "tenant": "common",
                }
            )
        return EmailProviderImportResult(
            description="Outlook OAuth imported account",
            items=items,
        )

    def _match_account(self, accounts, email_address: str | None = None):
        if email_address:
            normalized = email_address.lower().strip()
            for account in accounts:
                if account.matches_address(normalized):
                    return account
            return None
        return accounts[0] if accounts else None

    def _build_target(
        self, request: EmailProviderRequest, context: EmailProviderContext
    ) -> ResolvedEmailTarget:
        address_info = (
            context.parse_address(request.email_address)
            if request.email_address
            else None
        )
        accounts = context.load_accounts(
            request.user_id,
            provider=self.provider_type.value,
            account_tag=request.account_tag,
        )
        matched_account = self._match_account(
            accounts,
            address_info.normalized if address_info else None,
        )

        resolved_address = address_info.normalized if address_info else None
        source_type = "provider_request"
        if matched_account is not None:
            source_type = "account_pool"
            if matched_account.address:
                resolved_address = matched_account.address.lower().strip()

        return ResolvedEmailTarget(
            provider=self.provider_type.value,
            source_type=source_type,
            address_info=address_info,
            account=matched_account,
            input_address=address_info.normalized if address_info else None,
            resolved_address=resolved_address,
            account_tag=request.account_tag,
            metadata={
                "requestedProvider": request.provider,
                "service": "email_service",
            },
        )

    def build_get_address_plan(
        self, request: EmailProviderRequest, context: EmailProviderContext
    ) -> EmailOperationPlan:
        target = self._build_target(request, context)
        payload = dict(request.metadata or {})
        payload["transport"] = "microsoft_graph"
        payload["authType"] = "oauth2_refresh_token"
        payload["notes"] = [
            "Outlook provider 使用 Microsoft Graph /me/messages",
            "通过 refresh_token 自动刷新 access_token",
            "get_address 只返回邮箱信息，不再自动保存到账号池",
        ]
        return self.build_plan(action="get_address", target=target, extra=payload)

    def build_get_email_plan(
        self, request: EmailProviderRequest, context: EmailProviderContext
    ) -> EmailOperationPlan:
        target = self._build_target(request, context)
        query = EmailQuery(
            address=target.address_info or context.parse_address(request.email_address),
            folder=request.folder,
            from_filter=request.from_filter,
            subject_filter=request.subject_filter,
            contains_filter=request.contains_filter,
            time_config=request.time_config,
            wait_config=request.wait_config,
            extraction_config=request.extraction_config,
            alias_policy="auto",
            account_tag=request.account_tag,
        )
        payload = dict(request.metadata or {})
        payload["transport"] = "microsoft_graph"
        payload["authType"] = "oauth2_refresh_token"
        payload["notes"] = [
            "使用 Graph API 拉取最近邮件并在本地做过滤",
            "当前导入格式: 邮箱----密码----Client_ID----Refresh_Token",
        ]
        return self.build_plan(
            action="get_email", target=target, query=query, extra=payload
        )

    async def execute_get_address(
        self,
        request: EmailProviderRequest,
        context: EmailProviderContext,
    ) -> dict[str, object]:
        target = self._build_target(request, context)
        address = target.resolved_address or (
            target.address_info.normalized if target.address_info else None
        )
        if not address:
            raise ValueError("缺少 Outlook 邮箱地址")

        account = target.account

        return {
            "provider": self.provider_type.value,
            "emailAddress": address,
            "identifier": address,
            "authType": (account.auth_type if account else "oauth2"),
            "persisted": False,
            "credentialId": (account.credential_id if account is not None else None),
            "account": account.to_dict() if account is not None else None,
            "resolvedAt": datetime.now(timezone.utc).isoformat(),
        }

    async def execute_get_email(
        self,
        request: EmailProviderRequest,
        context: EmailProviderContext,
    ) -> dict[str, object]:
        target = self._build_target(request, context)
        address = target.resolved_address or (
            target.address_info.normalized if target.address_info else None
        )
        if not address:
            raise ValueError("缺少 Outlook 邮箱地址")

        account = target.account
        if account is None:
            raise ValueError("未找到对应的 Outlook 账号")

        client_id = self._safe_str(
            account.metadata.get("clientId") or account.metadata.get("client_id")
        )
        refresh_token = self._safe_str(
            account.secrets.get("refreshToken") or account.secrets.get("refresh_token")
        )
        password = self._safe_str(account.secrets.get("password"))
        if not client_id or not refresh_token:
            raise ValueError("当前 Outlook 账号缺少 Client ID 或 Refresh Token")

        timeout_seconds = self._resolve_timeout_seconds(request)
        poll_seconds = self._resolve_poll_seconds(request)
        deadline = datetime.now(timezone.utc).timestamp() + timeout_seconds

        token_data = await asyncio.to_thread(
            self._ensure_access_token,
            account,
            client_id,
            refresh_token,
        )
        access_token = self._safe_str(token_data.get("access_token"))
        current_refresh_token = self._safe_str(
            token_data.get("refresh_token") or refresh_token
        )
        expires_at = self._safe_str(token_data.get("expires_at"))

        matched_message = None
        message_count = 0
        since_dt = self._resolve_since_datetime(request)
        while True:
            messages = await asyncio.to_thread(
                self._fetch_messages,
                access_token,
                request.folder,
                since_dt,
            )
            message_count = len(messages)
            matched_message = self._pick_message(messages, request)
            if matched_message is not None:
                break
            if datetime.now(timezone.utc).timestamp() >= deadline:
                break
            await asyncio.sleep(poll_seconds)

        persisted = context.upsert_account(
            user_id=request.user_id,
            provider=self.provider_type.value,
            address=address,
            identifier=address,
            auth_type=account.auth_type or "oauth2",
            secrets={
                **account.secrets,
                **({"password": password} if password else {}),
                "refreshToken": current_refresh_token,
                "accessToken": access_token,
            },
            metadata={
                **(account.metadata or {}),
                "clientId": client_id,
                "tenant": self._resolve_tenant(account),
                **({"tokenExpiresAt": expires_at} if expires_at else {}),
                **(
                    {"lastMessageId": matched_message.get("id")}
                    if matched_message is not None
                    else {}
                ),
            },
            account_tag=request.account_tag or account.account_tag or address,
            name=account.name,
            description="outlook account",
        )

        if matched_message is None:
            return {
                "provider": self.provider_type.value,
                "emailAddress": address,
                "identifier": address,
                "authType": persisted.auth_type,
                "persisted": True,
                "credentialId": persisted.credential_id,
                "message": {},
                "messageCount": message_count,
                "matched": False,
                "matchedAt": None,
                "reason": "未找到匹配的邮件",
                "account": persisted.to_dict(),
            }

        return {
            "provider": self.provider_type.value,
            "emailAddress": address,
            "identifier": address,
            "authType": persisted.auth_type,
            "persisted": True,
            "credentialId": persisted.credential_id,
            "message": matched_message,
            "messageCount": message_count,
            "matched": True,
            "matchedAt": datetime.now(timezone.utc).isoformat(),
            "account": persisted.to_dict(),
        }

    def _resolve_tenant(self, account) -> str:
        tenant = self._safe_str(account.metadata.get("tenant"))
        return tenant or "common"

    def _resolve_scopes(self, account) -> str:
        scopes = account.metadata.get("scopes")
        if isinstance(scopes, list) and scopes:
            return " ".join(str(item).strip() for item in scopes if str(item).strip())
        if isinstance(scopes, str) and scopes.strip():
            return scopes.strip()
        return " ".join(self.default_scopes)

    def _ensure_access_token(
        self,
        account,
        client_id: str,
        refresh_token: str,
    ) -> dict[str, Any]:
        access_token = self._safe_str(
            account.secrets.get("accessToken") or account.secrets.get("access_token")
        )
        expires_at = self._parse_datetime(
            account.metadata.get("tokenExpiresAt") or account.metadata.get("expiresAt")
        )
        if access_token and expires_at is not None:
            if expires_at - timedelta(seconds=60) > datetime.now(timezone.utc):
                return {
                    "access_token": access_token,
                    "refresh_token": refresh_token,
                    "expires_at": expires_at.isoformat(),
                }

        tenant = self._resolve_tenant(account)
        data = {
            "client_id": client_id,
            "grant_type": "refresh_token",
            "refresh_token": refresh_token,
            "scope": self._resolve_scopes(account),
        }
        response = requests.post(
            self.token_url_template.format(tenant=tenant),
            data=data,
            timeout=30,
            impersonate="chrome",
        )
        result = response.json()
        if response.status_code >= 400 or "access_token" not in result:
            detail = result if isinstance(result, dict) else response.text
            raise ValueError(f"Outlook 刷新 token 失败: {detail}")

        expires_in = result.get("expires_in", 3600)
        try:
            expires_seconds = int(expires_in)
        except (TypeError, ValueError):
            expires_seconds = 3600
        expires_at_dt = datetime.now(timezone.utc) + timedelta(seconds=expires_seconds)
        result["expires_at"] = expires_at_dt.isoformat()
        if not result.get("refresh_token"):
            result["refresh_token"] = refresh_token
        return result

    def _fetch_messages(
        self,
        access_token: str,
        folder: str,
        since_dt: datetime | None = None,
    ) -> list[dict[str, Any]]:
        normalized_folder = self._normalize_folder(folder)
        endpoint = f"{self.graph_base_url}/me/messages"
        if normalized_folder and normalized_folder != "inbox":
            endpoint = (
                f"{self.graph_base_url}/me/mailFolders/"
                f"{quote(normalized_folder, safe='')}/messages"
            )
        elif normalized_folder == "inbox":
            endpoint = f"{self.graph_base_url}/me/mailFolders/inbox/messages"

        params: dict[str, Any] = {
            "$top": 50,
            "$orderby": "receivedDateTime desc",
            "$select": "id,subject,body,bodyPreview,receivedDateTime,sentDateTime,from,toRecipients,internetMessageId",
        }
        time_filter = self._build_graph_time_filter(since_dt)
        if time_filter:
            params["$filter"] = time_filter

        response = requests.get(
            endpoint,
            headers={"Authorization": f"Bearer {access_token}"},
            params=params,
            timeout=30,
            impersonate="chrome",
        )
        result = response.json()
        if response.status_code >= 400:
            detail = result if isinstance(result, dict) else response.text
            raise ValueError(f"Outlook 获取邮件失败: {detail}")

        items = result.get("value") if isinstance(result, dict) else None
        if not isinstance(items, list):
            return []
        return [self._map_message(item) for item in items if isinstance(item, dict)]

    def _map_message(self, item: dict[str, Any]) -> dict[str, Any]:
        body = item.get("body") if isinstance(item.get("body"), dict) else {}
        content_type = self._safe_str(body.get("contentType")).lower()
        content = self._safe_str(body.get("content"))
        text = self._safe_str(item.get("bodyPreview"))
        html = ""
        if content_type == "html":
            html = content
        else:
            text = content or text

        from_info = item.get("from") if isinstance(item.get("from"), dict) else {}
        email_info = (
            from_info.get("emailAddress")
            if isinstance(from_info.get("emailAddress"), dict)
            else {}
        )
        from_address = self._safe_str(email_info.get("address"))

        to_recipients = item.get("toRecipients")
        to_addresses: list[str] = []
        if isinstance(to_recipients, list):
            for recipient in to_recipients:
                if not isinstance(recipient, dict):
                    continue
                recipient_info = recipient.get("emailAddress")
                if isinstance(recipient_info, dict):
                    address = self._safe_str(recipient_info.get("address"))
                    if address:
                        to_addresses.append(address)

        date_value = self._safe_str(
            item.get("receivedDateTime") or item.get("sentDateTime")
        )
        return {
            "id": self._safe_str(item.get("id")),
            "uid": self._safe_str(item.get("id")),
            "subject": self._safe_str(item.get("subject")),
            "from": from_address,
            "to": to_addresses,
            "date": date_value,
            "text": text,
            "html": html,
            "raw": item,
        }

    def _pick_message(
        self,
        messages: list[dict[str, Any]],
        request: EmailProviderRequest,
    ) -> dict[str, Any] | None:
        from_filter = request.from_filter.strip().lower()
        subject_filter = request.subject_filter.strip().lower()
        contains_filter = request.contains_filter.strip().lower()

        for message in messages:
            if not self._matches_time_filter(message, request):
                continue

            subject = self._safe_str(message.get("subject")).lower()
            from_value = self._safe_str(message.get("from")).lower()
            text = self._safe_str(message.get("text")).lower()
            html = self._safe_str(message.get("html")).lower()

            if (
                from_filter
                and from_filter not in from_value
                and from_filter not in text
            ):
                continue
            if (
                subject_filter
                and subject_filter not in subject
                and subject_filter not in text
            ):
                continue
            if (
                contains_filter
                and contains_filter not in text
                and contains_filter not in html
            ):
                continue
            return message

        return None

    def _matches_time_filter(
        self,
        message: dict[str, Any],
        request: EmailProviderRequest,
    ) -> bool:
        since_dt = self._resolve_since_datetime(request)
        if since_dt is None:
            return True
        message_dt = self._parse_datetime(message.get("date"))
        if message_dt is None:
            return False
        return message_dt >= since_dt

    def _resolve_since_datetime(self, request: EmailProviderRequest) -> datetime | None:
        time_config = request.time_config or {}
        mode = self._safe_str(time_config.get("mode")).lower()
        if not mode or mode == "none":
            return None
        raw_since = self._safe_str(
            time_config.get("resolvedSinceTime") or time_config.get("sinceTime")
        )
        return self._parse_datetime(raw_since)

    def _build_graph_time_filter(self, since_dt: datetime | None) -> str:
        if since_dt is None:
            return ""
        normalized = since_dt.astimezone(timezone.utc).replace(microsecond=0)
        return f"receivedDateTime ge {normalized.isoformat().replace('+00:00', 'Z')}"

    def _resolve_timeout_seconds(self, request: EmailProviderRequest) -> float:
        wait_config = request.wait_config or {}
        timeout_seconds = wait_config.get("timeoutSeconds")
        try:
            return max(10.0, float(timeout_seconds or 30))
        except (TypeError, ValueError):
            return 30.0

    def _resolve_poll_seconds(self, request: EmailProviderRequest) -> float:
        wait_config = request.wait_config or {}
        poll_seconds = wait_config.get("pollIntervalSeconds")
        try:
            return max(1.0, float(poll_seconds or 3))
        except (TypeError, ValueError):
            return 3.0

    def _normalize_folder(self, folder: str) -> str:
        normalized = self._safe_str(folder).lower()
        if not normalized:
            return "inbox"
        mapping = {
            "inbox": "inbox",
            "drafts": "drafts",
            "sent": "sentitems",
            "sentitems": "sentitems",
            "deleted": "deleteditems",
            "junk": "junkemail",
            "archive": "archive",
        }
        return mapping.get(normalized, normalized)

    def _parse_datetime(self, value: Any) -> datetime | None:
        if value is None:
            return None
        if isinstance(value, datetime):
            if value.tzinfo is None:
                return value.replace(tzinfo=timezone.utc)
            return value.astimezone(timezone.utc)

        raw = str(value).strip()
        if not raw:
            return None
        normalized = raw.replace("Z", "+00:00")
        try:
            parsed = datetime.fromisoformat(normalized)
        except ValueError:
            return None
        if parsed.tzinfo is None:
            return parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc)

    def _safe_str(self, value: Any) -> str:
        return str(value or "").strip()
