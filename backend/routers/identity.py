"""Identity 路由

处理浏览器身份（登录状态）的 CRUD 操作。
"""

import os
import shutil
from pathlib import Path
from datetime import datetime
from typing import List, Literal, Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
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


class IdentityStateResponse(BaseModel):
    identity_id: str
    path: str
    content: str
    size: int


class IdentityStateSaveRequest(BaseModel):
    content: str = ""


class IdentityFileEntryResponse(BaseModel):
    name: str
    path: str
    kind: Literal["file", "directory"]
    size: int | None = None
    updated_at: float


class IdentityFileListResponse(BaseModel):
    current_path: str
    entries: list[IdentityFileEntryResponse]


class IdentityFileContentResponse(BaseModel):
    path: str
    content: str
    size: int


class IdentitySaveFileRequest(BaseModel):
    path: str = Field(..., min_length=1)
    content: str = ""


class IdentityCreateFolderRequest(BaseModel):
    path: str = ""
    name: str = Field(..., min_length=1, max_length=255)


class IdentityRenamePathRequest(BaseModel):
    path: str = Field(..., min_length=1)
    new_path: str = Field(..., min_length=1)


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


def _require_profile_identity(identity: IdentityModel) -> None:
    if identity.type != "profile":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only profile identities support file management",
        )


def _get_identity_root(identity: IdentityModel) -> Path:
    _require_profile_identity(identity)
    return Path(ensure_identity_dir(identity.user_id, identity.id)).resolve()


def _resolve_identity_path(identity_root: Path, raw_path: str | None) -> Path:
    relative_path = (raw_path or "").strip()
    if not relative_path:
        return identity_root

    candidate = Path(relative_path)
    if candidate.is_absolute():
        raise HTTPException(status_code=400, detail="不允许使用绝对路径")

    target_path = (identity_root / candidate).resolve()
    if target_path != identity_root and identity_root not in target_path.parents:
        raise HTTPException(status_code=400, detail="文件路径越权")
    return target_path


def _to_identity_relative_path(identity_root: Path, target_path: Path) -> str:
    if target_path == identity_root:
        return ""
    return target_path.relative_to(identity_root).as_posix()


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


@router.get("/{identity_id}/state", response_model=IdentityStateResponse)
async def get_identity_state(
    identity_id: str,
    user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    identity = get_identity_or_404(db, user.id, identity_id)

    dir_path = get_identity_dir(user.id, identity.id)
    file_path = os.path.join(dir_path, "state.json")
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Identity state file not found")

    try:
        with open(file_path, "r", encoding="utf-8") as f:
            content = f.read()
    except UnicodeDecodeError as exc:
        raise HTTPException(
            status_code=400,
            detail="Identity state file is not a UTF-8 text file",
        ) from exc

    return IdentityStateResponse(
        identity_id=identity.id,
        path="state.json",
        content=content,
        size=os.path.getsize(file_path),
    )


@router.put("/{identity_id}/state", response_model=IdentityStateResponse)
async def save_identity_state(
    identity_id: str,
    payload: IdentityStateSaveRequest,
    user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    identity = get_identity_or_404(db, user.id, identity_id)
    if identity.type not in {"file", "profile"}:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only file/profile identities support state files",
        )

    dir_path = ensure_identity_dir(user.id, identity.id)
    file_path = os.path.join(dir_path, "state.json")
    with open(file_path, "w", encoding="utf-8") as f:
        f.write(payload.content)

    identity.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(identity)

    return IdentityStateResponse(
        identity_id=identity.id,
        path="state.json",
        content=payload.content,
        size=os.path.getsize(file_path),
    )


@router.get("/{identity_id}/files", response_model=IdentityFileListResponse)
async def list_identity_files(
    identity_id: str,
    path: str = Query(default=""),
    user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    identity = get_identity_or_404(db, user.id, identity_id)
    identity_root = _get_identity_root(identity)
    target_path = _resolve_identity_path(identity_root, path)

    if not target_path.exists():
        raise HTTPException(status_code=404, detail="目录不存在")
    if not target_path.is_dir():
        raise HTTPException(status_code=400, detail="目标不是目录")

    entries: list[IdentityFileEntryResponse] = []
    for entry in sorted(
        target_path.iterdir(), key=lambda item: (not item.is_dir(), item.name.lower())
    ):
        stat = entry.stat()
        entries.append(
            IdentityFileEntryResponse(
                name=entry.name,
                path=_to_identity_relative_path(identity_root, entry),
                kind="directory" if entry.is_dir() else "file",
                size=None if entry.is_dir() else stat.st_size,
                updated_at=stat.st_mtime,
            )
        )

    return IdentityFileListResponse(
        current_path=_to_identity_relative_path(identity_root, target_path),
        entries=entries,
    )


@router.get("/{identity_id}/files/content", response_model=IdentityFileContentResponse)
async def get_identity_file_content(
    identity_id: str,
    path: str = Query(..., min_length=1),
    user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    identity = get_identity_or_404(db, user.id, identity_id)
    identity_root = _get_identity_root(identity)
    target_path = _resolve_identity_path(identity_root, path)
    if not target_path.exists():
        raise HTTPException(status_code=404, detail="文件不存在")
    if not target_path.is_file():
        raise HTTPException(status_code=400, detail="目标不是文件")

    try:
        content = target_path.read_text(encoding="utf-8")
    except UnicodeDecodeError as exc:
        raise HTTPException(
            status_code=400, detail="当前仅支持编辑 UTF-8 文本文件"
        ) from exc

    return IdentityFileContentResponse(
        path=_to_identity_relative_path(identity_root, target_path),
        content=content,
        size=target_path.stat().st_size,
    )


@router.put("/{identity_id}/files/content", response_model=IdentityFileContentResponse)
async def save_identity_file_content(
    identity_id: str,
    payload: IdentitySaveFileRequest,
    user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    identity = get_identity_or_404(db, user.id, identity_id)
    identity_root = _get_identity_root(identity)
    target_path = _resolve_identity_path(identity_root, payload.path)
    if target_path.exists() and target_path.is_dir():
        raise HTTPException(status_code=400, detail="目标是目录，不能保存为文件")

    target_path.parent.mkdir(parents=True, exist_ok=True)
    target_path.write_text(payload.content, encoding="utf-8")
    return IdentityFileContentResponse(
        path=_to_identity_relative_path(identity_root, target_path),
        content=payload.content,
        size=target_path.stat().st_size,
    )


@router.post("/{identity_id}/files/folders")
async def create_identity_folder(
    identity_id: str,
    payload: IdentityCreateFolderRequest,
    user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    identity = get_identity_or_404(db, user.id, identity_id)
    identity_root = _get_identity_root(identity)
    base_path = _resolve_identity_path(identity_root, payload.path)
    if not base_path.exists():
        raise HTTPException(status_code=404, detail="父目录不存在")
    if not base_path.is_dir():
        raise HTTPException(status_code=400, detail="父路径不是目录")

    if "/" in payload.name or "\\" in payload.name or payload.name in {".", ".."}:
        raise HTTPException(status_code=400, detail="目录名称不合法")

    target_path = _resolve_identity_path(
        identity_root,
        f"{_to_identity_relative_path(identity_root, base_path)}/{payload.name}".strip(
            "/"
        ),
    )
    target_path.mkdir(parents=False, exist_ok=False)
    return {
        "message": "目录创建成功",
        "path": _to_identity_relative_path(identity_root, target_path),
    }


@router.patch("/{identity_id}/files/rename")
async def rename_identity_path(
    identity_id: str,
    payload: IdentityRenamePathRequest,
    user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    identity = get_identity_or_404(db, user.id, identity_id)
    identity_root = _get_identity_root(identity)
    source_path = _resolve_identity_path(identity_root, payload.path)
    target_path = _resolve_identity_path(identity_root, payload.new_path)

    if not source_path.exists():
        raise HTTPException(status_code=404, detail="源路径不存在")
    if target_path.exists():
        raise HTTPException(status_code=400, detail="目标路径已存在")

    target_path.parent.mkdir(parents=True, exist_ok=True)
    source_path.rename(target_path)
    return {
        "message": "重命名成功",
        "path": _to_identity_relative_path(identity_root, target_path),
    }


@router.delete("/{identity_id}/files")
async def delete_identity_path(
    identity_id: str,
    path: str = Query(..., min_length=1),
    user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    identity = get_identity_or_404(db, user.id, identity_id)
    identity_root = _get_identity_root(identity)
    target_path = _resolve_identity_path(identity_root, path)
    if not target_path.exists():
        raise HTTPException(status_code=404, detail="目标不存在")
    if target_path == identity_root:
        raise HTTPException(status_code=400, detail="不能删除 identity 根目录")

    if target_path.is_dir():
        shutil.rmtree(target_path)
    else:
        target_path.unlink()
    return {"message": "删除成功"}


@router.post("/{identity_id}/files/upload")
async def upload_identity_file(
    identity_id: str,
    file: UploadFile = File(...),
    path: str = "",
    user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not file.filename:
        raise HTTPException(status_code=400, detail="缺少文件名")

    identity = get_identity_or_404(db, user.id, identity_id)
    identity_root = _get_identity_root(identity)
    base_path = _resolve_identity_path(identity_root, path)
    if not base_path.exists():
        raise HTTPException(status_code=404, detail="目标目录不存在")
    if not base_path.is_dir():
        raise HTTPException(status_code=400, detail="目标路径不是目录")

    safe_name = Path(file.filename).name
    target_path = _resolve_identity_path(
        identity_root,
        f"{_to_identity_relative_path(identity_root, base_path)}/{safe_name}".strip(
            "/"
        ),
    )
    content = await file.read()
    target_path.write_bytes(content)
    return {
        "message": "上传成功",
        "path": _to_identity_relative_path(identity_root, target_path),
        "size": len(content),
    }


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
