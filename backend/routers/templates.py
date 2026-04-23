"""模板配置与模板索引/内容代理接口。"""

from __future__ import annotations

import json
from datetime import datetime
from typing import Any, Dict, List, Optional
from urllib.parse import quote, urljoin, urlparse, urlsplit, urlunsplit
from urllib.request import Request, urlopen

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


def normalize_index_url(value: str | None) -> str:
    text = str(value or "").strip() or DEFAULT_TEMPLATE_INDEX_URL
    parsed = urlparse(text)
    if parsed.scheme not in ALLOWED_SCHEMES or not parsed.netloc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="模板索引地址必须是有效的 http/https URL",
        )
    return text


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
    )


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
