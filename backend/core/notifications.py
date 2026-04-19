"""通知发送与扩展入口。"""

from __future__ import annotations

import json
import re
from datetime import datetime
from typing import Any, Dict, List, Optional

import httpx

from models.database import SessionLocal
from models.db_models import (
    ExecutionModel,
    FlowModel,
    NotificationChannelConfigModel,
    NotificationSettingsModel,
)
from utils.email_utils import send_email

DEFAULT_CHANNELS = {
    "email": {
        "display_name": "邮件通知",
        "enabled": True,
        "config": {},
    },
    "webhook": {
        "display_name": "Webhook 通知",
        "enabled": True,
        "config": {},
    },
}

DEFAULT_EVENTS = [
    "execution_started",
    "execution_completed",
    "execution_failed",
    "execution_cancelled",
]

DEFAULT_FLOW_NOTIFICATION_LEVEL = "flow_result"
FLOW_NOTIFICATION_LEVELS = [
    "flow_result",
    "node_results",
    "node_results_with_data",
    "raw_data",
]

DEFAULT_SYSTEM_EVENTS = [
    "user_login",
]

DEFAULT_SYSTEM_RULES = [
    {
        "event": "user_login",
        "label": "用户登录",
        "enabled": False,
        "recipient_ids": [],
    }
]


class NotificationChannel:
    channel_type: str = "base"

    async def send(
        self,
        recipient: Dict[str, Any],
        payload: Dict[str, Any],
        channel_config: Dict[str, Any],
    ) -> bool:
        raise NotImplementedError()


class EmailNotificationChannel(NotificationChannel):
    channel_type = "email"

    async def send(
        self,
        recipient: Dict[str, Any],
        payload: Dict[str, Any],
        channel_config: Dict[str, Any],
    ) -> bool:
        to_email = (recipient.get("target") or recipient.get("email") or "").strip()
        if not to_email:
            return False

        subject = payload.get("subject") or "BrowserFlow 通知"
        body = payload.get("text") or ""
        html = payload.get("html")
        return send_email(to_email, subject, body, html)


class WebhookNotificationChannel(NotificationChannel):
    channel_type = "webhook"

    async def send(
        self,
        recipient: Dict[str, Any],
        payload: Dict[str, Any],
        channel_config: Dict[str, Any],
    ) -> bool:
        context = build_template_context(payload)
        url = sanitize_webhook_url(
            render_template(
                recipient.get("target") or recipient.get("url") or "", context
            )
        )
        if not url:
            return False

        secret = recipient.get("secret") or channel_config.get("default_secret")
        method = str(recipient.get("method") or "POST").strip().upper() or "POST"
        raw_headers = recipient.get("headers") or {}
        headers = {
            "Content-Type": "application/json",
            **render_template_object(raw_headers, context),
        }
        if secret:
            headers["X-BrowserFlow-Signature"] = secret

        body_template = recipient.get("body_template")
        if isinstance(body_template, str) and body_template.strip():
            content_type = str(headers.get("Content-Type") or "").lower()
            if "application/json" in content_type:
                try:
                    request_body = json.loads(
                        render_json_template(body_template, context)
                    )
                except json.JSONDecodeError:
                    request_body = render_template(body_template, context)
            else:
                request_body = render_template(body_template, context)
        else:
            request_body = payload.get("data") or payload

        timeout_seconds = float(channel_config.get("timeout_seconds") or 10)
        async with httpx.AsyncClient(timeout=timeout_seconds) as client:
            if isinstance(request_body, (dict, list)):
                response = await client.request(
                    method,
                    url,
                    json=request_body,
                    headers=headers,
                )
            else:
                response = await client.request(
                    method,
                    url,
                    content=str(request_body),
                    headers=headers,
                )
            response.raise_for_status()
        return True


CHANNEL_REGISTRY: Dict[str, NotificationChannel] = {
    EmailNotificationChannel.channel_type: EmailNotificationChannel(),
    WebhookNotificationChannel.channel_type: WebhookNotificationChannel(),
}


def _normalize_recipient(
    item: Any,
) -> Optional[Dict[str, Any]]:
    if not isinstance(item, dict):
        return None

    recipient_id = str(item.get("id") or "").strip()
    name = str(item.get("name") or "").strip()
    channel_type = str(item.get("type") or "").strip().lower()
    target = str(
        item.get("target") or item.get("url") or item.get("email") or ""
    ).strip()
    if not recipient_id or not target or not channel_type:
        return None

    return {
        "id": recipient_id,
        "name": name or target,
        "type": channel_type,
        "target": target,
        "enabled": bool(item.get("enabled", True)),
        "headers": item.get("headers") if isinstance(item.get("headers"), dict) else {},
        "secret": str(item.get("secret") or "").strip(),
        "method": str(item.get("method") or "POST").strip().upper() or "POST",
        "body_template": str(item.get("body_template") or "").strip(),
    }


def render_template(template: Any, context: Dict[str, Any]) -> str:
    text = str(template or "")
    pattern = re.compile(r"\{\{\s*([a-zA-Z0-9_]+)\s*\}\}")
    return pattern.sub(lambda match: str(context.get(match.group(1), "")), text)


def render_json_template(template: Any, context: Dict[str, Any]) -> str:
    text = str(template or "")
    pattern = re.compile(r'"\{\{\s*([a-zA-Z0-9_]+)\s*\}\}"')

    def replace_quoted(match: re.Match[str]) -> str:
        key = match.group(1)
        return json.dumps(context.get(key, ""), ensure_ascii=False)

    rendered = pattern.sub(replace_quoted, text)
    return render_template(rendered, context)


def sanitize_webhook_url(value: Any) -> str:
    url = str(value or "").strip()
    if not url:
        return ""
    for ch in ['"', "'", "“", "”", "‘", "’"]:
        url = url.replace(ch, "")
    return url.strip()


def render_template_object(value: Any, context: Dict[str, Any]) -> Any:
    if isinstance(value, dict):
        return {str(k): render_template_object(v, context) for k, v in value.items()}
    if isinstance(value, list):
        return [render_template_object(item, context) for item in value]
    return render_template(value, context)


def build_template_context(payload: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "title": payload.get("subject") or payload.get("title") or "",
        "content": payload.get("text") or payload.get("content") or "",
    }


def normalize_flow_notification_level(value: Any) -> str:
    level = str(value or "").strip()
    if level not in FLOW_NOTIFICATION_LEVELS:
        return DEFAULT_FLOW_NOTIFICATION_LEVEL
    return level


def build_execution_base_data(
    flow: FlowModel,
    execution: ExecutionModel,
    event: str,
) -> Dict[str, Any]:
    return {
        "event": event,
        "timestamp": datetime.utcnow().isoformat(),
        "flow": {
            "id": flow.id,
            "name": flow.name,
        },
        "execution": {
            "id": execution.id,
            "status": execution.status,
            "started_at": (
                execution.started_at.isoformat() if execution.started_at else None
            ),
            "finished_at": (
                execution.finished_at.isoformat() if execution.finished_at else None
            ),
            "error_message": execution.error_message,
        },
    }


def build_execution_summary_lines(
    flow: FlowModel,
    execution: ExecutionModel,
    event: str,
) -> List[str]:
    return [
        f"Flow: {flow.name}",
        f"事件: {event}",
        f"状态: {execution.status}",
        f"执行ID: {execution.id}",
        f"开始时间: {execution.started_at.isoformat() if execution.started_at else '—'}",
        f"结束时间: {execution.finished_at.isoformat() if execution.finished_at else '—'}",
        f"错误信息: {execution.error_message or '—'}",
    ]


def build_node_lines(nodes: List[Dict[str, Any]], include_data: bool) -> List[str]:
    lines: List[str] = []
    for index, node in enumerate(nodes, start=1):
        lines.extend(
            [
                f"节点 {index}: {node.get('nodeType') or 'unknown'} ({node.get('nodeId') or '—'})",
                f"  状态: {node.get('status') or '—'}",
                f"  耗时: {node.get('durationMs') if node.get('durationMs') is not None else '—'} ms",
                f"  消息: {node.get('message') or '—'}",
                f"  错误: {node.get('error') or '—'}",
            ]
        )
        if include_data:
            node_data = node.get("data")
            try:
                data_text = json.dumps(node_data, ensure_ascii=False, indent=2)
            except TypeError:
                data_text = str(node_data)
            lines.append("  返回数据:")
            lines.append(data_text if data_text else "  —")
    return lines


def get_notification_settings_record() -> NotificationSettingsModel:
    db = SessionLocal()
    try:
        settings = db.query(NotificationSettingsModel).first()
        if not settings:
            settings = NotificationSettingsModel(recipients=[], system_rules=[])
            db.add(settings)
            db.commit()
            db.refresh(settings)
        else:
            recipients = (
                settings.recipients if isinstance(settings.recipients, list) else []
            )
            system_rules = (
                settings.system_rules if isinstance(settings.system_rules, list) else []
            )
            changed = False
            if settings.recipients != recipients:
                settings.recipients = recipients
                changed = True
            if settings.system_rules != system_rules:
                settings.system_rules = system_rules
                changed = True
            if changed:
                db.commit()
                db.refresh(settings)
        db.expunge(settings)
        return settings
    finally:
        db.close()


def get_notification_recipients() -> List[Dict[str, Any]]:
    settings = get_notification_settings_record()
    recipients: List[Dict[str, Any]] = []
    for item in settings.recipients or []:
        normalized = _normalize_recipient(item)
        if normalized:
            recipients.append(normalized)
    return recipients


def get_notification_recipient_map() -> Dict[str, Dict[str, Any]]:
    return {item["id"]: item for item in get_notification_recipients()}


def get_system_notification_rules() -> List[Dict[str, Any]]:
    settings = get_notification_settings_record()
    stored_rules = (
        settings.system_rules if isinstance(settings.system_rules, list) else []
    )
    stored_map = {
        str(item.get("event") or "").strip(): item
        for item in stored_rules
        if isinstance(item, dict)
    }
    normalized: List[Dict[str, Any]] = []
    for item in DEFAULT_SYSTEM_RULES:
        current = stored_map.get(item["event"], {})
        recipient_ids = current.get("recipient_ids") or []
        if not isinstance(recipient_ids, list):
            recipient_ids = []
        normalized.append(
            {
                "event": item["event"],
                "label": item["label"],
                "enabled": bool(current.get("enabled", item["enabled"])),
                "recipient_ids": [
                    str(value).strip() for value in recipient_ids if str(value).strip()
                ],
            }
        )
    return normalized


def get_notification_channel_configs() -> List[NotificationChannelConfigModel]:
    db = SessionLocal()
    try:
        configs = db.query(NotificationChannelConfigModel).all()
        known = {item.channel_type for item in configs}
        created = False
        for channel_type, defaults in DEFAULT_CHANNELS.items():
            if channel_type not in known:
                db.add(
                    NotificationChannelConfigModel(
                        channel_type=channel_type,
                        display_name=defaults["display_name"],
                        enabled=defaults["enabled"],
                        config=defaults["config"],
                    )
                )
                created = True
        if created:
            db.commit()
            configs = db.query(NotificationChannelConfigModel).all()
        return configs
    finally:
        db.close()


def get_notification_channel_map() -> Dict[str, Dict[str, Any]]:
    configs = get_notification_channel_configs()
    result: Dict[str, Dict[str, Any]] = {}
    for item in configs:
        result[item.channel_type] = {
            "id": item.id,
            "channel_type": item.channel_type,
            "display_name": item.display_name,
            "enabled": item.enabled,
            "config": item.config or {},
            "supported_events": list(DEFAULT_EVENTS),
        }
    for channel_type, defaults in DEFAULT_CHANNELS.items():
        if channel_type not in result:
            result[channel_type] = {
                "id": "",
                "channel_type": channel_type,
                "display_name": defaults["display_name"],
                "enabled": defaults["enabled"],
                "config": defaults["config"],
                "supported_events": list(DEFAULT_EVENTS),
            }
    return result


def build_notification_payload(
    flow: FlowModel,
    execution: ExecutionModel,
    event: str,
    level: str = DEFAULT_FLOW_NOTIFICATION_LEVEL,
    node_results: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    normalized_level = normalize_flow_notification_level(level)
    status_label = {
        "execution_started": "开始执行",
        "execution_completed": "执行成功",
        "execution_failed": "执行失败",
        "execution_cancelled": "执行已取消",
    }.get(event, event)
    title = f"[{status_label}] {flow.name}"

    # 先构建数据对象，以便 raw_data 级别可以使用
    data = build_execution_base_data(flow, execution, event)
    data["notification_level"] = normalized_level
    nodes = node_results if isinstance(node_results, list) else []
    if normalized_level == "node_results":
        data["nodes"] = [
            {
                "nodeId": node.get("nodeId"),
                "nodeType": node.get("nodeType"),
                "status": node.get("status"),
                "startedAt": node.get("startedAt"),
                "finishedAt": node.get("finishedAt"),
                "durationMs": node.get("durationMs"),
                "message": node.get("message"),
                "error": node.get("error"),
            }
            for node in nodes
        ]
    elif normalized_level in ("node_results_with_data", "raw_data"):
        data["nodes"] = nodes

    if normalized_level == "raw_data":
        # 对于 raw_data 级别，正文直接就是 JSON 字符串
        text = json.dumps(data, ensure_ascii=False, indent=2)
    else:
        summary_lines = build_execution_summary_lines(flow, execution, event)
        if normalized_level == "node_results":
            summary_lines.extend(["", "节点执行结果:", *build_node_lines(nodes, False)])
        elif normalized_level == "node_results_with_data":
            summary_lines.extend(
                ["", "节点执行结果与返回数据:", *build_node_lines(nodes, True)]
            )
        text = "\n".join(summary_lines)

    return {
        "subject": title,
        "text": text,
        "html": None,
        "data": data,
    }


async def dispatch_flow_notifications(
    execution_id: str,
    event: str,
    node_results: Optional[List[Dict[str, Any]]] = None,
) -> None:
    if event not in DEFAULT_EVENTS:
        return

    db = SessionLocal()
    try:
        execution = (
            db.query(ExecutionModel).filter(ExecutionModel.id == execution_id).first()
        )
        if not execution:
            return
        flow = db.query(FlowModel).filter(FlowModel.id == execution.flow_id).first()
        if not flow:
            return
        if not getattr(flow, "notification_enabled", True):
            return

        channel_map = get_notification_channel_map()
        recipient_map = get_notification_recipient_map()
        rules = flow.notification_rules or []
        if not isinstance(rules, list):
            return

        for rule in rules:
            if not isinstance(rule, dict):
                continue
            if not rule.get("enabled", True):
                continue
            events = rule.get("events") or []
            if event not in events:
                continue
            recipient_id = str(rule.get("recipient_id") or "").strip()
            recipient = recipient_map.get(recipient_id) if recipient_id else None
            if recipient is None and rule.get("target"):
                recipient = {
                    "id": recipient_id or str(rule.get("id") or ""),
                    "name": rule.get("name") or rule.get("target"),
                    "type": rule.get("type"),
                    "target": rule.get("target"),
                    "headers": rule.get("headers") or {},
                    "secret": rule.get("secret"),
                    "enabled": True,
                }
            if not recipient or not recipient.get("enabled", True):
                continue
            channel_type = recipient.get("type")
            channel = CHANNEL_REGISTRY.get(channel_type)
            channel_config = channel_map.get(channel_type)
            if not channel or not channel_config or not channel_config.get("enabled"):
                continue
            payload = build_notification_payload(
                flow,
                execution,
                event,
                rule.get("level"),
                node_results=node_results,
            )
            try:
                await channel.send(
                    recipient, payload, channel_config.get("config") or {}
                )
            except Exception as exc:
                print(f"[Notification] Failed to send {channel_type}: {exc}")
    finally:
        db.close()


def normalize_notification_rules(value: Optional[Any]) -> List[Dict[str, Any]]:
    if not isinstance(value, list):
        return []

    recipient_map = get_notification_recipient_map()
    normalized: List[Dict[str, Any]] = []
    for item in value:
        if not isinstance(item, dict):
            continue
        recipient_id = str(item.get("recipient_id") or "").strip()
        events = item.get("events") or []
        if not isinstance(events, list):
            events = []
        recipient = recipient_map.get(recipient_id) if recipient_id else None

        if recipient is None:
            channel_type = str(item.get("type") or "").strip().lower()
            target = str(
                item.get("target") or item.get("url") or item.get("email") or ""
            ).strip()
            if not channel_type or not target:
                continue
            recipient = {
                "id": recipient_id or str(item.get("id") or f"{channel_type}:{target}"),
                "name": str(item.get("name") or "").strip() or target,
                "type": channel_type,
                "target": target,
                "enabled": True,
                "headers": (
                    item.get("headers") if isinstance(item.get("headers"), dict) else {}
                ),
                "secret": item.get("secret"),
                "method": str(item.get("method") or "POST").strip().upper() or "POST",
            }

        normalized_id = str(item.get("id") or "").strip() or recipient["id"]

        normalized.append(
            {
                "id": normalized_id,
                "recipient_id": recipient["id"],
                "name": str(item.get("name") or "").strip() or recipient["name"],
                "type": recipient["type"],
                "target": recipient["target"],
                "enabled": bool(item.get("enabled", True)),
                "events": [event for event in events if event in DEFAULT_EVENTS],
                "level": normalize_flow_notification_level(item.get("level")),
                "headers": recipient.get("headers") or {},
                "secret": recipient.get("secret"),
                "method": recipient.get("method"),
            }
        )
    return normalized


def notification_rule_events() -> List[Dict[str, str]]:
    return [
        {"value": "execution_started", "label": "开始执行时"},
        {"value": "execution_completed", "label": "执行成功时"},
        {"value": "execution_failed", "label": "执行失败时"},
        {"value": "execution_cancelled", "label": "执行取消时"},
    ]


def flow_notification_level_options() -> List[Dict[str, str]]:
    return [
        {"value": "flow_result", "label": "仅 Flow 执行结果"},
        {"value": "node_results", "label": "每个节点执行结果"},
        {"value": "node_results_with_data", "label": "节点结果和返回数据"},
        {"value": "raw_data", "label": "仅发送执行 JSON 数据"},
    ]


def system_notification_event_options() -> List[Dict[str, str]]:
    return [
        {"value": "user_login", "label": "用户登录"},
    ]


def notification_channel_definitions() -> List[Dict[str, Any]]:
    return [
        {
            "type": "email",
            "label": "邮件",
            "fields": [
                {"name": "target", "label": "收件邮箱", "required": True},
            ],
        },
        {
            "type": "webhook",
            "label": "Webhook",
            "fields": [
                {"name": "target", "label": "Webhook URL", "required": True},
                {"name": "method", "label": "HTTP Method", "required": False},
                {"name": "secret", "label": "签名/密钥", "required": False},
                {"name": "headers", "label": "请求头", "required": False},
                {"name": "body_template", "label": "请求体模板", "required": False},
            ],
        },
    ]


async def dispatch_system_notification(event: str, payload: Dict[str, Any]) -> None:
    if event not in DEFAULT_SYSTEM_EVENTS:
        return

    channel_map = get_notification_channel_map()
    recipient_map = get_notification_recipient_map()
    rule = next(
        (
            item
            for item in get_system_notification_rules()
            if item.get("event") == event
        ),
        None,
    )
    if not rule or not rule.get("enabled"):
        return

    for recipient_id in rule.get("recipient_ids") or []:
        recipient = recipient_map.get(str(recipient_id).strip())
        if not recipient or not recipient.get("enabled", True):
            continue
        channel_type = recipient.get("type")
        channel = CHANNEL_REGISTRY.get(channel_type)
        channel_config = channel_map.get(channel_type)
        if not channel or not channel_config or not channel_config.get("enabled"):
            continue
        try:
            await channel.send(recipient, payload, channel_config.get("config") or {})
        except Exception as exc:
            print(f"[Notification] Failed to send system {channel_type}: {exc}")


async def send_test_notification(
    title: str,
    content: str,
    recipient_ids: Optional[List[str]] = None,
    send_to_all: bool = False,
) -> Dict[str, Any]:
    channel_map = get_notification_channel_map()
    all_recipients = get_notification_recipients()
    recipient_map = {item["id"]: item for item in all_recipients}

    if send_to_all:
        targets = [item for item in all_recipients if item.get("enabled", True)]
    else:
        requested_ids = [
            str(value).strip() for value in (recipient_ids or []) if str(value).strip()
        ]
        targets = []
        for recipient_id in requested_ids:
            recipient = recipient_map.get(recipient_id)
            if recipient and recipient.get("enabled", True):
                targets.append(recipient)

    payload = {
        "subject": title,
        "title": title,
        "text": content,
        "content": content,
        "html": None,
        "data": {
            "event": "test_notification",
            "timestamp": datetime.utcnow().isoformat(),
            "title": title,
            "content": content,
        },
    }

    success_count = 0
    failed_count = 0
    skipped_count = 0
    details: List[Dict[str, Any]] = []

    for recipient in targets:
        channel_type = str(recipient.get("type") or "").strip().lower()
        channel = CHANNEL_REGISTRY.get(channel_type)
        channel_config = channel_map.get(channel_type)
        if not channel or not channel_config or not channel_config.get("enabled"):
            skipped_count += 1
            details.append(
                {
                    "recipient_id": recipient.get("id"),
                    "name": recipient.get("name") or recipient.get("target"),
                    "status": "skipped",
                    "reason": "channel_disabled",
                }
            )
            continue

        try:
            await channel.send(recipient, payload, channel_config.get("config") or {})
            success_count += 1
            details.append(
                {
                    "recipient_id": recipient.get("id"),
                    "name": recipient.get("name") or recipient.get("target"),
                    "status": "success",
                }
            )
        except Exception as exc:
            failed_count += 1
            details.append(
                {
                    "recipient_id": recipient.get("id"),
                    "name": recipient.get("name") or recipient.get("target"),
                    "status": "failed",
                    "reason": str(exc),
                }
            )

    return {
        "target_count": len(targets),
        "success_count": success_count,
        "failed_count": failed_count,
        "skipped_count": skipped_count,
        "details": details,
    }
