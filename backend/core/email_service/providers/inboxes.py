from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from typing import Any

from curl_cffi import requests as curl_requests

from ..base import EmailProvider
from ..models import (
    EmailOperationPlan,
    EmailProviderContext,
    EmailProviderRequest,
    EmailProviderType,
    EmailQuery,
    ResolvedEmailTarget,
)


class InboxesEmailProvider(EmailProvider):
    provider_type = EmailProviderType.INBOXES
    implementation = "inboxes_rest_v2"

    def __init__(self) -> None:
        self.base_url = "https://inboxes.com/api/v2"
        self.read_url = "https://inboxes.com/read"
        self.timeout = 30.0
        self.impersonate = "chrome136"
        self.headers = {
            "accept": "application/json, text/plain, */*",
            "origin": "https://inboxes.com",
            "referer": "https://inboxes.com/",
            "user-agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/146.0.0.0 Safari/537.36"
            ),
        }

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

        matched_account = None
        if address_info is not None:
            for account in accounts:
                if account.matches_address(address_info.normalized):
                    matched_account = account
                    break
        if matched_account is None and address_info is None and accounts:
            matched_account = accounts[0]

        resolved_address = address_info.normalized if address_info else None
        if matched_account is not None and matched_account.address:
            resolved_address = matched_account.address.lower().strip()

        return ResolvedEmailTarget(
            provider=self.provider_type.value,
            source_type=(
                "account_pool" if matched_account is not None else "provider_request"
            ),
            address_info=address_info,
            account=matched_account,
            input_address=address_info.normalized if address_info else None,
            resolved_address=resolved_address,
            alias_label=request.alias_label or None,
            account_tag=request.account_tag,
            metadata={
                "requestedProvider": request.provider,
                "service": "email_service",
                "baseUrl": self.base_url,
                "readUrl": self.read_url,
                "autoPersist": False,
            },
        )

    def build_get_address_plan(
        self, request: EmailProviderRequest, context: EmailProviderContext
    ) -> EmailOperationPlan:
        target = self._build_target(request, context)
        payload = dict(request.metadata or {})
        payload["capabilities"] = {
            "getAddress": True,
            "getEmail": True,
            "autoPersist": False,
            "authType": "cookie",
        }
        payload["notes"] = [
            "inboxes.com 通过 REST API 创建临时邮箱地址",
            "当前不会自动保存到账号池，需在业务完成后再决定是否入库",
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
        payload["capabilities"] = {
            "getAddress": True,
            "getEmail": True,
            "autoPersist": False,
            "authType": "cookie",
        }
        payload["notes"] = [
            "inboxes.com 通过收件箱 API + read 页面获取邮件",
            "当前不会因运行时拿到有效邮箱与 user_id 而自动补录到账号池",
        ]
        return self.build_plan(
            action="get_email", target=target, query=query, extra=payload
        )

    async def execute_get_address(
        self,
        request: EmailProviderRequest,
        context: EmailProviderContext,
    ) -> dict[str, Any]:
        timeout_seconds = self._resolve_timeout_seconds(request)
        response = await self._request(
            method="POST",
            url=f"{self.base_url}/inbox",
            timeout_seconds=timeout_seconds,
            json_body={},
        )
        payload = response.json() if response.content else {}
        address = str(payload.get("inbox") or "").strip().lower()
        if not address:
            raise ValueError("inboxes 未返回邮箱地址")

        cookies = response.cookies
        user_id = cookies.get("user_id")
        if not user_id:
            raise ValueError("inboxes 未返回 user_id")

        # 临时邮箱仅用于运行时流程，获取地址时不自动入库。

        return {
            "provider": self.provider_type.value,
            "emailAddress": address,
            "identifier": address,
            "authType": "cookie",
            "userId": user_id,
            "persisted": False,
            "createdAt": datetime.now(timezone.utc).isoformat(),
        }

    async def execute_get_email(
        self,
        request: EmailProviderRequest,
        context: EmailProviderContext,
    ) -> dict[str, Any]:
        target = self._build_target(request, context)
        address = target.resolved_address or (
            target.address_info.normalized if target.address_info else None
        )
        if not address:
            raise ValueError("缺少 inboxes 邮箱地址")

        user_id = None
        if target.account is not None:
            user_id = target.account.secrets.get(
                "user_id"
            ) or target.account.secrets.get("userId")
        if not user_id:
            user_id = request.metadata.get("userId") or request.metadata.get("user_id")
        if not user_id:
            raise ValueError("缺少 inboxes user_id，无法读取收件箱")

        timeout_seconds = self._resolve_timeout_seconds(request)
        wait_seconds = timeout_seconds
        poll_seconds = self._resolve_poll_seconds(request)
        deadline = datetime.now(timezone.utc).timestamp() + wait_seconds

        messages: list[dict[str, Any]] = []
        matched_message = None
        while True:
            messages = await self._get_inbox_messages(
                address=address,
                user_id=str(user_id),
                timeout_seconds=timeout_seconds,
            )
            matched_message = self._pick_message(messages, request)
            if matched_message is not None:
                break
            if datetime.now(timezone.utc).timestamp() >= deadline:
                break
            await asyncio.sleep(poll_seconds)

        if matched_message is None:
            return {
                "provider": self.provider_type.value,
                "emailAddress": address,
                "identifier": address,
                "authType": "cookie",
                "userId": str(user_id),
                "persisted": False,
                "message": {},
                "messageCount": len(messages),
                "matched": False,
                "matchedAt": None,
                "reason": "未找到匹配的邮件",
            }

        message_uid = str(
            matched_message.get("uid")
            or matched_message.get("id")
            or matched_message.get("messageId")
            or ""
        ).strip()
        if not message_uid:
            raise ValueError("匹配邮件缺少 uid")

        body_response = await self._request(
            method="GET",
            url=f"{self.read_url}/{message_uid}",
            timeout_seconds=timeout_seconds,
            cookies={"user_id": str(user_id)},
        )
        body_text = body_response.text or ""

        # 临时邮箱在业务未确认完成前不自动入库，避免把未完成注册流程的邮箱写入账号池。

        return {
            "provider": self.provider_type.value,
            "emailAddress": address,
            "identifier": address,
            "authType": "cookie",
            "userId": str(user_id),
            "persisted": False,
            "message": {
                "uid": message_uid,
                "subject": self._safe_str(
                    matched_message.get("subject") or matched_message.get("subj")
                ),
                "from": self._safe_str(
                    matched_message.get("from") or matched_message.get("fromAddress")
                ),
                "to": matched_message.get("to")
                or matched_message.get("toAddresses")
                or [],
                "date": self._safe_str(
                    matched_message.get("date") or matched_message.get("createdAt")
                ),
                "text": body_text,
                "html": body_text,
                "raw": matched_message,
            },
            "messageCount": len(messages),
            "matched": True,
            "matchedAt": datetime.now(timezone.utc).isoformat(),
        }

    def _pick_message(
        self, messages: list[dict[str, Any]], request: EmailProviderRequest
    ) -> dict[str, Any] | None:
        from_filter = request.from_filter.strip().lower()
        subject_filter = request.subject_filter.strip().lower()
        contains_filter = request.contains_filter.strip().lower()

        filtered: list[dict[str, Any]] = []
        for item in messages:
            if not isinstance(item, dict):
                continue
            if not self._matches_time_filter(item, request):
                continue

            subject = self._safe_str(item.get("subject") or item.get("subj")).lower()
            from_value = self._safe_str(
                item.get("from") or item.get("fromAddress") or item.get("sender")
            ).lower()
            preview = self._safe_str(
                item.get("body") or item.get("intro") or item.get("text")
            ).lower()

            if from_filter and from_filter not in from_value:
                continue
            if subject_filter and subject_filter not in subject:
                continue
            if contains_filter and contains_filter not in preview:
                continue
            filtered.append(item)

        candidates = filtered
        return candidates[0] if candidates else None

    async def _get_inbox_messages(
        self,
        address: str,
        user_id: str,
        timeout_seconds: float,
    ) -> list[dict[str, Any]]:
        inbox_response = await self._request(
            method="GET",
            url=f"{self.base_url}/inbox/{address}",
            timeout_seconds=timeout_seconds,
            cookies={"user_id": user_id},
        )
        inbox_payload = inbox_response.json() if inbox_response.content else {}
        messages = inbox_payload.get("msgs", []) or []
        if not isinstance(messages, list):
            return []
        return [item for item in messages if isinstance(item, dict)]

    def _matches_time_filter(
        self,
        message: dict[str, Any],
        request: EmailProviderRequest,
    ) -> bool:
        since_dt = self._resolve_since_datetime(request)
        if since_dt is None:
            return True

        message_dt = self._extract_message_datetime(message)
        if message_dt is None:
            return False

        return message_dt >= since_dt

    def _resolve_since_datetime(
        self,
        request: EmailProviderRequest,
    ) -> datetime | None:
        time_config = request.time_config or {}
        mode = self._safe_str(time_config.get("mode")).lower()
        if not mode or mode == "none":
            return None

        raw_since = self._safe_str(
            time_config.get("resolvedSinceTime") or time_config.get("sinceTime")
        )
        return self._parse_datetime(raw_since)

    def _extract_message_datetime(self, message: dict[str, Any]) -> datetime | None:
        candidates = [
            message.get("date"),
            message.get("createdAt"),
            message.get("receivedAt"),
            message.get("time"),
        ]
        for value in candidates:
            parsed = self._parse_datetime(value)
            if parsed is not None:
                return parsed
        return None

    def _resolve_timeout_seconds(self, request: EmailProviderRequest) -> float:
        wait_config = request.wait_config or {}
        timeout_seconds = wait_config.get("timeoutSeconds")
        try:
            return max(10.0, float(timeout_seconds or 15))
        except (TypeError, ValueError):
            return 15.0

    def _resolve_poll_seconds(self, request: EmailProviderRequest) -> float:
        wait_config = request.wait_config or {}
        poll_seconds = wait_config.get("pollIntervalSeconds")
        try:
            return max(1.0, float(poll_seconds or 3))
        except (TypeError, ValueError):
            return 3.0

    async def _request(
        self,
        method: str,
        url: str,
        timeout_seconds: float,
        cookies: dict[str, Any] | None = None,
        json_body: dict[str, Any] | None = None,
    ):
        return await asyncio.to_thread(
            self._request_sync,
            method,
            url,
            timeout_seconds,
            cookies or {},
            json_body,
        )

    def _request_sync(
        self,
        method: str,
        url: str,
        timeout_seconds: float,
        cookies: dict[str, Any],
        json_body: dict[str, Any] | None,
    ):
        response = curl_requests.request(
            method=method,
            url=url,
            headers=self.headers,
            cookies=cookies,
            json=json_body,
            timeout=timeout_seconds or self.timeout,
            impersonate=self.impersonate,
            allow_redirects=True,
        )
        response.raise_for_status()
        return response

    def _safe_str(self, value: Any) -> str:
        return str(value or "").strip()

    def _parse_datetime(self, value: Any) -> datetime | None:
        if value is None:
            return None
        if isinstance(value, datetime):
            if value.tzinfo is None:
                return value.replace(tzinfo=timezone.utc)
            return value.astimezone(timezone.utc)

        raw = self._safe_str(value)
        if not raw:
            return None

        normalized = raw.replace("Z", "+00:00")
        try:
            parsed = datetime.fromisoformat(normalized)
        except ValueError:
            parsed = None

        if parsed is not None:
            if parsed.tzinfo is None:
                return parsed.replace(tzinfo=timezone.utc)
            return parsed.astimezone(timezone.utc)

        datetime_formats = (
            "%Y-%m-%d %H:%M:%S",
            "%Y-%m-%d %H:%M",
            "%Y/%m/%d %H:%M:%S",
            "%Y/%m/%d %H:%M",
        )
        for fmt in datetime_formats:
            try:
                return datetime.strptime(raw, fmt).replace(tzinfo=timezone.utc)
            except ValueError:
                continue

        return None
