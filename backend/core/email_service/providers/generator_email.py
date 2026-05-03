from __future__ import annotations

import asyncio
import re
from datetime import datetime, timezone
from typing import Any

from bs4 import BeautifulSoup
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


class GeneratorEmailProvider(EmailProvider):
    provider_type = EmailProviderType.GENERATOR_EMAIL
    implementation = "generator_email_html"

    def __init__(self) -> None:
        self.base_url = "https://generator.email"
        self.timeout = 30.0
        self.impersonate = "chrome136"
        self.headers = {
            "user-agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/146.0.0.0 Safari/537.36"
            ),
            "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "referer": self.base_url,
        }

    def _build_target(
        self, request: EmailProviderRequest, context: EmailProviderContext
    ):
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

        resolved_address = address_info.normalized if address_info else None
        if matched_account is not None and matched_account.address:
            resolved_address = matched_account.address.lower().strip()

        resolved_surl = None
        if matched_account is not None:
            resolved_surl = self._safe_str(
                matched_account.metadata.get("surl")
                or matched_account.secrets.get("surl")
            )
        if not resolved_surl and resolved_address:
            resolved_surl = self._build_surl(resolved_address)

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
                "surl": resolved_surl,
                "autoPersist": False,
            },
        )

    def build_get_address_plan(
        self, request: EmailProviderRequest, context: EmailProviderContext
    ) -> EmailOperationPlan:
        target = self._build_target(request, context)
        payload = dict(request.metadata or {})
        payload["aliasPolicy"] = (
            "alias_only"
            if str(request.address_type or "primary") == "alias"
            else "primary_only"
        )
        payload["notes"] = [
            "generator.email 通过首页 HTML 解析当前生成的邮箱地址",
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
        payload["notes"] = [
            "generator.email 通过 HTML 页面抓取收件箱链接与详情页正文",
            "当前不会因运行时拿到有效邮箱而自动补录到账号池",
        ]
        return self.build_plan(
            action="get_email", target=target, query=query, extra=payload
        )

    async def execute_get_address(
        self,
        request: EmailProviderRequest,
        context: EmailProviderContext,
    ) -> dict[str, object]:
        timeout_seconds = self._resolve_timeout_seconds(request)
        html = await self._get_text(
            self.base_url,
            timeout_seconds=timeout_seconds,
        )
        email_address = self._parse_email(html)
        if not email_address:
            raise ValueError("generator.email 未能解析邮箱地址")

        surl = self._build_surl(email_address)
        if not surl:
            raise ValueError("generator.email 未能生成 surl")

        # 临时邮箱仅用于运行时流程，获取地址时不自动入库。

        return {
            "provider": self.provider_type.value,
            "emailAddress": email_address,
            "identifier": email_address,
            "authType": "cookie",
            "surl": surl,
            "persisted": False,
            "createdAt": datetime.now(timezone.utc).isoformat(),
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
            raise ValueError("缺少 generator.email 邮箱地址")

        surl = self._safe_str(
            target.metadata.get("surl")
            or request.metadata.get("surl")
            or (
                target.account.metadata.get("surl")
                if target.account is not None
                else None
            )
        )

        if not surl:
            surl = self._build_surl(address)
        if not surl:
            raise ValueError("缺少 generator.email surl")

        timeout_seconds = self._resolve_timeout_seconds(request)
        wait_seconds = timeout_seconds
        poll_seconds = self._resolve_poll_seconds(request)
        deadline = datetime.now(timezone.utc).timestamp() + wait_seconds
        last_message_id = self._safe_str(
            (target.account.metadata.get("lastMessageId") if target.account else None)
        )

        links: list[dict[str, Any]] = []
        while True:
            links = await self._get_inbox_links(surl, timeout_seconds=timeout_seconds)
            links = self._prioritize_links(links, last_message_id)
            links = self._filter_links_by_time(links, request)
            if links or datetime.now(timezone.utc).timestamp() >= deadline:
                break
            await self._sleep_seconds(poll_seconds)

        if not links:
            return self._build_empty_email_result(
                request=request,
                context=context,
                address=address,
                surl=surl,
                links=links,
                reason="generator.email 收件箱中暂无邮件",
            )

        matched_message = None
        while True:
            for link in links:
                detail = await self._get_message_detail(
                    link,
                    surl,
                    timeout_seconds=timeout_seconds,
                )
                candidate = {**link, **detail}
                if self._matches_message(candidate, request):
                    matched_message = candidate
                    break

            if matched_message is not None:
                break
            if datetime.now(timezone.utc).timestamp() >= deadline:
                break
            await self._sleep_seconds(poll_seconds)
            links = await self._get_inbox_links(surl, timeout_seconds=timeout_seconds)
            links = self._prioritize_links(links, last_message_id)
            links = self._filter_links_by_time(links, request)

        if matched_message is None:
            return self._build_empty_email_result(
                request=request,
                context=context,
                address=address,
                surl=surl,
                links=links,
                reason="未找到匹配的邮件",
            )

        # 临时邮箱在业务未确认完成前不自动入库，避免把未完成注册流程的邮箱写入账号池。

        return {
            "provider": self.provider_type.value,
            "emailAddress": address,
            "identifier": address,
            "authType": "cookie",
            "surl": surl,
            "persisted": False,
            "message": {
                "uid": self._safe_str(
                    matched_message.get("id") or matched_message.get("href")
                ),
                "subject": self._safe_str(matched_message.get("subject")),
                "from": self._safe_str(matched_message.get("from")),
                "to": [address],
                "date": self._safe_str(matched_message.get("date")),
                "text": self._safe_str(matched_message.get("text")),
                "html": self._safe_str(matched_message.get("html")),
                "raw": matched_message,
            },
            "messageCount": len(links),
            "matched": True,
            "matchedAt": datetime.now(timezone.utc).isoformat(),
        }

    def _build_empty_email_result(
        self,
        request: EmailProviderRequest,
        context: EmailProviderContext,
        address: str,
        surl: str,
        links: list[dict[str, Any]],
        reason: str,
    ) -> dict[str, object]:
        # 临时邮箱在未完成业务流程前不自动入库。

        return {
            "provider": self.provider_type.value,
            "emailAddress": address,
            "identifier": address,
            "authType": "cookie",
            "surl": surl,
            "persisted": False,
            "message": {},
            "messageCount": len(links),
            "matched": False,
            "matchedAt": None,
            "reason": reason,
        }

    async def _get_inbox_links(
        self, surl: str, timeout_seconds: float
    ) -> list[dict[str, Any]]:
        mailbox_url = f"{self.base_url}/{surl.lstrip('/')}"
        html = await self._get_text(
            mailbox_url,
            cookies={"surl": surl},
            timeout_seconds=timeout_seconds,
        )

        if not self._has_mail_table(html):
            return []

        return self._parse_mail_table(html, surl)

    def _has_mail_table(self, html: str) -> bool:
        if not self._safe_str(html):
            return False

        soup = BeautifulSoup(html, "html.parser")
        table = soup.find(id="email-table")
        return table is not None

    def _parse_mail_table(self, html: str, surl: str) -> list[dict[str, Any]]:
        soup = BeautifulSoup(html, "html.parser")
        table = soup.find(id="email-table")
        if table is None:
            return []

        results: list[dict[str, Any]] = []
        for link in table.find_all("a", href=True, recursive=False):
            if link is None:
                continue

            href = self._safe_str(link.get("href"))
            if not self._is_probable_message_link(href, surl):
                continue

            message_id = self._extract_link_message_id(str(link), href)
            if not message_id:
                continue

            from_value = self._extract_mail_list_field(
                link,
                class_pattern=r"from_div_",
            )
            subject_value = self._extract_mail_list_field(
                link,
                class_pattern=r"subj_div_",
            )
            date_value = self._extract_mail_list_field(
                link,
                class_pattern=r"time_div_",
            )

            row_values = [
                value for value in [from_value, subject_value, date_value] if value
            ]

            results.append(
                {
                    "href": href,
                    "id": message_id,
                    "title": self._safe_str(link.get_text(" ", strip=True)),
                    "from": from_value,
                    "subject": subject_value,
                    "date": date_value,
                    "row": row_values,
                }
            )

        return results

    def _extract_mail_list_field(self, link: Any, class_pattern: str) -> str:
        node = link.find(
            lambda tag: tag.name
            and tag.has_attr("class")
            and any(
                re.search(class_pattern, cls or "", re.I)
                for cls in tag.get("class", [])
            )
        )
        if node is not None:
            return self._safe_str(node.get_text(" ", strip=True))

        return ""

    def _is_probable_message_link(self, href: str, surl: str) -> bool:
        normalized_href = self._safe_str(href)
        normalized_surl = self._safe_str(surl).strip("/")

        if not normalized_href or not normalized_surl:
            return False

        if normalized_href.startswith(("#", "javascript:", "mailto:")):
            return False

        path = normalized_href
        if normalized_href.startswith("http://") or normalized_href.startswith(
            "https://"
        ):
            path_match = re.match(r"https?://[^/]+/(.+)", normalized_href, re.I)
            path = path_match.group(1) if path_match else ""

        normalized_path = path.strip("/")
        if not normalized_path:
            return False

        if normalized_path == normalized_surl:
            return False

        if not normalized_path.startswith(f"{normalized_surl}/"):
            return False

        message_id = normalized_path.split("/")[-1].strip()
        if not message_id or message_id == normalized_surl.split("/")[-1]:
            return False

        return True

    def _extract_link_message_id(self, anchor_html: str, href: str) -> str:
        for attr_name in ("data-message-id", "data-id", "id"):
            pattern = rf'{attr_name}\s*=\s*["\']([^"\']+)["\']'
            match = re.search(pattern, anchor_html, re.I)
            if match:
                value = self._safe_str(match.group(1))
                if value:
                    return value

        path = href
        if href.startswith("http://") or href.startswith("https://"):
            path_match = re.match(r"https?://[^/]+/(.+)", href, re.I)
            path = path_match.group(1) if path_match else ""

        return self._safe_str(path.strip("/").split("/")[-1])

    def _prioritize_links(
        self,
        links: list[dict[str, Any]],
        last_message_id: str,
    ) -> list[dict[str, Any]]:
        if not links:
            return []

        deduped: list[dict[str, Any]] = []
        seen_ids: set[str] = set()
        for item in links:
            message_id = self._safe_str(item.get("id") or item.get("href"))
            if message_id in seen_ids:
                continue
            seen_ids.add(message_id)
            deduped.append(item)

        if not last_message_id:
            return deduped

        unseen = [
            item
            for item in deduped
            if self._safe_str(item.get("id") or item.get("href")) != last_message_id
        ]
        seen = [
            item
            for item in deduped
            if self._safe_str(item.get("id") or item.get("href")) == last_message_id
        ]
        return unseen + seen

    async def _get_message_detail(
        self,
        link: dict[str, Any],
        surl: str,
        timeout_seconds: float,
    ) -> dict[str, Any]:
        href = self._safe_str(link.get("href"))
        if not href:
            return {"html": "", "text": "", "subject": "", "from": ""}

        detail_url = (
            href if href.startswith("http") else f"{self.base_url}/{href.lstrip('/')}"
        )
        raw_html = await self._get_text(
            detail_url,
            cookies={"surl": surl},
            timeout_seconds=timeout_seconds,
        )
        clean_text = self._clean_html(raw_html)
        subject = self._extract_subject(raw_html, clean_text)
        from_value = self._extract_from(raw_html, clean_text)
        return {
            "html": raw_html,
            "text": clean_text,
            "subject": subject,
            "from": from_value,
        }

    def _matches_message(
        self,
        message: dict[str, Any],
        request: EmailProviderRequest,
    ) -> bool:
        if not self._matches_time_filter(message, request):
            return False

        from_filter = request.from_filter.strip().lower()
        subject_filter = request.subject_filter.strip().lower()
        contains_filter = request.contains_filter.strip().lower()

        subject = self._safe_str(message.get("subject") or message.get("title")).lower()
        from_value = self._safe_str(message.get("from")).lower()
        text = self._safe_str(message.get("text")).lower()
        html = self._safe_str(message.get("html")).lower()

        if from_filter and from_filter not in from_value and from_filter not in text:
            return False
        if (
            subject_filter
            and subject_filter not in subject
            and subject_filter not in text
        ):
            return False
        if (
            contains_filter
            and contains_filter not in text
            and contains_filter not in html
        ):
            return False
        return True

    def _filter_links_by_time(
        self,
        links: list[dict[str, Any]],
        request: EmailProviderRequest,
    ) -> list[dict[str, Any]]:
        since_dt = self._resolve_since_datetime(request)
        if since_dt is None:
            return links
        return [link for link in links if self._matches_time_filter(link, request)]

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
            message.get("time"),
            message.get("receivedAt"),
            message.get("createdAt"),
        ]
        for value in candidates:
            parsed = self._parse_datetime(value)
            if parsed is not None:
                return parsed
        return None

    async def _get_text(
        self,
        url: str,
        cookies: dict[str, Any] | None = None,
        timeout_seconds: float | None = None,
    ) -> str:
        response = await asyncio.to_thread(
            self._request,
            url,
            cookies or {},
            timeout_seconds or self.timeout,
        )
        return response.text or ""

    def _request(
        self,
        url: str,
        cookies: dict[str, Any],
        timeout_seconds: float,
    ):
        response = curl_requests.get(
            url,
            headers=self.headers,
            cookies=cookies,
            timeout=timeout_seconds,
            impersonate=self.impersonate,
            allow_redirects=True,
        )
        response.raise_for_status()
        return response

    def _parse_email(self, html: str) -> str | None:
        if not html:
            return None

        match = re.search(r'id="email_ch_text"[^>]*>([^<]+)</span>', html, re.I)
        if not match:
            match = re.search(r'id="email_ch_text"[^>]*>([^<]+)<', html, re.I)
        if match:
            value = match.group(1).strip().lower()
            return value or None

        user_match = re.search(r'id="userName"[^>]*value="([^"]+)"', html, re.I)
        domain_match = re.search(r'id="domainName2"[^>]*value="([^"]+)"', html, re.I)
        if user_match and domain_match:
            username = user_match.group(1).strip().lower()
            domain = domain_match.group(1).strip().lower()
            if username and domain:
                return f"{username}@{domain}"

        return None

    def _build_surl(self, email: str | None) -> str | None:
        normalized = self._safe_str(email).lower()
        if not normalized or "@" not in normalized:
            return None
        username, domain = normalized.split("@", 1)
        safe_user = re.sub(r"[^a-zA-Z_0-9.-]", "", username).lower()
        if not safe_user or not domain:
            return None
        return f"{domain.lower()}/{safe_user}"

    def _extract_subject(self, raw_html: str, clean_text: str) -> str:
        title_match = re.search(r"<title[^>]*>(.*?)</title>", raw_html, re.I | re.S)
        if title_match:
            title = self._clean_html(title_match.group(1))
            if title:
                return title

        subject_match = re.search(
            r"(?:subject|主题)\s*[:：]\s*([^\n\r]+)", clean_text, re.I
        )
        if subject_match:
            return subject_match.group(1).strip()
        return ""

    def _extract_from(self, raw_html: str, clean_text: str) -> str:
        from_match = re.search(
            r"(?:from|发件人)\s*[:：]\s*([^\n\r]+)", clean_text, re.I
        )
        if from_match:
            return from_match.group(1).strip()

        email_match = re.search(
            r"[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}", raw_html, re.I
        )
        return email_match.group(0).strip() if email_match else ""

    def _clean_html(self, value: str) -> str:
        text = re.sub(r"<script[\s\S]*?</script>", " ", value, flags=re.I)
        text = re.sub(r"<style[\s\S]*?</style>", " ", text, flags=re.I)
        text = re.sub(r"<[^>]+>", " ", text)
        text = re.sub(r"\s+", " ", text)
        return text.strip()

    def _resolve_timeout_seconds(self, request: EmailProviderRequest) -> float:
        wait_config = request.wait_config or {}
        timeout_seconds = wait_config.get("timeoutSeconds")
        try:
            return max(10.0, float(timeout_seconds or self.timeout))
        except (TypeError, ValueError):
            return self.timeout

    def _resolve_poll_seconds(self, request: EmailProviderRequest) -> float:
        wait_config = request.wait_config or {}
        poll_seconds = wait_config.get("pollIntervalSeconds")
        try:
            return max(1.0, float(poll_seconds or 3))
        except (TypeError, ValueError):
            return 3.0

    async def _sleep_seconds(self, seconds: float) -> None:
        import asyncio

        await asyncio.sleep(seconds)

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
            "%d %b %Y %H:%M:%S",
            "%d %b %Y %H:%M",
            "%b %d, %Y %H:%M:%S",
            "%b %d, %Y %H:%M",
        )
        for fmt in datetime_formats:
            try:
                return datetime.strptime(raw, fmt).replace(tzinfo=timezone.utc)
            except ValueError:
                continue

        return None
