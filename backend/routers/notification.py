"""通知设置与通道管理。"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from core.notifications import (
    get_notification_channel_map,
    get_notification_recipients,
    send_test_notification,
    get_system_notification_rules,
    notification_channel_definitions,
    notification_rule_events,
    system_notification_event_options,
)
from models.database import get_db
from models.db_models import (
    NotificationChannelConfigModel,
    NotificationSettingsModel,
    UserModel,
)
from routers.auth import get_current_user

router = APIRouter(prefix="/api/notifications", tags=["notifications"])


def ensure_admin(user: UserModel) -> UserModel:
    if user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin privileges required",
        )
    return user


class NotificationChannelConfigResponse(BaseModel):
    id: str
    channel_type: str
    display_name: str
    enabled: bool
    config: Dict[str, Any]
    supported_events: List[str]


class NotificationRecipientResponse(BaseModel):
    id: str
    name: str
    type: str
    target: str
    enabled: bool
    headers: Dict[str, Any] = {}
    secret: Optional[str] = None
    method: Optional[str] = None
    body_template: Optional[str] = None


class NotificationRecipientInput(BaseModel):
    id: Optional[str] = None
    name: str = Field(..., min_length=1, max_length=128)
    type: str = Field(..., min_length=1, max_length=32)
    target: str = Field(..., min_length=1, max_length=1024)
    enabled: bool = True
    headers: Optional[Dict[str, Any]] = None
    secret: Optional[str] = Field(default=None, max_length=256)
    method: Optional[str] = Field(default=None, max_length=16)
    body_template: Optional[str] = None


class SystemNotificationRuleResponse(BaseModel):
    event: str
    label: str
    enabled: bool
    recipient_ids: List[str]


class SystemNotificationRuleInput(BaseModel):
    event: str = Field(..., min_length=1, max_length=64)
    enabled: bool = True
    recipient_ids: List[str] = []


class NotificationChannelConfigUpdate(BaseModel):
    enabled: Optional[bool] = None
    config: Optional[Dict[str, Any]] = None
    display_name: Optional[str] = Field(default=None, max_length=64)


class NotificationSystemSettingsResponse(BaseModel):
    channels: List[NotificationChannelConfigResponse]
    recipients: List[NotificationRecipientResponse]
    channel_definitions: List[Dict[str, Any]]
    event_options: List[Dict[str, str]]
    system_event_options: List[Dict[str, str]]
    system_rules: List[SystemNotificationRuleResponse]


class NotificationTestSendRequest(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    content: str = Field(..., min_length=1, max_length=5000)
    recipient_ids: List[str] = []
    send_to_all: bool = False


class NotificationTestSendResult(BaseModel):
    recipient_id: Optional[str] = None
    name: Optional[str] = None
    status: str
    reason: Optional[str] = None


class NotificationTestSendResponse(BaseModel):
    target_count: int
    success_count: int
    failed_count: int
    skipped_count: int
    details: List[NotificationTestSendResult]


def get_or_create_notification_settings(
    db: Session, user: UserModel
) -> NotificationSettingsModel:
    settings = (
        db.query(NotificationSettingsModel)
        .filter(NotificationSettingsModel.user_id == user.id)
        .first()
    )
    if not settings:
        settings = NotificationSettingsModel(
            user_id=user.id,
            recipients=[],
            system_rules=[],
        )
        db.add(settings)
        db.flush()
    return settings


@router.get("/settings", response_model=NotificationSystemSettingsResponse)
async def get_notification_settings(
    user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    channel_map = get_notification_channel_map()
    return NotificationSystemSettingsResponse(
        channels=[
            NotificationChannelConfigResponse(**item) for item in channel_map.values()
        ],
        recipients=[
            NotificationRecipientResponse(**item)
            for item in get_notification_recipients(user.id)
        ],
        channel_definitions=notification_channel_definitions(),
        event_options=notification_rule_events(),
        system_event_options=system_notification_event_options(),
        system_rules=[
            SystemNotificationRuleResponse(**item)
            for item in get_system_notification_rules(user.id)
        ],
    )


@router.put(
    "/settings/channels/{channel_type}",
    response_model=NotificationChannelConfigResponse,
)
async def update_notification_channel(
    channel_type: Literal["email", "webhook"],
    data: NotificationChannelConfigUpdate,
    user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    ensure_admin(user)
    config = (
        db.query(NotificationChannelConfigModel)
        .filter(NotificationChannelConfigModel.channel_type == channel_type)
        .first()
    )
    if not config:
        defaults = get_notification_channel_map().get(channel_type)
        if not defaults:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Unsupported notification channel",
            )
        config = NotificationChannelConfigModel(
            channel_type=channel_type,
            display_name=defaults["display_name"],
            enabled=defaults["enabled"],
            config=defaults["config"],
        )
        db.add(config)
        db.flush()

    if data.enabled is not None:
        config.enabled = data.enabled
    if data.display_name is not None:
        config.display_name = data.display_name
    if data.config is not None:
        config.config = data.config
    config.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(config)

    return NotificationChannelConfigResponse(
        id=config.id,
        channel_type=config.channel_type,
        display_name=config.display_name,
        enabled=config.enabled,
        config=config.config or {},
        supported_events=get_notification_channel_map()
        .get(channel_type, {})
        .get("supported_events", []),
    )


@router.put(
    "/settings/recipients/items",
    response_model=List[NotificationRecipientResponse],
)
async def update_notification_recipients(
    recipients: List[NotificationRecipientInput],
    user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    supported_types = {
        item["type"] for item in notification_channel_definitions() if item.get("type")
    }
    normalized: List[Dict[str, Any]] = []
    for item in recipients:
        channel_type = item.type.strip().lower()
        if channel_type not in supported_types:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Unsupported recipient type: {channel_type}",
            )
        target = item.target.strip()
        recipient_id = (item.id or "").strip() or f"{channel_type}:{target}"
        normalized.append(
            {
                "id": recipient_id,
                "name": item.name.strip(),
                "type": channel_type,
                "target": target,
                "enabled": item.enabled,
                "headers": item.headers or {},
                "secret": item.secret.strip() if item.secret else "",
                "method": item.method.strip().upper() if item.method else "POST",
                "body_template": (item.body_template or "").strip(),
            }
        )

    settings = get_or_create_notification_settings(db, user)
    settings.recipients = normalized
    settings.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(settings)

    return [NotificationRecipientResponse(**item) for item in normalized]


@router.put(
    "/settings/system/rules",
    response_model=List[SystemNotificationRuleResponse],
)
async def update_system_notification_rules(
    rules: List[SystemNotificationRuleInput],
    user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    supported_events = {
        item["value"]
        for item in system_notification_event_options()
        if item.get("value")
    }
    event_labels = {
        item["value"]: item["label"] for item in system_notification_event_options()
    }
    normalized: List[Dict[str, Any]] = []
    for item in rules:
        event_name = item.event.strip()
        if event_name not in supported_events:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Unsupported system event: {event_name}",
            )
        normalized.append(
            {
                "event": event_name,
                "label": event_labels.get(event_name, event_name),
                "enabled": item.enabled,
                "recipient_ids": [
                    str(value).strip()
                    for value in item.recipient_ids
                    if str(value).strip()
                ],
            }
        )

    settings = get_or_create_notification_settings(db, user)
    settings.system_rules = normalized
    settings.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(settings)

    return [SystemNotificationRuleResponse(**item) for item in normalized]


@router.post(
    "/settings/test/send",
    response_model=NotificationTestSendResponse,
)
async def send_notification_test_message(
    data: NotificationTestSendRequest,
    user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not data.send_to_all and not any(
        str(value).strip() for value in data.recipient_ids
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="请选择至少一个接收者，或选择发送给全部接收者",
        )

    result = await send_test_notification(
        user_id=user.id,
        title=data.title.strip(),
        content=data.content.strip(),
        recipient_ids=data.recipient_ids,
        send_to_all=data.send_to_all,
    )
    return NotificationTestSendResponse(**result)
