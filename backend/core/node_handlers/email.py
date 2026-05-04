from __future__ import annotations

import json
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


def _safe_bool(value: Any, default: bool = True) -> bool:
    if isinstance(value, bool):
        return value
    if value is None:
        return default
    normalized = str(value).strip().lower()
    if normalized in {"true", "1", "yes", "y", "on"}:
        return True
    if normalized in {"false", "0", "no", "n", "off"}:
        return False
    return default


def _parse_json_object(raw_value: Any, field_name: str) -> dict[str, Any]:
    if raw_value in (None, ""):
        return {}
    if isinstance(raw_value, dict):
        return raw_value
    if not isinstance(raw_value, str):
        raise ValueError(f"{field_name} 必须是 JSON 对象")

    parsed = json.loads(raw_value)
    if not isinstance(parsed, dict):
        raise ValueError(f"{field_name} 必须是 JSON 对象")
    return parsed


def _resolve_save_source(ctx, data: dict, predecessor_output: Any) -> dict[str, Any]:
    source = data.get("source")
    if isinstance(source, dict):
        return source

    if isinstance(source, str):
        source_node_id = source.strip()
        if source_node_id:
            source_payload = ctx.outputs.get(source_node_id)
            if isinstance(source_payload, dict):
                return source_payload
            raise ValueError(f"未找到可保存的邮箱来源节点输出: {source_node_id}")

    if isinstance(predecessor_output, dict):
        return predecessor_output

    raise ValueError("save_email 需要来源节点输出，可填写 source 或串联在邮箱节点之后")


def _collect_source_secrets(source_payload: dict[str, Any]) -> dict[str, Any]:
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
    secrets: dict[str, Any] = {}
    for key in secret_keys:
        value = source_payload.get(key)
        if value not in (None, "", [], {}):
            secrets[key] = value
    return secrets


def _build_save_payload(source_payload: dict[str, Any], data: dict) -> dict[str, Any]:
    account = source_payload.get("account") or {}
    target = source_payload.get("target") or {}
    target_account = target.get("account") if isinstance(target, dict) else {}
    if not isinstance(account, dict):
        account = {}
    if not isinstance(target_account, dict):
        target_account = {}

    provider = (
        str(
            data.get("provider")
            or source_payload.get("provider")
            or account.get("provider")
            or target_account.get("provider")
            or ""
        )
        .strip()
        .lower()
    )
    if not provider:
        raise ValueError("save_email 缺少 provider")

    email_address = (
        str(
            data.get("emailAddress")
            or source_payload.get("emailAddress")
            or source_payload.get("address")
            or account.get("address")
            or target.get("resolvedAddress")
            or target_account.get("address")
            or source_payload.get("identifier")
            or ""
        )
        .strip()
        .lower()
    )
    if not email_address:
        raise ValueError("save_email 缺少邮箱地址")

    identifier = str(
        data.get("identifier")
        or source_payload.get("identifier")
        or account.get("identifier")
        or target_account.get("identifier")
        or email_address
    ).strip()
    account_tag = str(
        data.get("accountTag")
        or source_payload.get("accountTag")
        or account.get("accountTag")
        or target_account.get("accountTag")
        or email_address
    ).strip()
    auth_type = (
        str(
            data.get("authType")
            or source_payload.get("authType")
            or account.get("authType")
            or target_account.get("authType")
            or ""
        ).strip()
        or None
    )

    metadata = {}
    account_metadata = account.get("metadata")
    if isinstance(account_metadata, dict):
        metadata.update(account_metadata)
    target_metadata = target.get("metadata")
    if isinstance(target_metadata, dict):
        metadata.update(target_metadata)
    source_metadata = source_payload.get("metadata")
    if isinstance(source_metadata, dict):
        metadata.update(source_metadata)
    metadata.update(
        _parse_json_object(data.get("saveMetadataJson"), "saveMetadataJson")
    )

    if source_payload.get("surl") not in (None, ""):
        metadata.setdefault("surl", source_payload.get("surl"))
    if source_payload.get("baseUrl") not in (None, ""):
        metadata.setdefault("baseUrl", source_payload.get("baseUrl"))
    if source_payload.get("readUrl") not in (None, ""):
        metadata.setdefault("readUrl", source_payload.get("readUrl"))

    secrets = _collect_source_secrets(source_payload)
    secrets.update(_parse_json_object(data.get("saveSecretsJson"), "saveSecretsJson"))

    return {
        "provider": provider,
        "emailAddress": email_address,
        "identifier": identifier,
        "accountTag": account_tag,
        "authType": auth_type,
        "metadata": metadata,
        "secrets": secrets,
        "name": str(data.get("saveName") or account_tag or email_address).strip(),
        "description": str(data.get("saveDescription") or "").strip() or None,
        "isVisible": _safe_bool(data.get("isVisible"), True),
        "isValid": _safe_bool(data.get("isValid"), True),
    }


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

    if action != "save_email" and not provider:
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

    if action == "save_email":
        source_payload = _resolve_save_source(ctx, data, __)
        save_payload = _build_save_payload(source_payload, data)
        saved_account = email_service.upsert_account(
            user_id=user_id,
            provider=save_payload["provider"],
            address=save_payload["emailAddress"],
            identifier=save_payload["identifier"],
            auth_type=save_payload["authType"],
            secrets=save_payload["secrets"],
            metadata=save_payload["metadata"],
            account_tag=save_payload["accountTag"],
            name=save_payload["name"],
            description=save_payload["description"],
            is_visible=save_payload["isVisible"],
            is_valid=save_payload["isValid"],
        )
        result.message = "Email saved"
        result.data = {
            "result": saved_account.address or saved_account.identifier or "",
            "provider": saved_account.provider,
            "emailAddress": saved_account.address,
            "identifier": saved_account.identifier,
            "accountTag": saved_account.account_tag,
            "authType": saved_account.auth_type,
            "persisted": True,
            "credentialId": saved_account.credential_id,
            "account": saved_account.to_dict(),
            "source": source_payload,
            "savedAt": _iso_utc_now(),
        }
        ctx.outputs[node_id] = result.data
        return

    result.status = "skipped"
    result.message = f"未知 email action: {action}"
