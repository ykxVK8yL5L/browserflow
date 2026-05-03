"""Email account 路由。"""

from datetime import datetime
import imaplib
import json
import socket
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from core.email_service.presets import EmailProviderPresetStore
from models.database import get_db
from models.db_models import EmailAccountModel, UserModel
from routers.auth import get_current_user
from utils.auth_utils import decrypt_data, encrypt_data

router = APIRouter(prefix="/api/email-accounts", tags=["email-accounts"])


class EmailAccountCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=128)
    provider: str = Field(..., min_length=1, max_length=64)
    credential_data: dict
    description: Optional[str] = None
    is_visible: bool = True


class EmailAccountUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=128)
    provider: Optional[str] = Field(None, min_length=1, max_length=64)
    credential_data: Optional[dict] = None
    description: Optional[str] = None
    is_visible: Optional[bool] = None
    is_valid: Optional[bool] = None


class EmailAccountListResponse(BaseModel):
    id: str
    name: str
    provider: str
    address: Optional[str]
    description: Optional[str]
    credential_data: dict
    is_visible: bool
    is_valid: bool
    last_used: Optional[datetime]
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class EmailAccountResponse(BaseModel):
    id: str
    name: str
    provider: str
    address: Optional[str]
    description: Optional[str]
    is_visible: bool
    is_valid: bool
    last_used: Optional[datetime]
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class EmailReceiveTestResponse(BaseModel):
    success: bool
    provider: str
    host: str
    port: int
    secure: bool
    mailbox: str
    mailbox_count: int
    message_count: int
    message: str


SENSITIVE_CREDENTIAL_KEYS = {
    "password",
    "token",
    "accessToken",
    "access_token",
    "refreshToken",
    "refresh_token",
    "clientSecret",
    "client_secret",
    "secret",
    "cookies",
    "cookie",
    "userId",
    "user_id",
}


def encrypt_credential_data(data: dict, user_id: str) -> str:
    return encrypt_data(json.dumps(data), user_id)


def decrypt_credential_data(encrypted_data: str, user_id: str) -> dict:
    try:
        return json.loads(decrypt_data(encrypted_data, user_id))
    except Exception:
        return {}


def sanitize_credential_data(data: dict | None) -> dict:
    if not isinstance(data, dict):
        return {}
    return {
        key: value
        for key, value in data.items()
        if key not in SENSITIVE_CREDENTIAL_KEYS
    }


def build_safe_credential_response_data(data: dict, is_visible: bool) -> dict:
    sanitized = sanitize_credential_data(data)
    if is_visible:
        return sanitized

    credential_type = sanitized.get("type") if isinstance(sanitized, dict) else None
    return {"type": credential_type} if isinstance(credential_type, str) else {}


def merge_credential_data(existing_data: dict, incoming_data: dict) -> dict:
    if not isinstance(existing_data, dict):
        existing_data = {}
    if not isinstance(incoming_data, dict):
        return dict(existing_data)

    merged = dict(existing_data)
    for key, value in incoming_data.items():
        if (
            key in SENSITIVE_CREDENTIAL_KEYS
            and isinstance(value, str)
            and not value.strip()
        ):
            continue
        merged[key] = value
    return merged


def extract_provider(data: dict, fallback: str = "imap") -> str:
    return str(data.get("provider") or data.get("type") or fallback).strip().lower()


def extract_address(data: dict) -> str | None:
    address = (
        str(data.get("address") or data.get("email") or data.get("identifier") or "")
        .strip()
        .lower()
    )
    return address or None


def resolve_imap_connection_settings(credential_data: dict) -> tuple[str, int, bool]:
    provider = extract_provider(credential_data)
    address = extract_address(credential_data) or ""

    preset_store = EmailProviderPresetStore()
    preset = None
    if address and "@" in address:
        domain = address.rsplit("@", 1)[1]
        preset = preset_store.match_by_domain(domain)
    if preset is None:
        preset = preset_store.get(provider)

    preset_imap = (
        preset.imap if preset is not None and isinstance(preset.imap, dict) else {}
    )

    host = str(preset_imap.get("host") or "").strip()
    port_value = preset_imap.get("port") or 993
    secure_value = preset_imap.get("secure", True)

    if not host:
        host = str(
            credential_data.get("imapHost") or credential_data.get("host") or ""
        ).strip()

    if port_value in (None, ""):
        port_value = credential_data.get("imapPort") or credential_data.get("port")

    try:
        port = int(port_value)
    except (TypeError, ValueError):
        port = 993

    if secure_value is None:
        secure_value = credential_data.get("imapSecure")
    if secure_value is None:
        secure_value = credential_data.get("secure")

    secure = bool(True if secure_value is None else secure_value)

    if not host:
        raise ValueError(
            "未找到 IMAP 主机配置，请先为该邮箱补充 provider preset 或手动配置 host"
        )

    return host, port, secure


def parse_imap_mailbox_name(raw_line: bytes | str) -> str | None:
    line = (
        raw_line.decode("utf-8", errors="ignore")
        if isinstance(raw_line, bytes)
        else str(raw_line)
    )
    line = line.strip()
    if not line:
        return None

    if ' "/" ' in line:
        candidate = line.rsplit(' "/" ', 1)[-1].strip()
    elif ' "." ' in line:
        candidate = line.rsplit(' "." ', 1)[-1].strip()
    else:
        parts = line.split(" ")
        candidate = parts[-1].strip() if parts else ""

    if candidate.startswith('"') and candidate.endswith('"'):
        candidate = candidate[1:-1]

    return candidate or None


def choose_test_mailbox(mailboxes: list[str]) -> str | None:
    if not mailboxes:
        return None
    normalized_map = {
        mailbox.lower().strip(): mailbox for mailbox in mailboxes if mailbox.strip()
    }
    for preferred in ("inbox", "收件箱"):
        if preferred in normalized_map:
            return normalized_map[preferred]
    return next((mailbox for mailbox in mailboxes if mailbox.strip()), None)


@router.post("", response_model=EmailAccountResponse)
async def create_email_account(
    data: EmailAccountCreate,
    user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    provider = str(data.provider).strip().lower()
    address = extract_address(data.credential_data)
    account = EmailAccountModel(
        user_id=user.id,
        name=data.name,
        provider=provider,
        address=address,
        credential_data=encrypt_credential_data(data.credential_data, user.id),
        description=data.description,
        is_visible=data.is_visible,
    )
    db.add(account)
    db.commit()
    db.refresh(account)

    return EmailAccountResponse.model_validate(account)


@router.get("", response_model=List[EmailAccountListResponse])
async def list_email_accounts(
    provider: Optional[str] = None,
    is_valid: Optional[bool] = None,
    user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    query = db.query(EmailAccountModel).filter(EmailAccountModel.user_id == user.id)
    if provider:
        query = query.filter(EmailAccountModel.provider == provider)
    if is_valid is not None:
        query = query.filter(EmailAccountModel.is_valid == is_valid)

    accounts = query.order_by(EmailAccountModel.updated_at.desc()).all()
    return [
        EmailAccountListResponse(
            id=account.id,
            name=account.name,
            provider=account.provider,
            address=account.address,
            description=account.description,
            credential_data=build_safe_credential_response_data(
                decrypt_credential_data(account.credential_data, user.id),
                account.is_visible,
            ),
            is_visible=account.is_visible,
            is_valid=account.is_valid,
            last_used=account.last_used,
            created_at=account.created_at,
            updated_at=account.updated_at,
        )
        for account in accounts
    ]


@router.put("/{account_id}", response_model=EmailAccountResponse)
async def update_email_account(
    account_id: str,
    data: EmailAccountUpdate,
    user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    account = (
        db.query(EmailAccountModel)
        .filter(
            EmailAccountModel.id == account_id, EmailAccountModel.user_id == user.id
        )
        .first()
    )
    if not account:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Email account not found"
        )

    if data.name is not None:
        account.name = data.name
    if data.provider is not None:
        account.provider = str(data.provider).strip().lower()
    if data.credential_data is not None:
        existing_data = decrypt_credential_data(account.credential_data, user.id)
        merged_data = merge_credential_data(existing_data, data.credential_data)
        account.address = extract_address(merged_data)
        account.credential_data = encrypt_credential_data(merged_data, user.id)
    if data.description is not None:
        account.description = data.description
    if data.is_visible is not None:
        account.is_visible = data.is_visible
    if data.is_valid is not None:
        account.is_valid = data.is_valid

    account.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(account)
    return EmailAccountResponse.model_validate(account)


@router.delete("/{account_id}")
async def delete_email_account(
    account_id: str,
    user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    account = (
        db.query(EmailAccountModel)
        .filter(
            EmailAccountModel.id == account_id, EmailAccountModel.user_id == user.id
        )
        .first()
    )
    if not account:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Email account not found"
        )

    db.delete(account)
    db.commit()
    return {"message": "Email account deleted successfully"}


@router.post(
    "/{account_id}/test-email-receive", response_model=EmailReceiveTestResponse
)
async def test_email_receive(
    account_id: str,
    user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    account = (
        db.query(EmailAccountModel)
        .filter(
            EmailAccountModel.id == account_id, EmailAccountModel.user_id == user.id
        )
        .first()
    )
    if not account:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Email account not found"
        )

    credential_data = decrypt_credential_data(account.credential_data, user.id)
    provider = extract_provider(credential_data, account.provider)
    if provider != "imap":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="当前仅支持测试 IMAP 收信能力",
        )

    username = str(
        credential_data.get("username")
        or credential_data.get("address")
        or credential_data.get("email")
        or credential_data.get("identifier")
        or ""
    ).strip()
    password = str(credential_data.get("password") or "")
    if not username or not password:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="当前账号缺少邮箱地址或密码，无法测试收信",
        )

    try:
        host, port, secure = resolve_imap_connection_settings(credential_data)
    except ValueError as error:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=str(error)
        ) from error

    client = None
    try:
        if secure:
            client = imaplib.IMAP4_SSL(host=host, port=port, timeout=15)
        else:
            client = imaplib.IMAP4(host=host, port=port, timeout=15)

        client.login(username, password)
        list_status, list_data = client.list()
        if list_status != "OK":
            raise RuntimeError("已登录，但无法读取邮箱文件夹列表")

        mailbox_names = [
            mailbox
            for mailbox in (parse_imap_mailbox_name(item) for item in (list_data or []))
            if mailbox
        ]
        mailbox_name = choose_test_mailbox(mailbox_names)
        if not mailbox_name:
            raise RuntimeError("已登录，但未找到可用于测试的邮箱文件夹")

        select_status, select_data = client.select(mailbox_name, readonly=True)
        if select_status != "OK":
            raise RuntimeError(f"已登录，但无法访问邮箱文件夹: {mailbox_name}")

        try:
            message_count = int((select_data or [b"0"])[0])
        except (TypeError, ValueError, IndexError):
            message_count = 0

        search_status, _ = client.search(None, "ALL")
        if search_status != "OK":
            raise RuntimeError(f"邮箱文件夹可访问，但无法搜索邮件: {mailbox_name}")

        account.is_valid = True
        account.last_used = datetime.utcnow()
        account.updated_at = datetime.utcnow()
        db.commit()

        return EmailReceiveTestResponse(
            success=True,
            provider=provider,
            host=host,
            port=port,
            secure=secure,
            mailbox=mailbox_name,
            mailbox_count=len(mailbox_names),
            message_count=message_count,
            message="收信测试成功",
        )
    except (
        imaplib.IMAP4.error,
        TimeoutError,
        socket.timeout,
        OSError,
        RuntimeError,
    ) as error:
        account.is_valid = False
        account.updated_at = datetime.utcnow()
        db.commit()
        detail = str(error).strip() or "收信测试失败"
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"IMAP 收信测试失败: {detail}",
        ) from error
    finally:
        if client is not None:
            try:
                client.logout()
            except Exception:
                pass
