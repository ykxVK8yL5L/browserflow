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

from models.database import get_db
from models.db_models import UserModel, CredentialModel
from routers.auth import get_current_user
from utils.auth_utils import encrypt_data, decrypt_data

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


def build_safe_credential_response_data(data: dict, is_visible: bool) -> dict:
    """构建可返回给前端的凭证数据。

    不可见凭证不返回敏感内容，但保留非敏感的类型信息，
    以便前端列表和详情页能正确展示 credential 类型。
    """
    if is_visible:
        return data

    credential_type = data.get("type") if isinstance(data, dict) else None
    return {"type": credential_type} if isinstance(credential_type, str) else {}


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
        credential.credential_data = encrypt_credential_data(
            data.credential_data, user.id
        )
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
