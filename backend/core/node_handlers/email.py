from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any

from core.email_service import get_email_service
from core.email_service.models import EmailProviderRequest


def _safe_int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _build_regex_flags(raw_flags: str) -> int:
    flags = 0
    for char in str(raw_flags or ""):
        if char == "i":
            flags |= re.IGNORECASE
        elif char == "m":
            flags |= re.MULTILINE
        elif char == "s":
            flags |= re.DOTALL
    return flags


def _iso_utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _parse_datetime(value: Any) -> datetime | None:
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


def _resolve_time_config(ctx, data: dict) -> dict[str, Any]:
    time_mode = str(data.get("timeMode") or "none").strip().lower()
    anchor_field = str(data.get("anchorField") or "finishedAt").strip() or "finishedAt"
    lookback_seconds = _safe_int(data.get("lookbackSeconds"), 0)
    time_config = {
        "mode": time_mode,
        "sinceTime": str(data.get("sinceTime") or "").strip(),
        "anchorNodeId": str(data.get("anchorNodeId") or "").strip(),
        "anchorField": anchor_field,
        "lookbackSeconds": lookback_seconds,
        "resolvedSinceTime": "",
    }

    if time_mode == "none":
        return time_config

    if time_mode == "absolute":
        since_dt = _parse_datetime(time_config["sinceTime"])
        if since_dt is None:
            raise ValueError("timeMode=absolute 时 sinceTime 必须是有效的 ISO 时间")
        time_config["resolvedSinceTime"] = since_dt.isoformat()
        return time_config

    if time_mode == "node_anchor":
        anchor_node_id = time_config["anchorNodeId"]
        if not anchor_node_id:
            raise ValueError("timeMode=node_anchor 时 anchorNodeId 不能为空")

        anchor_output = ctx.outputs.get(anchor_node_id)
        if not isinstance(anchor_output, dict):
            raise ValueError(f"未找到锚点节点输出: {anchor_node_id}")

        anchor_dt = _parse_datetime(anchor_output.get(anchor_field))
        if anchor_dt is None:
            raise ValueError(
                f"锚点节点 {anchor_node_id} 缺少可用的时间字段: {anchor_field}"
            )

        if lookback_seconds > 0:
            anchor_dt = anchor_dt.timestamp() - lookback_seconds
            anchor_dt = datetime.fromtimestamp(anchor_dt, tz=timezone.utc)

        time_config["resolvedSinceTime"] = anchor_dt.isoformat()
        return time_config

    raise ValueError(f"不支持的 timeMode: {time_mode}")


async def handle_email_node(
    ctx, data: dict, normalized_node: dict, result, __: Any
) -> None:
    node_id = normalized_node["id"]
    user_id = ctx.item.user_id
    action = str(data.get("action") or "get_address").strip().lower()
    provider = str(data.get("provider") or "").strip().lower()
    account_tag = str(data.get("accountTag") or "").strip()
    address_type = str(data.get("addressType") or "primary").strip().lower()
    email_service = get_email_service()

    if not provider:
        raise ValueError("email 节点缺少 provider")

    if action == "get_address":
        request = EmailProviderRequest(
            user_id=user_id,
            provider=provider,
            action="get_address",
            account_tag=account_tag,
            address_type=address_type,
            alias_label=str(data.get("aliasLabel") or "").strip(),
            metadata={
                "service": "email_service",
                "accountPoolImplemented": False,
            },
        )
        provider_impl = email_service.get_provider(provider)
        execution_result = await provider_impl.execute_get_address(
            request, email_service.build_context()
        )
        plan = email_service.dispatch_get_address(request)
        result.message = "Email address acquired"
        result.data = {
            **plan.to_dict(),
            **execution_result,
            "result": execution_result.get("emailAddress")
            or execution_result.get("identifier")
            or execution_result.get("address"),
            "addressType": address_type,
            "resolvedAt": _iso_utc_now(),
        }
        ctx.outputs[node_id] = result.data
        return

    if action == "get_email":
        email_address = email_service.parse_address(data.get("emailAddress")).normalized
        extract_mode = str(data.get("extractMode") or "none").strip().lower()
        regex_pattern = str(data.get("regexPattern") or "")

        extraction_preview: dict[str, Any] | None = None
        if extract_mode == "regex" and regex_pattern:
            extraction_preview = {
                "mode": "regex",
                "from": str(data.get("extractFrom") or "text"),
                "pattern": regex_pattern,
                "flags": str(data.get("regexFlags") or ""),
                "compiledFlags": _build_regex_flags(data.get("regexFlags")),
                "groupIndex": _safe_int(data.get("groupIndex"), 1),
                "multiMatch": bool(data.get("multiMatch")),
            }

        folder = str(data.get("folder") or "INBOX").strip() or "INBOX"
        time_config = _resolve_time_config(ctx, data)
        wait_config = {
            "timeoutSeconds": _safe_int(data.get("waitTimeoutSeconds"), 30),
            "pollIntervalSeconds": _safe_int(data.get("pollIntervalSeconds"), 3),
        }
        request = EmailProviderRequest(
            user_id=user_id,
            provider=provider,
            action="get_email",
            account_tag=account_tag,
            email_address=email_address,
            folder=folder,
            from_filter=str(data.get("from") or "").strip(),
            subject_filter=str(data.get("subject") or "").strip(),
            contains_filter=str(data.get("contains") or "").strip(),
            time_config=time_config,
            wait_config=wait_config,
            extraction_config=extraction_preview,
            metadata={
                "service": "email_service",
                "mailboxFetchImplemented": False,
                "userId": str(data.get("userId") or "").strip(),
            },
        )
        provider_impl = email_service.get_provider(provider)
        execution_result = await provider_impl.execute_get_email(
            request, email_service.build_context()
        )
        plan = email_service.dispatch_get_email(request)
        message_payload = execution_result.get("message") or {}
        matched = bool(execution_result.get("matched", bool(message_payload)))
        result.message = "Email fetched"
        result.data = {
            **plan.to_dict(),
            **execution_result,
            "result": message_payload.get("text")
            or message_payload.get("html")
            or message_payload.get("subject")
            or "",
            "matched": matched,
            "emailAddress": email_address,
            "plannedAt": _iso_utc_now(),
        }
        if not matched:
            result.message = execution_result.get("reason") or "Email not found"
        ctx.outputs[node_id] = result.data
        return

    result.status = "skipped"
    result.message = f"未知 email action: {action}"
