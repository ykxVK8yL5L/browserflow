from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from email import message_from_bytes
from email.header import decode_header, make_header
from email.utils import parsedate_to_datetime
import imaplib
import socket
from typing import Any

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
from ..presets import EmailProviderPresetStore


class ImapEmailProvider(EmailProvider):
    provider_type = EmailProviderType.IMAP
    implementation = "imap_protocol_pending"
    display_name = "IMAP"
    provider_description = "适用于普通 IMAP 邮箱账号导入。"
    import_hint = "邮箱----密码"
    manual_import_enabled = True
    supports_test_receive = True
    account_fields = [
        EmailProviderField(
            key="password",
            label="密码",
            input_type="password",
            placeholder="留空则保持不变",
            preserve_on_blank=True,
        )
    ]

    def __init__(self) -> None:
        self.preset_store = EmailProviderPresetStore()

    def parse_import_text(self, raw_text: str) -> EmailProviderImportResult:
        lines = self._normalize_import_lines(raw_text)
        items: list[dict[str, Any]] = []
        for index, line in enumerate(lines):
            raw_address, *rest = line.split("----")
            password = "----".join(rest).strip()
            address = str(raw_address or "").strip().lower()
            if not address or not password:
                raise ValueError(f"第 {index + 1} 行格式错误，应为 邮箱----密码")
            items.append(
                {
                    "provider": self.provider_type.value,
                    "type": self.provider_type.value,
                    "identifier": address,
                    "accountTag": address,
                    "address": address,
                    "username": address,
                    "password": password,
                }
            )
        return EmailProviderImportResult(
            description="IMAP imported account",
            items=items,
        )

    def supports_preset_domain(self, domain: str) -> bool:
        return self.preset_store.match_by_domain(domain) is not None

    def _match_account(self, accounts, email_address: str | None = None):
        if email_address:
            normalized = email_address.lower().strip()
            for account in accounts:
                if account.matches_address(normalized):
                    return account
            return None
        return accounts[0] if accounts else None

    def _resolve_preset(self, target: ResolvedEmailTarget):
        domain_candidates: list[str] = []
        if target.address_info is not None and target.address_info.domain:
            domain_candidates.append(target.address_info.domain)

        account_address = target.account.address if target.account is not None else None
        if account_address and "@" in account_address:
            account_domain = account_address.rsplit("@", 1)[1].strip().lower()
            if account_domain and account_domain not in domain_candidates:
                domain_candidates.append(account_domain)

        for domain in domain_candidates:
            preset = self.preset_store.match_by_domain(domain)
            if preset is not None:
                return preset

        if target.account and target.account.provider:
            preset = self.preset_store.get(target.account.provider)
            if preset is not None and isinstance(preset.imap, dict):
                host = self._safe_str(preset.imap.get("host"))
                if host:
                    return preset

        provider_hint = str(target.metadata.get("requestedProvider") or "").strip()
        if provider_hint:
            preset = self.preset_store.match_by_alias(provider_hint)
            if preset is not None:
                return preset

        if provider_hint:
            preset = self.preset_store.get(provider_hint)
            if preset is not None and isinstance(preset.imap, dict):
                host = self._safe_str(preset.imap.get("host"))
                if host:
                    return preset

        if target.account and target.account.provider:
            preset = self.preset_store.get(target.account.provider)
            if preset is not None:
                return preset

        return self.preset_store.get(self.provider_type.value)

    def _build_account_snapshot(
        self, target: ResolvedEmailTarget
    ) -> dict[str, object] | None:
        account = target.account
        if account is None:
            return None

        snapshot: dict[str, object] = {
            "credentialId": account.credential_id,
            "provider": account.provider,
            "identifier": account.identifier,
            "accountTag": account.account_tag,
            "address": account.address,
            "username": account.username,
            "authType": account.auth_type,
            "aliases": account.aliases,
        }
        if account.secrets.get("password"):
            snapshot["hasPassword"] = True
        return snapshot

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
        alias_address = None
        source_type = "provider_request"

        if matched_account is not None:
            source_type = "account_pool"
            if matched_account.address:
                resolved_address = matched_account.address.lower().strip()
            if (
                address_info
                and matched_account.address
                and matched_account.address.lower().strip() != address_info.normalized
            ):
                alias_address = address_info.normalized

        return ResolvedEmailTarget(
            provider=self.provider_type.value,
            source_type=source_type,
            address_info=address_info,
            account=matched_account,
            input_address=address_info.normalized if address_info else None,
            resolved_address=resolved_address,
            alias_address=alias_address,
            alias_label=request.alias_label or None,
            account_tag=request.account_tag,
            metadata={
                "requestedProvider": request.provider,
                "requestedAddressType": request.address_type,
                "service": "email_service",
            },
        )

    def build_get_address_plan(
        self, request: EmailProviderRequest, context: EmailProviderContext
    ) -> EmailOperationPlan:
        target = self._build_target(request, context)
        alias_policy = (
            "alias_only"
            if str(request.address_type or "primary") == "alias"
            else "primary_only"
        )
        payload = dict(request.metadata or {})
        payload["aliasPolicy"] = alias_policy
        payload["transport"] = "imap"
        account_snapshot = self._build_account_snapshot(target)
        if account_snapshot is not None:
            payload["account"] = account_snapshot
        preset = self._resolve_preset(target)
        if preset is not None:
            payload["preset"] = preset.to_dict()
        payload["notes"] = [
            "通用 IMAP provider 作为未知域名兜底",
            "后续可根据账号凭证切换 password / oauth2 认证",
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
        payload["transport"] = "imap"
        account_snapshot = self._build_account_snapshot(target)
        if account_snapshot is not None:
            payload["account"] = account_snapshot
        preset = self._resolve_preset(target)
        if preset is not None:
            payload["preset"] = preset.to_dict()
        payload["notes"] = [
            "后续实现 IMAP 搜索、轮询与正文抓取",
            "支持别名输入，由 service 统一解析为主地址/别名",
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
            raise ValueError("缺少 IMAP 邮箱地址")

        account_snapshot = self._build_account_snapshot(target)
        auth_type = target.account.auth_type if target.account else "password"

        return {
            "provider": self.provider_type.value,
            "emailAddress": address,
            "identifier": address,
            "authType": auth_type,
            "persisted": False,
            "credentialId": (
                target.account.credential_id if target.account is not None else None
            ),
            "account": account_snapshot,
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
            raise ValueError("缺少 IMAP 邮箱地址")

        account = target.account
        if account is None:
            raise ValueError("未找到对应的 IMAP 账号")

        username = self._safe_str(
            account.username or account.address or account.identifier
        )
        password = self._safe_str(account.secrets.get("password"))
        if not username or not password:
            raise ValueError("当前 IMAP 账号缺少用户名或密码")

        host, port, secure = self._resolve_connection_settings(target)
        mailbox = self._resolve_mailbox_name(request)
        timeout_seconds = self._resolve_timeout_seconds(request)
        poll_seconds = self._resolve_poll_seconds(request)
        deadline = datetime.now(timezone.utc).timestamp() + timeout_seconds
        since_dt = self._resolve_since_datetime(request)

        matched_message = None
        message_count = 0
        while True:
            messages = await asyncio.to_thread(
                self._fetch_messages,
                host,
                port,
                secure,
                username,
                password,
                mailbox,
                socket.getdefaulttimeout() or timeout_seconds,
                since_dt,
            )
            message_count = len(messages)
            matched_message = self._pick_message(messages, request)
            if matched_message is not None:
                break
            if datetime.now(timezone.utc).timestamp() >= deadline:
                break
            await asyncio.sleep(poll_seconds)

        persisted_account = context.upsert_account(
            user_id=request.user_id,
            provider=self.provider_type.value,
            address=address,
            identifier=address,
            auth_type=account.auth_type or "password",
            secrets=account.secrets,
            metadata={
                **(account.metadata or {}),
                **(
                    {"lastMessageUid": matched_message.get("uid")}
                    if matched_message is not None
                    else {}
                ),
            },
            account_tag=request.account_tag or account.account_tag or address,
            name=account.name,
            description="imap account",
        )

        if matched_message is None:
            return {
                "provider": self.provider_type.value,
                "emailAddress": address,
                "identifier": address,
                "authType": persisted_account.auth_type,
                "persisted": True,
                "credentialId": persisted_account.credential_id,
                "message": {},
                "messageCount": message_count,
                "matched": False,
                "matchedAt": None,
                "reason": "未找到匹配的邮件",
                "account": persisted_account.to_dict(),
            }

        return {
            "provider": self.provider_type.value,
            "emailAddress": address,
            "identifier": address,
            "authType": persisted_account.auth_type,
            "persisted": True,
            "credentialId": persisted_account.credential_id,
            "message": {
                "uid": matched_message.get("uid"),
                "subject": matched_message.get("subject") or "",
                "from": matched_message.get("from") or "",
                "to": matched_message.get("to") or [address],
                "date": matched_message.get("date") or "",
                "text": matched_message.get("text") or "",
                "html": matched_message.get("html") or "",
                "raw": matched_message.get("raw") or matched_message,
            },
            "messageCount": message_count,
            "matched": True,
            "matchedAt": datetime.now(timezone.utc).isoformat(),
            "account": persisted_account.to_dict(),
        }

    def _resolve_connection_settings(
        self,
        target: ResolvedEmailTarget,
    ) -> tuple[str, int, bool]:
        metadata = target.account.metadata if target.account is not None else {}
        preset = self._resolve_preset(target)
        preset_imap = (
            preset.imap if preset is not None and isinstance(preset.imap, dict) else {}
        )

        host = self._safe_str(preset_imap.get("host"))
        port_raw = preset_imap.get("port") or 993
        secure_raw = preset_imap.get("secure", True)

        if not host:
            host = self._safe_str(metadata.get("imapHost") or metadata.get("host"))

        if port_raw in (None, ""):
            port_raw = metadata.get("imapPort") or metadata.get("port") or 993

        if secure_raw is None:
            secure_raw = metadata.get("imapSecure")
        if secure_raw is None:
            secure_raw = metadata.get("secure")

        if not host:
            raise ValueError("未找到 IMAP 主机配置")

        try:
            port = int(port_raw)
        except (TypeError, ValueError):
            port = 993

        return host, port, bool(secure_raw)

    def _resolve_mailbox_name(self, request: EmailProviderRequest) -> str:
        mailbox = self._safe_str(request.folder)
        return mailbox or "INBOX"

    def _fetch_messages(
        self,
        host: str,
        port: int,
        secure: bool,
        username: str,
        password: str,
        mailbox: str,
        timeout_seconds: float,
        since_dt: datetime | None = None,
    ) -> list[dict[str, Any]]:
        client = None
        previous_timeout = socket.getdefaulttimeout()
        socket.setdefaulttimeout(timeout_seconds)
        try:
            if secure:
                client = imaplib.IMAP4_SSL(
                    host=host, port=port, timeout=timeout_seconds
                )
            else:
                client = imaplib.IMAP4(host=host, port=port, timeout=timeout_seconds)

            client.login(username, password)
            select_status, _ = client.select(mailbox, readonly=True)
            if select_status != "OK":
                raise RuntimeError(f"无法访问邮箱文件夹: {mailbox}")

            search_criteria = self._build_imap_search_criteria(since_dt)
            search_status, search_data = client.uid("search", None, *search_criteria)
            if search_status != "OK":
                raise RuntimeError(f"无法搜索邮件: {mailbox}")

            raw_ids = search_data[0] if search_data else b""
            ids = [item for item in raw_ids.split() if item]
            ids = list(reversed(ids))

            messages: list[dict[str, Any]] = []
            for uid in ids:
                fetch_status, fetch_data = client.uid("fetch", uid, "(RFC822)")
                if fetch_status != "OK" or not fetch_data:
                    continue

                raw_message = b""
                for part in fetch_data:
                    if (
                        isinstance(part, tuple)
                        and len(part) >= 2
                        and isinstance(part[1], (bytes, bytearray))
                    ):
                        raw_message = bytes(part[1])
                        break
                if not raw_message:
                    continue

                parsed = self._parse_imap_message(
                    uid.decode(errors="ignore"), raw_message
                )
                if parsed is not None:
                    messages.append(parsed)

            return messages
        except (
            imaplib.IMAP4.error,
            TimeoutError,
            socket.timeout,
            OSError,
            RuntimeError,
        ) as error:
            raise ValueError(str(error).strip() or "IMAP 收信失败") from error
        finally:
            socket.setdefaulttimeout(previous_timeout)
            if client is not None:
                try:
                    client.logout()
                except Exception:
                    pass

    def _parse_imap_message(
        self, uid: str, raw_message: bytes
    ) -> dict[str, Any] | None:
        try:
            message = message_from_bytes(raw_message)
        except Exception:
            return None

        subject = self._decode_mime_header(message.get("Subject"))
        from_value = self._decode_mime_header(message.get("From"))
        to_value = self._decode_mime_header(message.get("To"))
        date_value = self._safe_str(message.get("Date"))
        message_dt = self._parse_datetime(date_value)
        text_body, html_body = self._extract_message_bodies(message)

        return {
            "uid": uid,
            "subject": subject,
            "from": from_value,
            "to": (
                [item.strip() for item in to_value.split(",") if item.strip()]
                if to_value
                else []
            ),
            "date": message_dt.isoformat() if message_dt else date_value,
            "text": text_body,
            "html": html_body,
            "raw": {
                "uid": uid,
                "subject": subject,
                "from": from_value,
                "to": to_value,
                "date": date_value,
            },
        }

    def _extract_message_bodies(self, message) -> tuple[str, str]:
        text_parts: list[str] = []
        html_parts: list[str] = []

        if message.is_multipart():
            for part in message.walk():
                if part.get_content_maintype() == "multipart":
                    continue
                disposition = self._safe_str(part.get("Content-Disposition")).lower()
                if "attachment" in disposition:
                    continue
                content_type = self._safe_str(part.get_content_type()).lower()
                payload = part.get_payload(decode=True)
                if payload is None:
                    continue
                charset = part.get_content_charset() or "utf-8"
                body = payload.decode(charset, errors="ignore").strip()
                if not body:
                    continue
                if content_type == "text/plain":
                    text_parts.append(body)
                elif content_type == "text/html":
                    html_parts.append(body)
        else:
            payload = message.get_payload(decode=True)
            if payload is not None:
                charset = message.get_content_charset() or "utf-8"
                body = payload.decode(charset, errors="ignore").strip()
                content_type = self._safe_str(message.get_content_type()).lower()
                if content_type == "text/html":
                    html_parts.append(body)
                else:
                    text_parts.append(body)

        return "\n".join(text_parts).strip(), "\n".join(html_parts).strip()

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

    def _build_imap_search_criteria(self, since_dt: datetime | None) -> tuple[str, ...]:
        if since_dt is None:
            return ("ALL",)
        normalized = since_dt.astimezone(timezone.utc)
        return ("SINCE", normalized.strftime("%d-%b-%Y"))

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

    def _decode_mime_header(self, value: Any) -> str:
        raw = self._safe_str(value)
        if not raw:
            return ""
        try:
            return str(make_header(decode_header(raw))).strip()
        except Exception:
            return raw

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

        if parsed is None:
            try:
                parsed = parsedate_to_datetime(raw)
            except (TypeError, ValueError, IndexError):
                parsed = None

        if parsed is None:
            return None
        if parsed.tzinfo is None:
            return parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc)

    def _safe_str(self, value: Any) -> str:
        return str(value or "").strip()
