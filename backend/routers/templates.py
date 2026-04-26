"""模板配置、远程模板代理与用户本地模板接口。"""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
import re
from typing import Any, Dict, List, Optional
from urllib.parse import quote, urljoin, urlparse, urlsplit, urlunsplit
from urllib.request import Request, urlopen
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from models.database import get_db
from models.db_models import UserModel
from routers.auth import get_current_user, get_platform_setting, set_platform_setting

router = APIRouter(prefix="/api/templates", tags=["templates"])

DEFAULT_TEMPLATE_INDEX_URL = (
    "https://raw.githubusercontent.com/ykxVK8yL5L/browserflow/main/templates/index.json"
)
FETCH_TIMEOUT_SECONDS = 10
ALLOWED_SCHEMES = {"http", "https"}
LOCAL_TEMPLATE_BASE_DIR = Path(__file__).resolve().parents[1] / "data" / "templates"
LOCAL_TEMPLATE_CATEGORY = "local"


def ensure_admin(user: UserModel) -> UserModel:
    if user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin privileges required",
        )
    return user


class TemplateSettingsResponse(BaseModel):
    feature_enabled: bool
    index_url: str


class TemplateSettingsUpdate(BaseModel):
    feature_enabled: Optional[bool] = None
    index_url: Optional[str] = Field(default=None, max_length=2048)


class TemplateCategoryResponse(BaseModel):
    key: str
    label: str
    description: str = ""


class TemplateIndexItemResponse(BaseModel):
    id: str
    category: str
    name: str
    description: str = ""
    tags: List[str] = []
    author: str = "官方"
    sort_order: int = 0
    path: str
    url: str


class TemplateIndexResponse(BaseModel):
    version: int = 1
    categories: List[TemplateCategoryResponse]
    items: List[TemplateIndexItemResponse]


class TemplateFlowResponse(BaseModel):
    id: str
    name: str
    description: str = ""
    category: str = ""
    tags: List[str] = []
    author: str = "官方"
    nodes: List[Dict[str, Any]]
    edges: List[Dict[str, Any]]
    groups: List[Dict[str, Any]] = []


class LocalTemplateIndexItemResponse(BaseModel):
    id: str
    name: str
    description: str = ""
    category: str = LOCAL_TEMPLATE_CATEGORY
    tags: List[str] = []
    author: str = "我的模板"
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class LocalTemplateIndexResponse(BaseModel):
    items: List[LocalTemplateIndexItemResponse]


class LocalTemplateSaveRequest(BaseModel):
    id: Optional[str] = Field(default=None, min_length=1, max_length=128)
    name: str = Field(..., min_length=1, max_length=128)
    description: str = Field(default="", max_length=2000)
    category: str = Field(default=LOCAL_TEMPLATE_CATEGORY, max_length=64)
    tags: List[str] = []
    nodes: List[Dict[str, Any]]
    edges: List[Dict[str, Any]]
    groups: List[Dict[str, Any]] = []


def normalize_index_url(value: str | None) -> str:
    text = str(value or "").strip() or DEFAULT_TEMPLATE_INDEX_URL
    parsed = urlparse(text)
    if parsed.scheme not in ALLOWED_SCHEMES or not parsed.netloc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="模板索引地址必须是有效的 http/https URL",
        )
    return text


def slugify_template_id(value: str) -> str:
    text = re.sub(r"[^a-zA-Z0-9_-]+", "-", str(value or "").strip()).strip("-_")
    return text[:128] if text else ""


def get_user_template_dir(user_id: str) -> Path:
    target_dir = LOCAL_TEMPLATE_BASE_DIR / str(user_id)
    target_dir.mkdir(parents=True, exist_ok=True)
    return target_dir


def get_user_template_path(user_id: str, template_id: str) -> Path:
    safe_id = slugify_template_id(template_id)
    if not safe_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="模板 ID 无效",
        )

    user_dir = get_user_template_dir(user_id).resolve()
    file_path = (user_dir / f"{safe_id}.json").resolve()
    if file_path.parent != user_dir:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="模板路径无效",
        )
    return file_path


def normalize_local_template_payload(
    template_id: str, payload: Any
) -> TemplateFlowResponse:
    normalized = normalize_template_flow(template_id, payload)
    normalized.author = str(payload.get("author") or "我的模板").strip() or "我的模板"
    normalized.groups = (
        payload.get("groups") if isinstance(payload.get("groups"), list) else []
    )
    return normalized


def normalize_local_template_item(
    template_id: str, payload: Any, file_path: Path
) -> LocalTemplateIndexItemResponse:
    if not isinstance(payload, dict):
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="本地模板格式错误",
        )

    created_at = payload.get("created_at")
    updated_at = payload.get("updated_at")
    if not created_at:
        created_at = datetime.fromtimestamp(file_path.stat().st_ctime).isoformat()
    if not updated_at:
        updated_at = datetime.fromtimestamp(file_path.stat().st_mtime).isoformat()

    return LocalTemplateIndexItemResponse(
        id=template_id,
        name=str(payload.get("name") or template_id).strip() or template_id,
        description=str(payload.get("description") or "").strip(),
        category=str(payload.get("category") or LOCAL_TEMPLATE_CATEGORY).strip()
        or LOCAL_TEMPLATE_CATEGORY,
        tags=[
            str(tag).strip() for tag in (payload.get("tags") or []) if str(tag).strip()
        ],
        author=str(payload.get("author") or "我的模板").strip() or "我的模板",
        created_at=str(created_at) if created_at else None,
        updated_at=str(updated_at) if updated_at else None,
    )


def fetch_remote_json(url: str) -> Any:
    split_result = urlsplit(url)
    safe_url = urlunsplit(
        (
            split_result.scheme,
            split_result.netloc,
            quote(split_result.path, safe="/%:@"),
            quote(split_result.query, safe="=&%:@,+"),
            quote(split_result.fragment, safe=""),
        )
    )
    request = Request(
        safe_url,
        headers={
            "User-Agent": "BrowserFlow/1.0",
            "Accept": "application/json,text/plain,*/*",
        },
    )
    try:
        with urlopen(request, timeout=FETCH_TIMEOUT_SECONDS) as response:
            charset = response.headers.get_content_charset() or "utf-8"
            payload = response.read().decode(charset)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"拉取模板数据失败: {exc}",
        ) from exc

    try:
        return json.loads(payload)
    except json.JSONDecodeError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"模板 JSON 解析失败: {exc}",
        ) from exc


def resolve_item_url(base_index_url: str, path: str | None, url: str | None) -> str:
    if url and str(url).strip():
        resolved = str(url).strip()
    elif path and str(path).strip():
        resolved = urljoin(base_index_url, str(path).strip())
    else:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="模板索引项缺少 url 或 path",
        )

    parsed = urlparse(resolved)
    if parsed.scheme not in ALLOWED_SCHEMES or not parsed.netloc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="模板文件地址无效",
        )
    return resolved


def normalize_index_payload(index_url: str, payload: Any) -> TemplateIndexResponse:
    if not isinstance(payload, dict):
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="模板索引格式错误",
        )

    categories_raw = payload.get("categories") or []
    items_raw = payload.get("items") or []
    if not isinstance(categories_raw, list) or not isinstance(items_raw, list):
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="模板索引缺少 categories/items 列表",
        )

    categories: List[TemplateCategoryResponse] = []
    for item in categories_raw:
        if not isinstance(item, dict):
            continue
        key = str(item.get("key") or "").strip()
        label = str(item.get("label") or key).strip()
        if not key or not label:
            continue
        categories.append(
            TemplateCategoryResponse(
                key=key,
                label=label,
                description=str(item.get("description") or "").strip(),
            )
        )

    normalized_items: List[TemplateIndexItemResponse] = []
    for item in items_raw:
        if not isinstance(item, dict):
            continue
        item_id = str(item.get("id") or "").strip()
        category = str(item.get("category") or "").strip()
        name = str(item.get("name") or "").strip()
        path = str(item.get("path") or "").strip()
        raw_url = str(item.get("url") or "").strip()
        if not item_id or not category or not name:
            continue
        item_url = resolve_item_url(index_url, path, raw_url)
        normalized_items.append(
            TemplateIndexItemResponse(
                id=item_id,
                category=category,
                name=name,
                description=str(item.get("description") or "").strip(),
                tags=[
                    str(tag).strip()
                    for tag in (item.get("tags") or [])
                    if str(tag).strip()
                ],
                author=str(item.get("author") or "官方").strip() or "官方",
                sort_order=int(item.get("sort_order") or 0),
                path=path,
                url=item_url,
            )
        )

    normalized_items.sort(
        key=lambda item: (item.category, item.sort_order, item.name.lower(), item.id)
    )

    return TemplateIndexResponse(
        version=int(payload.get("version") or 1),
        categories=categories,
        items=normalized_items,
    )


def normalize_template_flow(template_id: str, payload: Any) -> TemplateFlowResponse:
    if not isinstance(payload, dict):
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="模板文件格式错误",
        )

    nodes = payload.get("nodes")
    edges = payload.get("edges")
    if not isinstance(nodes, list) or not isinstance(edges, list):
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="模板文件缺少 nodes/edges",
        )

    return TemplateFlowResponse(
        id=template_id,
        name=str(payload.get("name") or template_id).strip() or template_id,
        description=str(payload.get("description") or "").strip(),
        category=str(payload.get("category") or "").strip(),
        tags=[
            str(tag).strip() for tag in (payload.get("tags") or []) if str(tag).strip()
        ],
        author=str(payload.get("author") or "官方").strip() or "官方",
        nodes=nodes,
        edges=edges,
        groups=payload.get("groups") if isinstance(payload.get("groups"), list) else [],
    )


def load_local_template(user_id: str, template_id: str) -> tuple[Path, Dict[str, Any]]:
    template_path = get_user_template_path(user_id, template_id)
    if not template_path.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="模板不存在",
        )

    try:
        payload = json.loads(template_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"本地模板 JSON 解析失败: {exc}",
        ) from exc

    if not isinstance(payload, dict):
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="本地模板格式错误",
        )
    return template_path, payload


@router.get("/settings", response_model=TemplateSettingsResponse)
async def get_template_settings(
    user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    ensure_admin(user)
    return TemplateSettingsResponse(
        feature_enabled=bool(get_platform_setting(db, "templates.feature_enabled")),
        index_url=normalize_index_url(
            get_platform_setting(db, "templates.index_url")
            or DEFAULT_TEMPLATE_INDEX_URL
        ),
    )


@router.put("/settings", response_model=TemplateSettingsResponse)
async def update_template_settings(
    data: TemplateSettingsUpdate,
    user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    ensure_admin(user)

    if data.feature_enabled is not None:
        set_platform_setting(db, "templates.feature_enabled", data.feature_enabled)
    if data.index_url is not None:
        set_platform_setting(
            db,
            "templates.index_url",
            normalize_index_url(data.index_url),
        )

    db.commit()

    return TemplateSettingsResponse(
        feature_enabled=bool(get_platform_setting(db, "templates.feature_enabled")),
        index_url=normalize_index_url(
            get_platform_setting(db, "templates.index_url")
            or DEFAULT_TEMPLATE_INDEX_URL
        ),
    )


@router.get("/index", response_model=TemplateIndexResponse)
async def get_template_index(
    user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not bool(get_platform_setting(db, "templates.feature_enabled")):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="模板功能未启用",
        )

    index_url = normalize_index_url(
        get_platform_setting(db, "templates.index_url") or DEFAULT_TEMPLATE_INDEX_URL
    )
    payload = fetch_remote_json(index_url)
    return normalize_index_payload(index_url, payload)


@router.get("/item", response_model=TemplateFlowResponse)
async def get_template_item(
    template_id: str = Query(..., min_length=1, max_length=128),
    user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not bool(get_platform_setting(db, "templates.feature_enabled")):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="模板功能未启用",
        )

    index_url = normalize_index_url(
        get_platform_setting(db, "templates.index_url") or DEFAULT_TEMPLATE_INDEX_URL
    )
    index_payload = normalize_index_payload(index_url, fetch_remote_json(index_url))
    item = next(
        (entry for entry in index_payload.items if entry.id == template_id), None
    )
    if item is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="模板不存在",
        )

    template_payload = fetch_remote_json(item.url)
    normalized = normalize_template_flow(template_id, template_payload)
    if not normalized.category:
        normalized.category = item.category
    if not normalized.tags:
        normalized.tags = item.tags
    if not normalized.description:
        normalized.description = item.description
    if not normalized.author:
        normalized.author = item.author
    return normalized


@router.get("/local/index", response_model=LocalTemplateIndexResponse)
async def get_local_template_index(
    user: UserModel = Depends(get_current_user),
):
    user_dir = get_user_template_dir(user.id)
    items: List[LocalTemplateIndexItemResponse] = []

    for file_path in sorted(user_dir.glob("*.json")):
        try:
            payload = json.loads(file_path.read_text(encoding="utf-8"))
            template_id = (
                str(payload.get("id") or file_path.stem).strip() or file_path.stem
            )
            items.append(normalize_local_template_item(template_id, payload, file_path))
        except Exception:
            continue

    items.sort(
        key=lambda item: (
            item.category,
            -(
                datetime.fromisoformat(item.updated_at).timestamp()
                if item.updated_at
                else 0
            ),
            item.name.lower(),
        )
    )
    return LocalTemplateIndexResponse(items=items)


@router.get("/local/item", response_model=TemplateFlowResponse)
async def get_local_template_item(
    template_id: str = Query(..., min_length=1, max_length=128),
    user: UserModel = Depends(get_current_user),
):
    _, payload = load_local_template(user.id, template_id)
    return normalize_local_template_payload(template_id, payload)


@router.post("/local/item", response_model=TemplateFlowResponse)
async def save_local_template_item(
    data: LocalTemplateSaveRequest,
    user: UserModel = Depends(get_current_user),
):
    template_id = slugify_template_id(data.id or data.name) or slugify_template_id(
        f"template-{uuid4().hex}"
    )
    template_path = get_user_template_path(user.id, template_id)

    now = datetime.utcnow().isoformat()
    existing_created_at: Optional[str] = None
    if template_path.exists():
        _, existing_payload = load_local_template(user.id, template_id)
        existing_created_at = (
            str(existing_payload.get("created_at") or "").strip() or None
        )

    payload = {
        "id": template_id,
        "name": data.name.strip(),
        "description": data.description.strip(),
        "category": data.category.strip() or LOCAL_TEMPLATE_CATEGORY,
        "tags": [str(tag).strip() for tag in data.tags if str(tag).strip()],
        "author": user.username or "我的模板",
        "nodes": data.nodes,
        "edges": data.edges,
        "groups": data.groups,
        "created_at": existing_created_at or now,
        "updated_at": now,
    }

    template_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return normalize_local_template_payload(template_id, payload)


@router.delete("/local/item", status_code=status.HTTP_204_NO_CONTENT)
async def delete_local_template_item(
    template_id: str = Query(..., min_length=1, max_length=128),
    user: UserModel = Depends(get_current_user),
):
    template_path, _ = load_local_template(user.id, template_id)
    template_path.unlink(missing_ok=True)
