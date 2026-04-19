"""Identity 路由

处理浏览器身份（登录状态）的 CRUD 操作。
"""

import os
import shutil
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from models.database import get_db
from models.db_models import CredentialModel, IdentityModel, UserModel
from routers.auth import get_current_user

router = APIRouter(prefix="/api/identities", tags=["identities"])

IDENTITY_STORAGE_ROOT = "data/identities"


class IdentityCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=128)
    type: str = Field(..., pattern="^(none|file|profile)$")
    credential_id: Optional[str] = None


class IdentityUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=128)
    type: Optional[str] = Field(None, pattern="^(none|file|profile)$")


class IdentityResponse(BaseModel):
    id: str
    name: str
    type: str
    storage_path: Optional[str]
    credential_id: Optional[str]
    status: str
    last_used: Optional[datetime]
    expires_at: Optional[datetime]
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class IdentityListResponse(BaseModel):
    id: str
    name: str
    type: str
    storage_path: Optional[str]
    credential_id: Optional[str]
    status: str
    last_used: Optional[datetime]
    expires_at: Optional[datetime]
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


def get_identity_dir(user_id: str, identity_id: str) -> str:
    return os.path.join(IDENTITY_STORAGE_ROOT, user_id, identity_id)


def ensure_identity_dir(user_id: str, identity_id: str) -> str:
    path = get_identity_dir(user_id, identity_id)
    os.makedirs(path, exist_ok=True)
    return path


def ensure_identity_storage(identity: IdentityModel) -> None:
    if identity.type in {"file", "profile"}:
        identity.storage_path = ensure_identity_dir(identity.user_id, identity.id)
    else:
        identity.storage_path = None


def get_identity_or_404(db: Session, user_id: str, identity_id: str) -> IdentityModel:
    identity = (
        db.query(IdentityModel)
        .filter(IdentityModel.id == identity_id, IdentityModel.user_id == user_id)
        .first()
    )
    if not identity:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Identity not found",
        )
    return identity


@router.post("", response_model=IdentityResponse)
async def create_identity(
    data: IdentityCreate,
    user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if data.credential_id:
        cred = (
            db.query(CredentialModel)
            .filter(
                CredentialModel.id == data.credential_id,
                CredentialModel.user_id == user.id,
            )
            .first()
        )
        if not cred:
            raise HTTPException(status_code=404, detail="Credential not found")

    identity = IdentityModel(
        user_id=user.id,
        name=data.name,
        type=data.type,
        credential_id=data.credential_id,
        status="active",
    )
    db.add(identity)
    db.commit()
    db.refresh(identity)

    ensure_identity_storage(identity)
    identity.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(identity)
    return identity


@router.get("", response_model=List[IdentityListResponse])
async def list_identities(
    user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return db.query(IdentityModel).filter(IdentityModel.user_id == user.id).all()


@router.get("/{identity_id}", response_model=IdentityResponse)
async def get_identity(
    identity_id: str,
    user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return get_identity_or_404(db, user.id, identity_id)


@router.put("/{identity_id}", response_model=IdentityResponse)
async def update_identity(
    identity_id: str,
    data: IdentityUpdate,
    user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    identity = get_identity_or_404(db, user.id, identity_id)

    if data.name is not None:
        identity.name = data.name
    if data.type is not None and data.type != identity.type:
        identity.type = data.type
        ensure_identity_storage(identity)

    identity.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(identity)
    return identity


@router.delete("/{identity_id}")
async def delete_identity(
    identity_id: str,
    user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    identity = get_identity_or_404(db, user.id, identity_id)

    path = get_identity_dir(user.id, identity.id)
    if os.path.exists(path):
        shutil.rmtree(path)

    db.delete(identity)
    db.commit()
    return {"message": "Identity deleted successfully"}


@router.post("/upload", response_model=IdentityResponse)
async def upload_storage_state(
    file: UploadFile = File(...),
    name: str = "Uploaded Identity",
    user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not file.filename or not file.filename.endswith(".json"):
        raise HTTPException(status_code=400, detail="Only JSON files are supported")

    identity = IdentityModel(
        user_id=user.id,
        name=name,
        type="file",
        status="active",
    )
    db.add(identity)
    db.commit()
    db.refresh(identity)

    dir_path = ensure_identity_dir(user.id, identity.id)
    file_path = os.path.join(dir_path, "state.json")
    with open(file_path, "wb") as f:
        f.write(await file.read())

    identity.storage_path = dir_path
    identity.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(identity)
    return identity


@router.post("/{identity_id}/refresh")
async def refresh_identity(
    identity_id: str,
    user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    identity = get_identity_or_404(db, user.id, identity_id)
    identity.status = "expired"
    identity.updated_at = datetime.utcnow()
    db.commit()
    return {
        "message": "Identity marked for refresh",
        "identity_id": identity.id,
        "status": identity.status,
    }
