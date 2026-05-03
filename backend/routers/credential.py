"""Credential 路由

处理账号凭证的 CRUD 操作。
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import Optional, List
from datetime import datetime
from pydantic import BaseModel, Field
import json
import os
import imaplib
import socket

from models.database import get_db
from models.db_models import UserModel, CredentialModel
from routers.auth import get_current_user
from utils.auth_utils import encrypt_data, decrypt_data
from core.email_service.presets import EmailProviderPresetStore

router = APIRouter(prefix="/api/credentials", tags=["credentials"])

# 凭证数据存储目录
CREDENTIAL_STORAGE_DIR = "data/credentials"


# ============== Pydantic 模型 ==============


class CredentialCreate(BaseModel):
    """创建 Credential"""

    name: str = Field(..., min_length=1, max_length=128)
    site: str = Field(..., min_length=1, max_length=256)
    credential_data: dict  # 凭证数据（用户名、密码等）
    description: Optional[str] = None
    is_visible: bool = True


class CredentialUpdate(BaseModel):
    """更新 Credential"""

    name: Optional[str] = Field(None, min_length=1, max_length=128)
    site: Optional[str] = Field(None, min_length=1, max_length=256)
    credential_data: Optional[dict] = None
    description: Optional[str] = None
    is_visible: Optional[bool] = None
    is_valid: Optional[bool] = None


class CredentialResponse(BaseModel):
    """Credential 响应"""

    id: str
    name: str
    site: str
    description: Optional[str]
    is_visible: bool
    is_valid: bool
    last_used: Optional[datetime]
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class CredentialListResponse(BaseModel):
    """Credential 列表响应"""

    id: str
    name: str
    site: str
    description: Optional[str]
    credential_data: dict
    is_visible: bool
    is_valid: bool
    last_used: Optional[datetime]
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class CredentialDetailResponse(BaseModel):
    """Credential 详情响应（包含凭证数据）"""

    id: str
    name: str
    site: str
    description: Optional[str]
    credential_data: dict
    is_visible: bool
    is_valid: bool
    last_used: Optional[datetime]
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class EmailReceiveTestResponse(BaseModel):
    """邮箱收信测试响应"""

    success: bool
    provider: str
    host: str
    port: int
    secure: bool
    mailbox: str
    mailbox_count: int
    message_count: int
    message: str


# ============== 辅助函数 ==============


def ensure_storage_dir():
    """确保存储目录存在"""
    os.makedirs(CREDENTIAL_STORAGE_DIR, exist_ok=True)


def encrypt_credential_data(data: dict, user_id: str) -> str:
    """加密凭证数据"""
    # 使用用户 ID 作为加密密钥的一部分
    json_data = json.dumps(data)
    return encrypt_data(json_data, user_id)


def decrypt_credential_data(encrypted_data: str, user_id: str) -> dict:
    """解密凭证数据"""
    try:
        json_data = decrypt_data(encrypted_data, user_id)
        return json.loads(json_data)
    except Exception:
        return {}


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


def sanitize_credential_data(data: dict | None) -> dict:
    if not isinstance(data, dict):
        return {}

    return {
        key: value
        for key, value in data.items()
        if key not in SENSITIVE_CREDENTIAL_KEYS
    }


def build_safe_credential_response_data(data: dict, is_visible: bool) -> dict:
    """构建可返回给前端的凭证数据。

    不可见凭证不返回敏感内容，但保留非敏感的类型信息，
    以便前端列表和详情页能正确展示 credential 类型。
    """
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


def resolve_imap_connection_settings(credential_data: dict) -> tuple[str, int, bool]:
    """解析 IMAP 连接配置。"""
    provider = str(
        credential_data.get("provider") or credential_data.get("type") or "imap"
    ).strip()
    address = (
        str(
            credential_data.get("address")
            or credential_data.get("email")
            or credential_data.get("identifier")
            or ""
        )
        .strip()
        .lower()
    )

    host = str(
        credential_data.get("imapHost") or credential_data.get("host") or ""
    ).strip()
    port_value = credential_data.get("imapPort") or credential_data.get("port")
    secure_value = credential_data.get("imapSecure")

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

    if not host:
        host = str(preset_imap.get("host") or "").strip()

    if port_value in (None, ""):
        port_value = preset_imap.get("port") or 993

    try:
        port = int(port_value)
    except (TypeError, ValueError):
        port = 993

    if secure_value is None:
        secure = bool(preset_imap.get("secure", True))
    else:
        secure = bool(secure_value)

    if not host:
        raise ValueError(
            "未找到 IMAP 主机配置，请先为该邮箱补充 provider preset 或手动配置 host"
        )

    return host, port, secure


def parse_imap_mailbox_name(raw_line: bytes | str) -> str | None:
    """从 IMAP LIST 响应中提取邮箱文件夹名称。"""
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
    """选择用于测试收信的邮箱文件夹。"""
    if not mailboxes:
        return None

    normalized_map = {
        mailbox.lower().strip(): mailbox for mailbox in mailboxes if mailbox.strip()
    }
    for preferred in ("inbox", "收件箱"):
        if preferred in normalized_map:
            return normalized_map[preferred]

    return next((mailbox for mailbox in mailboxes if mailbox.strip()), None)


# ============== API 端点 ==============


@router.post("", response_model=CredentialResponse)
async def create_credential(
    data: CredentialCreate,
    user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """创建 Credential"""
    ensure_storage_dir()

    # 加密凭证数据
    encrypted_data = encrypt_credential_data(data.credential_data, user.id)

    credential = CredentialModel(
        user_id=user.id,
        name=data.name,
        site=data.site,
        credential_data=encrypted_data,
        description=data.description,
        is_visible=data.is_visible,
    )
    db.add(credential)
    db.commit()
    db.refresh(credential)

    return CredentialResponse(
        id=credential.id,
        name=credential.name,
        site=credential.site,
        description=credential.description,
        is_visible=credential.is_visible,
        is_valid=credential.is_valid,
        last_used=credential.last_used,
        created_at=credential.created_at,
        updated_at=credential.updated_at,
    )


@router.get("", response_model=List[CredentialListResponse])
async def list_credentials(
    site: Optional[str] = None,
    is_valid: Optional[bool] = None,
    user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """获取 Credential 列表"""
    query = db.query(CredentialModel).filter(CredentialModel.user_id == user.id)

    if site:
        query = query.filter(CredentialModel.site == site)
    if is_valid is not None:
        query = query.filter(CredentialModel.is_valid == is_valid)

    credentials = query.order_by(CredentialModel.updated_at.desc()).all()

    return [
        CredentialListResponse(
            id=c.id,
            name=c.name,
            site=c.site,
            description=c.description,
            credential_data=build_safe_credential_response_data(
                decrypt_credential_data(c.credential_data, user.id),
                c.is_visible,
            ),
            is_visible=c.is_visible,
            is_valid=c.is_valid,
            last_used=c.last_used,
            created_at=c.created_at,
            updated_at=c.updated_at,
        )
        for c in credentials
    ]


@router.get("/{credential_id}", response_model=CredentialDetailResponse)
async def get_credential(
    credential_id: str,
    user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """获取单个 Credential（包含凭证数据）"""
    credential = (
        db.query(CredentialModel)
        .filter(
            CredentialModel.id == credential_id,
            CredentialModel.user_id == user.id,
        )
        .first()
    )

    if not credential:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Credential not found"
        )

    # 解密凭证数据
    decrypted_data = decrypt_credential_data(credential.credential_data, user.id)
    response_data = build_safe_credential_response_data(
        decrypted_data,
        credential.is_visible,
    )

    return CredentialDetailResponse(
        id=credential.id,
        name=credential.name,
        site=credential.site,
        description=credential.description,
        credential_data=response_data,
        is_visible=credential.is_visible,
        is_valid=credential.is_valid,
        last_used=credential.last_used,
        created_at=credential.created_at,
        updated_at=credential.updated_at,
    )


@router.put("/{credential_id}", response_model=CredentialResponse)
async def update_credential(
    credential_id: str,
    data: CredentialUpdate,
    user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """更新 Credential"""
    credential = (
        db.query(CredentialModel)
        .filter(
            CredentialModel.id == credential_id,
            CredentialModel.user_id == user.id,
        )
        .first()
    )

    if not credential:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Credential not found"
        )

    if data.name is not None:
        credential.name = data.name
    if data.site is not None:
        credential.site = data.site
    if data.credential_data is not None:
        existing_data = decrypt_credential_data(credential.credential_data, user.id)
        merged_data = merge_credential_data(existing_data, data.credential_data)
        credential.credential_data = encrypt_credential_data(merged_data, user.id)
    if data.description is not None:
        credential.description = data.description
    if data.is_valid is not None:
        credential.is_valid = data.is_valid

    credential.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(credential)

    return CredentialResponse(
        id=credential.id,
        name=credential.name,
        site=credential.site,
        description=credential.description,
        is_visible=credential.is_visible,
        is_valid=credential.is_valid,
        last_used=credential.last_used,
        created_at=credential.created_at,
        updated_at=credential.updated_at,
    )


@router.delete("/{credential_id}")
async def delete_credential(
    credential_id: str,
    user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """删除 Credential"""
    credential = (
        db.query(CredentialModel)
        .filter(
            CredentialModel.id == credential_id,
            CredentialModel.user_id == user.id,
        )
        .first()
    )

    if not credential:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Credential not found"
        )

    db.delete(credential)
    db.commit()

    return {"message": "Credential deleted successfully"}


@router.post(
    "/{credential_id}/test-email-receive", response_model=EmailReceiveTestResponse
)
async def test_email_receive(
    credential_id: str,
    user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """测试邮箱账号是否具备基础收信能力。"""
    credential = (
        db.query(CredentialModel)
        .filter(
            CredentialModel.id == credential_id,
            CredentialModel.user_id == user.id,
        )
        .first()
    )

    if not credential:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Credential not found"
        )

    credential_data = decrypt_credential_data(credential.credential_data, user.id)
    provider = (
        str(
            credential_data.get("provider")
            or credential_data.get("type")
            or credential.site
            or ""
        )
        .strip()
        .lower()
    )

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
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(error),
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

        credential.is_valid = True
        credential.updated_at = datetime.utcnow()
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
        credential.is_valid = False
        credential.updated_at = datetime.utcnow()
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
