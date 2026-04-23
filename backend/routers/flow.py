"""Flow 路由

处理 Flow 的 CRUD 操作和执行。
"""

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session
from typing import Optional, List
from datetime import datetime
from pydantic import BaseModel, Field
import json

from models.database import get_db
from models.db_models import UserModel, FlowModel, ExecutionModel
from core.notifications import normalize_notification_rules
from routers.auth import get_current_user

router = APIRouter(prefix="/api/flows", tags=["flows"])
security = HTTPBearer(auto_error=False)


# ============== Pydantic 模型 ==============


class FlowNode(BaseModel):
    """Flow 节点"""

    id: str
    type: Optional[str] = None
    nodeType: Optional[str] = None
    data: Optional[dict] = None
    position: Optional[dict] = None


class FlowEdge(BaseModel):
    """Flow 边"""

    id: str
    source: str
    target: str
    sourceHandle: Optional[str] = None
    targetHandle: Optional[str] = None


class FlowData(BaseModel):
    """Flow 数据"""

    nodes: List[FlowNode] = []
    edges: List[FlowEdge] = []


class FlowCreate(BaseModel):
    """创建 Flow"""

    name: str = Field(..., min_length=1, max_length=128)
    description: Optional[str] = None
    flow_data: FlowData
    run_settings: Optional[dict] = None
    tags: Optional[List[str]] = []
    is_template: bool = False
    identity_id: Optional[str] = None
    notification_enabled: bool = True
    notification_rules: Optional[List[dict]] = []


class FlowUpdate(BaseModel):
    """更新 Flow"""

    name: Optional[str] = Field(None, min_length=1, max_length=128)
    description: Optional[str] = None
    flow_data: Optional[FlowData] = None
    run_settings: Optional[dict] = None
    tags: Optional[List[str]] = None
    is_template: Optional[bool] = None
    is_active: Optional[bool] = None
    identity_id: Optional[str] = None
    notification_enabled: Optional[bool] = None
    notification_rules: Optional[List[dict]] = None


class FlowResponse(BaseModel):
    """Flow 响应"""

    id: str
    name: str
    description: Optional[str]
    flow_data: dict
    run_settings: Optional[dict] = None
    tags: List[str]
    is_template: bool
    is_active: bool
    identity_id: Optional[str]
    notification_enabled: bool
    notification_rules: List[dict]
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class FlowListResponse(BaseModel):
    """Flow 列表响应"""

    id: str
    name: str
    description: Optional[str]
    run_settings: Optional[dict] = None
    tags: List[str]
    is_template: bool
    is_active: bool
    identity_id: Optional[str]
    notification_enabled: bool
    notification_rules: List[dict]
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class FlowListPageResponse(BaseModel):
    items: List[FlowListResponse]
    total: int
    page: int
    page_size: int
    total_pages: int


class ExecuteRequest(BaseModel):
    """执行请求"""

    flow_id: str
    identity_id: Optional[str] = None


# ============== API 端点 ==============


@router.post("", response_model=FlowResponse)
async def create_flow(
    data: FlowCreate,
    user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """创建 Flow"""
    flow = FlowModel(
        user_id=user.id,
        name=data.name,
        description=data.description,
        flow_data=data.flow_data.model_dump(),
        run_settings=data.run_settings,
        tags=json.dumps(data.tags),
        is_template=data.is_template,
        identity_id=data.identity_id,
        notification_enabled=data.notification_enabled,
        notification_rules=normalize_notification_rules(
            data.notification_rules, user.id
        ),
    )
    db.add(flow)
    db.commit()
    db.refresh(flow)

    return FlowResponse(
        id=flow.id,
        name=flow.name,
        description=flow.description,
        flow_data=flow.flow_data,
        run_settings=flow.run_settings,
        tags=json.loads(flow.tags),
        is_template=flow.is_template,
        is_active=flow.is_active,
        identity_id=flow.identity_id,
        notification_enabled=flow.notification_enabled,
        notification_rules=flow.notification_rules or [],
        created_at=flow.created_at,
        updated_at=flow.updated_at,
    )


@router.get("", response_model=FlowListPageResponse)
async def list_flows(
    is_template: Optional[bool] = None,
    is_active: Optional[bool] = None,
    page: int = 1,
    page_size: int = 12,
    user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """获取 Flow 列表"""
    query = db.query(FlowModel).filter(FlowModel.user_id == user.id)

    if is_template is not None:
        query = query.filter(FlowModel.is_template == is_template)
    if is_active is not None:
        query = query.filter(FlowModel.is_active == is_active)

    safe_page_size = max(1, min(page_size, 100))
    total = query.count()
    total_pages = (
        max(1, (total + safe_page_size - 1) // safe_page_size) if total > 0 else 1
    )
    safe_page = max(1, min(page, total_pages))
    offset = (safe_page - 1) * safe_page_size

    flows = (
        query.order_by(FlowModel.updated_at.desc())
        .offset(offset)
        .limit(safe_page_size)
        .all()
    )

    return FlowListPageResponse(
        items=[
            FlowListResponse(
                id=f.id,
                name=f.name,
                description=f.description,
                run_settings=f.run_settings,
                tags=json.loads(f.tags),
                is_template=f.is_template,
                is_active=f.is_active,
                identity_id=f.identity_id,
                notification_enabled=f.notification_enabled,
                notification_rules=f.notification_rules or [],
                created_at=f.created_at,
                updated_at=f.updated_at,
            )
            for f in flows
        ],
        total=total,
        page=safe_page,
        page_size=safe_page_size,
        total_pages=total_pages,
    )


@router.get("/{flow_id}", response_model=FlowResponse)
async def get_flow(
    flow_id: str,
    user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """获取单个 Flow"""
    flow = (
        db.query(FlowModel)
        .filter(
            FlowModel.id == flow_id,
            FlowModel.user_id == user.id,
        )
        .first()
    )

    if not flow:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Flow not found"
        )

    return FlowResponse(
        id=flow.id,
        name=flow.name,
        description=flow.description,
        flow_data=flow.flow_data,
        run_settings=flow.run_settings,
        tags=json.loads(flow.tags),
        is_template=flow.is_template,
        is_active=flow.is_active,
        identity_id=flow.identity_id,
        notification_enabled=flow.notification_enabled,
        notification_rules=flow.notification_rules or [],
        created_at=flow.created_at,
        updated_at=flow.updated_at,
    )


@router.put("/{flow_id}", response_model=FlowResponse)
async def update_flow(
    flow_id: str,
    data: FlowUpdate,
    user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """更新 Flow"""
    flow = (
        db.query(FlowModel)
        .filter(
            FlowModel.id == flow_id,
            FlowModel.user_id == user.id,
        )
        .first()
    )

    if not flow:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Flow not found"
        )

    if data.name is not None:
        flow.name = data.name
    if data.description is not None:
        flow.description = data.description
    if data.flow_data is not None:
        flow.flow_data = data.flow_data.model_dump()
    if data.run_settings is not None:
        flow.run_settings = data.run_settings
    if data.tags is not None:
        flow.tags = json.dumps(data.tags)
    if data.is_template is not None:
        flow.is_template = data.is_template
    if data.is_active is not None:
        flow.is_active = data.is_active
    if data.identity_id is not None:
        flow.identity_id = data.identity_id
    if data.notification_enabled is not None:
        flow.notification_enabled = data.notification_enabled
    if data.notification_rules is not None:
        flow.notification_rules = normalize_notification_rules(
            data.notification_rules, user.id
        )

    flow.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(flow)

    return FlowResponse(
        id=flow.id,
        name=flow.name,
        description=flow.description,
        flow_data=flow.flow_data,
        run_settings=flow.run_settings,
        tags=json.loads(flow.tags),
        is_template=flow.is_template,
        is_active=flow.is_active,
        identity_id=flow.identity_id,
        notification_enabled=flow.notification_enabled,
        notification_rules=flow.notification_rules or [],
        created_at=flow.created_at,
        updated_at=flow.updated_at,
    )


@router.delete("/{flow_id}")
async def delete_flow(
    flow_id: str,
    user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """删除 Flow"""
    flow = (
        db.query(FlowModel)
        .filter(
            FlowModel.id == flow_id,
            FlowModel.user_id == user.id,
        )
        .first()
    )

    if not flow:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Flow not found"
        )

    db.delete(flow)
    db.commit()

    return {"message": "Flow deleted successfully"}
