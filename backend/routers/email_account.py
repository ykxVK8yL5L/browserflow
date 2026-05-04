"""Email account 路由。"""

import asyncio
import base64
from datetime import datetime, timedelta
import hashlib
import imaplib
import json
import secrets
import socket
from types import SimpleNamespace
from typing import List, Optional
from urllib.parse import urlparse, urlunparse
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from core.email_service.providers.outlook import OutlookEmailProvider
from core.email_service.presets import EmailProviderPresetStore
from core.email_service.service import EmailService
from models.database import get_db
from models.db_models import EmailAccountModel, UserModel
from routers.auth import get_current_user
from utils.auth_utils import decrypt_data, encrypt_data

router = APIRouter(prefix="/api/email-accounts", tags=["email-accounts"])
email_service = EmailService()
OUTLOOK_OAUTH_STATE_TTL = timedelta(minutes=15)
_outlook_oauth_states: dict[str, dict] = {}


class EmailProviderFieldResponse(BaseModel):
    key: str
    label: str
    inputType: str
    placeholder: str
    required: bool
    preserveOnBlank: bool


class EmailProviderDefinitionResponse(BaseModel):
    key: str
    label: str
    description: str
    importHint: str
    manualImportEnabled: bool
    supportsOAuth: bool
    supportsTestReceive: bool
    accountFields: list[EmailProviderFieldResponse]


class EmailAccountImportRequest(BaseModel):
    provider: str = Field(..., min_length=1, max_length=64)
    raw_text: str = Field(..., min_length=1)
    description: Optional[str] = None
    is_visible: bool = True


class EmailAccountImportResponse(BaseModel):
    count: int


class EmailAccountBulkDeleteRequest(BaseModel):
    ids: list[str] = Field(..., min_length=1)


class EmailAccountBulkDeleteResponse(BaseModel):
    deleted: int


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


class EmailAccountReauthorizeResponse(BaseModel):
    success: bool
    provider: str
    message: str
    expires_at: Optional[str] = None


class OutlookReauthorizeStartResponse(BaseModel):
    authorization_url: str
    state: str


class OutlookReauthorizeStartRequest(BaseModel):
    redirect_uri: Optional[str] = None


class OutlookReauthorizeCompleteRequest(BaseModel):
    state: str = Field(..., min_length=1)
    code: str = Field(..., min_length=1)


@router.get("/providers", response_model=List[EmailProviderDefinitionResponse])
async def list_email_providers(
    user: UserModel = Depends(get_current_user),
):
    del user
    return [
        EmailProviderDefinitionResponse.model_validate(item.to_dict())
        for item in email_service.list_provider_definitions()
    ]


@router.post("/import", response_model=EmailAccountImportResponse)
async def import_email_accounts(
    data: EmailAccountImportRequest,
    user: UserModel = Depends(get_current_user),
):
    imported = email_service.import_accounts(
        user_id=user.id,
        provider_key=data.provider,
        raw_text=data.raw_text,
        description=data.description,
        is_visible=data.is_visible,
    )
    return EmailAccountImportResponse(count=len(imported))


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


def _cleanup_outlook_oauth_states() -> None:
    now = datetime.utcnow()
    expired_keys = [
        key
        for key, payload in _outlook_oauth_states.items()
        if payload.get("expires_at") is None or payload["expires_at"] <= now
    ]
    for key in expired_keys:
        _outlook_oauth_states.pop(key, None)


def _normalize_outlook_redirect_uri(redirect_uri: str) -> str:
    parsed = urlparse(redirect_uri)
    if parsed.scheme not in {"http", "https"}:
        raise ValueError("redirect_uri 必须是 http 或 https 地址")
    if not parsed.netloc:
        raise ValueError("redirect_uri 缺少主机地址")

    hostname = parsed.hostname or ""
    if hostname == "127.0.0.1":
        netloc = parsed.netloc.replace("127.0.0.1", "localhost", 1)
        parsed = parsed._replace(netloc=netloc)

    return urlunparse(parsed)


def _build_outlook_redirect_uri(
    request: Request, override_redirect_uri: Optional[str] = None
) -> str:
    if override_redirect_uri:
        return _normalize_outlook_redirect_uri(override_redirect_uri.strip())
    return _normalize_outlook_redirect_uri(
        str(request.url_for("outlook_reauthorize_callback"))
    )


def _resolve_outlook_redirect_uri(
    request: Request,
    credential_data: dict,
    override_redirect_uri: Optional[str] = None,
) -> str:
    stored_redirect_uri = str(
        credential_data.get("redirectUri") or credential_data.get("redirect_uri") or ""
    ).strip()
    return _build_outlook_redirect_uri(
        request,
        override_redirect_uri or stored_redirect_uri or None,
    )


def _build_outlook_code_challenge(code_verifier: str) -> str:
    digest = hashlib.sha256(code_verifier.encode("utf-8")).digest()
    return base64.urlsafe_b64encode(digest).decode("utf-8").rstrip("=")


async def _complete_outlook_oauth_reauthorize(
    db: Session,
    state: str,
    code: str,
) -> str:
    _cleanup_outlook_oauth_states()
    oauth_state = _outlook_oauth_states.pop(state, None)
    if oauth_state is None:
        raise ValueError("授权状态已失效，请重新发起 Outlook 授权")

    account = (
        db.query(EmailAccountModel)
        .filter(
            EmailAccountModel.id == oauth_state["account_id"],
            EmailAccountModel.user_id == oauth_state["user_id"],
        )
        .first()
    )
    if not account:
        raise ValueError("对应邮箱账号不存在，无法完成 Outlook 重新授权")

    credential_data = decrypt_credential_data(
        account.credential_data, oauth_state["user_id"]
    )
    tenant = oauth_state["tenant"]
    token_url = OutlookEmailProvider.token_url_template.format(tenant=tenant)

    from curl_cffi import requests as curl_requests

    try:
        response = await asyncio.to_thread(
            curl_requests.post,
            token_url,
            data={
                "client_id": oauth_state["client_id"],
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": oauth_state["redirect_uri"],
                "code_verifier": oauth_state["code_verifier"],
                "scope": oauth_state["scope"],
            },
            timeout=30,
            impersonate="chrome",
        )
        result = response.json()
        if response.status_code >= 400 or "refresh_token" not in result:
            detail = result if isinstance(result, dict) else response.text
            raise ValueError(str(detail))

        access_token = str(result.get("access_token") or "").strip()
        refresh_token = str(result.get("refresh_token") or "").strip()
        expires_in = result.get("expires_in", 3600)
        try:
            expires_seconds = int(expires_in)
        except (TypeError, ValueError):
            expires_seconds = 3600
        expires_at = (
            datetime.utcnow() + timedelta(seconds=expires_seconds)
        ).isoformat()

        merged_data = dict(credential_data)
        merged_data["clientId"] = oauth_state["client_id"]
        merged_data["tenant"] = tenant
        merged_data["refreshToken"] = refresh_token
        merged_data["accessToken"] = access_token
        merged_data["tokenExpiresAt"] = expires_at
        merged_data["authType"] = (
            str(merged_data.get("authType") or "oauth2").strip() or "oauth2"
        )
        if result.get("scope"):
            merged_data["scopes"] = str(result.get("scope"))

        account.credential_data = encrypt_credential_data(
            merged_data, oauth_state["user_id"]
        )
        account.is_valid = True
        account.last_used = datetime.utcnow()
        account.updated_at = datetime.utcnow()
        db.commit()
        return "Outlook 重新授权成功，现在可以关闭此窗口"
    except Exception as error_obj:
        account.is_valid = False
        account.updated_at = datetime.utcnow()
        db.commit()
        detail = str(error_obj).strip() or "Outlook 重新授权失败"
        raise ValueError(detail) from error_obj


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


@router.post("/bulk-delete", response_model=EmailAccountBulkDeleteResponse)
async def bulk_delete_email_accounts(
    data: EmailAccountBulkDeleteRequest,
    user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    ids = [str(item).strip() for item in data.ids if str(item).strip()]
    if not ids:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email account ids are required",
        )

    accounts = (
        db.query(EmailAccountModel)
        .filter(
            EmailAccountModel.user_id == user.id,
            EmailAccountModel.id.in_(ids),
        )
        .all()
    )

    for account in accounts:
        db.delete(account)

    db.commit()
    return EmailAccountBulkDeleteResponse(deleted=len(accounts))


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
    if provider == "outlook":
        address = extract_address(credential_data)
        client_id = str(
            credential_data.get("clientId") or credential_data.get("client_id") or ""
        ).strip()
        refresh_token = str(
            credential_data.get("refreshToken")
            or credential_data.get("refresh_token")
            or ""
        ).strip()
        password = str(credential_data.get("password") or "").strip()

        if not address or not client_id or not refresh_token:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="当前 Outlook 账号缺少邮箱地址、Client ID 或 Refresh Token，无法测试收信",
            )

        provider_impl = OutlookEmailProvider()
        provider_account = SimpleNamespace(
            metadata={
                "clientId": client_id,
                "tenant": str(credential_data.get("tenant") or "common").strip()
                or "common",
                **(
                    {"scopes": credential_data.get("scopes")}
                    if credential_data.get("scopes")
                    else {}
                ),
                **(
                    {"tokenExpiresAt": credential_data.get("tokenExpiresAt")}
                    if credential_data.get("tokenExpiresAt")
                    else {}
                ),
                **(
                    {"expiresAt": credential_data.get("expiresAt")}
                    if credential_data.get("expiresAt")
                    else {}
                ),
            },
            secrets={
                "refreshToken": refresh_token,
                **(
                    {"accessToken": credential_data.get("accessToken")}
                    if credential_data.get("accessToken")
                    else {}
                ),
                **({"password": password} if password else {}),
            },
            auth_type=str(credential_data.get("authType") or "oauth2").strip()
            or "oauth2",
        )

        try:
            token_data = await asyncio.to_thread(
                provider_impl._ensure_access_token,
                provider_account,
                client_id,
                refresh_token,
            )
            access_token = str(token_data.get("access_token") or "").strip()
            next_refresh_token = str(
                token_data.get("refresh_token") or refresh_token
            ).strip()
            expires_at = str(token_data.get("expires_at") or "").strip()
            mailbox_name = "inbox"
            messages = await asyncio.to_thread(
                provider_impl._fetch_messages,
                access_token,
                mailbox_name,
            )

            merged_data = dict(credential_data)
            merged_data["refreshToken"] = next_refresh_token
            merged_data["accessToken"] = access_token
            merged_data["clientId"] = client_id
            merged_data["tenant"] = provider_account.metadata.get("tenant") or "common"
            if expires_at:
                merged_data["tokenExpiresAt"] = expires_at
            account.credential_data = encrypt_credential_data(merged_data, user.id)
            account.is_valid = True
            account.last_used = datetime.utcnow()
            account.updated_at = datetime.utcnow()
            db.commit()

            return EmailReceiveTestResponse(
                success=True,
                provider=provider,
                host="graph.microsoft.com",
                port=443,
                secure=True,
                mailbox=mailbox_name,
                mailbox_count=1,
                message_count=len(messages),
                message="Outlook 收信测试成功",
            )
        except Exception as error:
            account.is_valid = False
            account.updated_at = datetime.utcnow()
            db.commit()
            detail = str(error).strip() or "收信测试失败"
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Outlook 收信测试失败: {detail}",
            ) from error

    if provider != "imap":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="当前仅支持测试 IMAP / Outlook 收信能力",
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


@router.post(
    "/{account_id}/reauthorize", response_model=EmailAccountReauthorizeResponse
)
async def reauthorize_email_account(
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
    if provider != "outlook":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="当前仅支持 Outlook 邮箱重新授权",
        )

    address = extract_address(credential_data)
    client_id = str(
        credential_data.get("clientId") or credential_data.get("client_id") or ""
    ).strip()
    refresh_token = str(
        credential_data.get("refreshToken")
        or credential_data.get("refresh_token")
        or ""
    ).strip()
    password = str(credential_data.get("password") or "").strip()

    if not address or not client_id or not refresh_token:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="当前 Outlook 账号缺少邮箱地址、Client ID 或 Refresh Token，无法重新授权",
        )

    provider_impl = OutlookEmailProvider()
    provider_account = SimpleNamespace(
        metadata={
            "clientId": client_id,
            "tenant": str(credential_data.get("tenant") or "common").strip()
            or "common",
            **(
                {"scopes": credential_data.get("scopes")}
                if credential_data.get("scopes")
                else {}
            ),
            **(
                {"tokenExpiresAt": credential_data.get("tokenExpiresAt")}
                if credential_data.get("tokenExpiresAt")
                else {}
            ),
            **(
                {"expiresAt": credential_data.get("expiresAt")}
                if credential_data.get("expiresAt")
                else {}
            ),
        },
        secrets={
            "refreshToken": refresh_token,
            **(
                {"accessToken": credential_data.get("accessToken")}
                if credential_data.get("accessToken")
                else {}
            ),
            **({"password": password} if password else {}),
        },
        auth_type=str(credential_data.get("authType") or "oauth2").strip() or "oauth2",
    )

    try:
        token_data = await asyncio.to_thread(
            provider_impl._ensure_access_token,
            provider_account,
            client_id,
            refresh_token,
        )
        access_token = str(token_data.get("access_token") or "").strip()
        next_refresh_token = str(
            token_data.get("refresh_token") or refresh_token
        ).strip()
        expires_at = str(token_data.get("expires_at") or "").strip()

        merged_data = dict(credential_data)
        merged_data["refreshToken"] = next_refresh_token
        merged_data["accessToken"] = access_token
        merged_data["clientId"] = client_id
        merged_data["tenant"] = provider_account.metadata.get("tenant") or "common"
        if expires_at:
            merged_data["tokenExpiresAt"] = expires_at

        account.credential_data = encrypt_credential_data(merged_data, user.id)
        account.is_valid = True
        account.last_used = datetime.utcnow()
        account.updated_at = datetime.utcnow()
        db.commit()

        return EmailAccountReauthorizeResponse(
            success=True,
            provider=provider,
            message="Outlook 重新授权成功",
            expires_at=expires_at or None,
        )
    except Exception as error:
        account.is_valid = False
        account.updated_at = datetime.utcnow()
        db.commit()
        detail = str(error).strip() or "重新授权失败"
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Outlook 重新授权失败: {detail}",
        ) from error


@router.post(
    "/{account_id}/reauthorize/start",
    response_model=OutlookReauthorizeStartResponse,
)
async def start_outlook_reauthorize(
    account_id: str,
    request: Request,
    payload: Optional[OutlookReauthorizeStartRequest] = None,
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
    if provider != "outlook":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="当前仅支持 Outlook 邮箱重新授权",
        )

    client_id = str(
        credential_data.get("clientId") or credential_data.get("client_id") or ""
    ).strip()
    if not client_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="当前 Outlook 账号缺少 Client ID，无法重新授权",
        )

    _cleanup_outlook_oauth_states()
    state = secrets.token_urlsafe(32)
    code_verifier = secrets.token_urlsafe(64)
    code_challenge = _build_outlook_code_challenge(code_verifier)
    try:
        redirect_uri = _resolve_outlook_redirect_uri(
            request,
            credential_data,
            payload.redirect_uri if payload else None,
        )
    except ValueError as error:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(error),
        ) from error
    tenant = str(credential_data.get("tenant") or "common").strip() or "common"
    provider_impl = OutlookEmailProvider()
    scope = str(credential_data.get("scopes") or "").strip() or " ".join(
        provider_impl.default_scopes
    )

    _outlook_oauth_states[state] = {
        "account_id": account.id,
        "user_id": user.id,
        "client_id": client_id,
        "tenant": tenant,
        "code_verifier": code_verifier,
        "redirect_uri": redirect_uri,
        "scope": scope,
        "expires_at": datetime.utcnow() + OUTLOOK_OAUTH_STATE_TTL,
    }

    authorization_url = (
        f"https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize?"
        + urlencode(
            {
                "client_id": client_id,
                "response_type": "code",
                "redirect_uri": redirect_uri,
                "response_mode": "query",
                "scope": scope,
                "state": state,
                "prompt": "select_account",
                "code_challenge": code_challenge,
                "code_challenge_method": "S256",
            }
        )
    )

    return OutlookReauthorizeStartResponse(
        authorization_url=authorization_url,
        state=state,
    )


@router.post("/oauth/outlook/complete")
async def complete_outlook_reauthorize(
    payload: OutlookReauthorizeCompleteRequest,
    user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    del user
    try:
        message = await _complete_outlook_oauth_reauthorize(
            db,
            payload.state.strip(),
            payload.code.strip(),
        )
        return {"success": True, "message": message}
    except ValueError as error:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(error),
        ) from error


@router.get(
    "/oauth/outlook/callback",
    response_class=HTMLResponse,
    name="outlook_reauthorize_callback",
)
async def outlook_reauthorize_callback(
    request: Request,
    code: Optional[str] = None,
    state: Optional[str] = None,
    error: Optional[str] = None,
    error_description: Optional[str] = None,
    db: Session = Depends(get_db),
):
    del request

    def build_html(success: bool, message: str) -> HTMLResponse:
        payload = json.dumps(
            {
                "type": "outlook-email-reauthorize",
                "success": success,
                "message": message,
            },
            ensure_ascii=False,
        )
        html = f"""
<!doctype html>
<html>
<head>
  <meta charset=\"utf-8\" />
  <title>Outlook 重新授权</title>
</head>
<body style=\"font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; padding: 24px;\">
  <h3>{'授权成功' if success else '授权失败'}</h3>
  <p>{message}</p>
  <script>
    (function() {{
      const payload = {payload};
      if (window.opener) {{
        window.opener.postMessage(payload, window.location.origin);
        window.close();
      }}
    }})();
  </script>
</body>
</html>
        """
        return HTMLResponse(content=html)

    if not state:
        return build_html(False, "缺少 state，无法完成 Outlook 重新授权")

    if error:
        detail = (error_description or error).strip()
        return build_html(False, f"Outlook 授权被取消或失败: {detail}")

    if not code:
        return build_html(False, "缺少授权 code，无法完成 Outlook 重新授权")

    try:
        message = await _complete_outlook_oauth_reauthorize(db, state, code)
        return build_html(True, message)
    except ValueError as error_obj:
        return build_html(False, str(error_obj))
