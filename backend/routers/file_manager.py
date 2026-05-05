from __future__ import annotations

from pathlib import Path
from typing import Literal

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from pydantic import BaseModel, Field

from models.db_models import UserModel
from routers.auth import get_current_user

router = APIRouter(prefix="/api/files", tags=["files"])

BACKEND_DIR = Path(__file__).resolve().parents[1]
DATA_DIR = BACKEND_DIR / "data"


class FileEntryResponse(BaseModel):
    name: str
    path: str
    kind: Literal["file", "directory"]
    size: int | None = None
    updated_at: float


class FileListResponse(BaseModel):
    current_path: str
    entries: list[FileEntryResponse]


class FileContentResponse(BaseModel):
    path: str
    content: str
    size: int


class SaveFileRequest(BaseModel):
    path: str = Field(..., min_length=1)
    content: str = ""


class CreateFolderRequest(BaseModel):
    path: str = ""
    name: str = Field(..., min_length=1, max_length=255)


class RenamePathRequest(BaseModel):
    path: str = Field(..., min_length=1)
    new_path: str = Field(..., min_length=1)


def _get_user_root(user_id: str | None) -> Path:
    if not user_id:
        raise HTTPException(status_code=400, detail="缺少用户信息")
    root = DATA_DIR / "files" / str(user_id)
    root.mkdir(parents=True, exist_ok=True)
    return root


def _resolve_user_path(user_root: Path, raw_path: str | None) -> Path:
    relative_path = (raw_path or "").strip()
    if not relative_path:
        return user_root

    candidate = Path(relative_path)
    if candidate.is_absolute():
        raise HTTPException(status_code=400, detail="不允许使用绝对路径")

    target_path = (user_root / candidate).resolve()
    resolved_root = user_root.resolve()
    if target_path != resolved_root and resolved_root not in target_path.parents:
        raise HTTPException(
            status_code=400, detail="文件路径越权，仅允许访问当前用户目录"
        )
    return target_path


def _to_relative_path(user_root: Path, target_path: Path) -> str:
    if target_path == user_root:
        return ""
    return target_path.relative_to(user_root).as_posix()


@router.get("", response_model=FileListResponse)
async def list_files(
    path: str = Query(default=""),
    user: UserModel = Depends(get_current_user),
):
    user_root = _get_user_root(user.id)
    target_path = _resolve_user_path(user_root, path)

    if not target_path.exists():
        raise HTTPException(status_code=404, detail="目录不存在")
    if not target_path.is_dir():
        raise HTTPException(status_code=400, detail="目标不是目录")

    entries: list[FileEntryResponse] = []
    for entry in sorted(
        target_path.iterdir(), key=lambda item: (not item.is_dir(), item.name.lower())
    ):
        stat = entry.stat()
        entries.append(
            FileEntryResponse(
                name=entry.name,
                path=_to_relative_path(user_root, entry),
                kind="directory" if entry.is_dir() else "file",
                size=None if entry.is_dir() else stat.st_size,
                updated_at=stat.st_mtime,
            )
        )

    return FileListResponse(
        current_path=_to_relative_path(user_root, target_path), entries=entries
    )


@router.get("/content", response_model=FileContentResponse)
async def get_file_content(
    path: str = Query(..., min_length=1),
    user: UserModel = Depends(get_current_user),
):
    user_root = _get_user_root(user.id)
    target_path = _resolve_user_path(user_root, path)
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

    return FileContentResponse(
        path=_to_relative_path(user_root, target_path),
        content=content,
        size=target_path.stat().st_size,
    )


@router.put("/content", response_model=FileContentResponse)
async def save_file_content(
    payload: SaveFileRequest,
    user: UserModel = Depends(get_current_user),
):
    user_root = _get_user_root(user.id)
    target_path = _resolve_user_path(user_root, payload.path)
    if target_path.exists() and target_path.is_dir():
        raise HTTPException(status_code=400, detail="目标是目录，不能保存为文件")

    target_path.parent.mkdir(parents=True, exist_ok=True)
    target_path.write_text(payload.content, encoding="utf-8")
    return FileContentResponse(
        path=_to_relative_path(user_root, target_path),
        content=payload.content,
        size=target_path.stat().st_size,
    )


@router.post("/folders")
async def create_folder(
    payload: CreateFolderRequest,
    user: UserModel = Depends(get_current_user),
):
    user_root = _get_user_root(user.id)
    base_path = _resolve_user_path(user_root, payload.path)
    if not base_path.exists():
        raise HTTPException(status_code=404, detail="父目录不存在")
    if not base_path.is_dir():
        raise HTTPException(status_code=400, detail="父路径不是目录")

    if "/" in payload.name or "\\" in payload.name or payload.name in {".", ".."}:
        raise HTTPException(status_code=400, detail="目录名称不合法")

    target_path = _resolve_user_path(
        user_root,
        f"{_to_relative_path(user_root, base_path)}/{payload.name}".strip("/"),
    )
    target_path.mkdir(parents=False, exist_ok=False)
    return {
        "message": "目录创建成功",
        "path": _to_relative_path(user_root, target_path),
    }


@router.patch("/rename")
async def rename_path(
    payload: RenamePathRequest,
    user: UserModel = Depends(get_current_user),
):
    user_root = _get_user_root(user.id)
    source_path = _resolve_user_path(user_root, payload.path)
    target_path = _resolve_user_path(user_root, payload.new_path)

    if not source_path.exists():
        raise HTTPException(status_code=404, detail="源路径不存在")
    if target_path.exists():
        raise HTTPException(status_code=400, detail="目标路径已存在")

    target_path.parent.mkdir(parents=True, exist_ok=True)
    source_path.rename(target_path)
    return {"message": "重命名成功", "path": _to_relative_path(user_root, target_path)}


@router.delete("")
async def delete_path(
    path: str = Query(..., min_length=1),
    user: UserModel = Depends(get_current_user),
):
    user_root = _get_user_root(user.id)
    target_path = _resolve_user_path(user_root, path)
    if not target_path.exists():
        raise HTTPException(status_code=404, detail="目标不存在")
    if target_path == user_root:
        raise HTTPException(status_code=400, detail="不能删除用户根目录")

    if target_path.is_dir():
        for child in target_path.rglob("*"):
            if child.is_file():
                child.unlink()
        for child in sorted(target_path.rglob("*"), reverse=True):
            if child.is_dir():
                child.rmdir()
        target_path.rmdir()
    else:
        target_path.unlink()
    return {"message": "删除成功"}


@router.post("/upload")
async def upload_file(
    file: UploadFile = File(...),
    path: str = "",
    user: UserModel = Depends(get_current_user),
):
    if not file.filename:
        raise HTTPException(status_code=400, detail="缺少文件名")

    user_root = _get_user_root(user.id)
    base_path = _resolve_user_path(user_root, path)
    if not base_path.exists():
        raise HTTPException(status_code=404, detail="目标目录不存在")
    if not base_path.is_dir():
        raise HTTPException(status_code=400, detail="目标路径不是目录")

    safe_name = Path(file.filename).name
    target_path = _resolve_user_path(
        user_root, f"{_to_relative_path(user_root, base_path)}/{safe_name}".strip("/")
    )
    content = await file.read()
    target_path.write_bytes(content)
    return {
        "message": "上传成功",
        "path": _to_relative_path(user_root, target_path),
        "size": len(content),
    }
