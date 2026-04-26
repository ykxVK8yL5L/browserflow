"""Execution 路由

处理 Flow 执行的管理和状态查询。
"""

import os
import shutil
import copy

from fastapi import APIRouter, Depends, HTTPException, status, BackgroundTasks
from sqlalchemy import text
from sqlalchemy.orm import Session
from typing import Optional, List
from datetime import datetime
from pydantic import BaseModel, Field
import uuid
from fastapi.responses import FileResponse

from models.database import get_db, DATABASE_URL, engine
from models.db_models import (
    UserModel,
    FlowModel,
    IdentityModel,
    ExecutionModel,
    NodeExecutionModel,
)
from routers.auth import get_current_user
from core.queue import execution_queue, ExecutionQueueItem, ExecutionStatus
from core.executor import run_execution, resolve_flow_credentials
from core.identity_lock import is_identity_locked, get_lock_owner
from core.websocket_manager import ws_manager
from core.screenshot_storage import (
    SCREENSHOTS_DIR,
    build_legacy_screenshot_dir,
    build_screenshot_dir,
)

router = APIRouter(prefix="/api/executions", tags=["executions"])


DEFAULT_RUN_SETTINGS = {
    "headless": True,
    "viewport": {"width": 1920, "height": 1080},
    "locale": "en-US",
    "timezone": "America/New_York",
    "proxy": "",
    "humanize": True,
    "device": "Desktop Chrome",
}


def merge_run_settings(
    flow_run_settings: Optional[dict], request_data: "ExecuteRequest"
) -> dict:
    """合并 Flow 保存的运行设置与本次请求参数。"""
    merged = dict(DEFAULT_RUN_SETTINGS)

    if isinstance(flow_run_settings, dict):
        for key in DEFAULT_RUN_SETTINGS.keys():
            if flow_run_settings.get(key) is not None:
                merged[key] = flow_run_settings.get(key)

    overrides = {
        "headless": request_data.headless,
        "viewport": request_data.viewport,
        "locale": request_data.locale,
        "timezone": request_data.timezone,
        "proxy": request_data.proxy,
        "humanize": request_data.humanize,
        "device": request_data.device,
    }
    for key, value in overrides.items():
        if value is not None:
            merged[key] = value

    return merged


def build_screenshot_url(execution_id: str, node_id: str, filename: str) -> str:
    return (
        f"/api/executions/{execution_id}/nodes/{node_id}/screenshot?filename={filename}"
    )


def enrich_result_data_with_screenshot(
    execution_id: str, node_id: str, result_data: Optional[dict]
) -> Optional[dict]:
    sanitized = sanitize_node_result_data(result_data)
    if not isinstance(sanitized, dict):
        return sanitized

    enriched = dict(sanitized)
    filename = enriched.get("filename")
    if filename:
        enriched["screenshot_url"] = build_screenshot_url(
            execution_id, node_id, filename
        )
    return enriched


def extract_screenshot_url(result_data: Optional[dict]) -> Optional[str]:
    if not isinstance(result_data, dict):
        return None
    return result_data.get("screenshot_url")


def sanitize_node_result_data(result_data: Optional[dict]) -> Optional[dict]:
    """清理不应出现在执行记录中的敏感结果。"""
    if not isinstance(result_data, dict):
        return result_data

    sanitized = dict(result_data)
    if sanitized.get("sensitive") is True:
        sanitized.pop("content", None)

    return sanitized


def sanitize_snapshot_node(node: dict) -> dict:
    """清理流程快照中的敏感节点配置。"""
    if not isinstance(node, dict):
        return node

    sanitized_node = copy.deepcopy(node)
    node_type = sanitized_node.get("type")
    data = sanitized_node.get("data")

    if node_type != "file" or not isinstance(data, dict):
        return sanitized_node

    params = data.get("params")
    action = None
    if isinstance(params, dict):
        action = params.get("action")
    if action is None:
        action = data.get("action")

    if str(action or "").lower() != "write":
        return sanitized_node

    if isinstance(params, dict) and "content" in params:
        params["content"] = "[REDACTED]"
    if "content" in data:
        data["content"] = "[REDACTED]"

    return sanitized_node


def remove_execution_screenshots(execution_id: str, user_id: str) -> bool:
    """删除某次执行的截图目录。"""
    deleted = False
    for screenshots_dir in [
        build_screenshot_dir(user_id, execution_id),
        build_legacy_screenshot_dir(execution_id),
    ]:
        if not os.path.isdir(screenshots_dir):
            continue
        try:
            shutil.rmtree(screenshots_dir)
            deleted = True
        except Exception as e:
            print(f"Failed to delete screenshots for {execution_id}: {e}")
    return deleted


# ============== Pydantic 模型 ==============


class ExecuteRequest(BaseModel):
    """执行请求"""

    flow_id: str
    identity_id: Optional[str] = None
    user_agent_id: Optional[str] = None
    headless: Optional[bool] = None
    viewport: Optional[dict] = None
    locale: Optional[str] = "en-US"
    timezone: Optional[str] = "America/New_York"
    proxy: Optional[str] = ""
    humanize: Optional[bool] = True
    device: Optional[str] = None  # 新增设备字段


class ExecutionResponse(BaseModel):
    """Execution 响应"""

    id: str
    flow_id: str
    flow_name: Optional[str] = None
    identity_id: Optional[str]
    identity_name: Optional[str] = None
    status: str
    result: Optional[dict]
    flow_snapshot: Optional[dict] = None
    error_message: Optional[str]
    started_at: Optional[datetime]
    finished_at: Optional[datetime]
    created_at: datetime

    class Config:
        from_attributes = True


class ExecutionListResponse(BaseModel):
    """Execution 列表响应"""

    id: str
    flow_id: str
    flow_name: Optional[str] = None
    identity_id: Optional[str]
    identity_name: Optional[str] = None
    status: str
    started_at: Optional[datetime]
    finished_at: Optional[datetime]
    created_at: datetime
    flow_snapshot: Optional[dict] = None
    # 新增：节点统计和结果
    node_results: Optional[dict] = None  # {node_id: {...}}
    logs: Optional[List[dict]] = None  # [{timestamp, nodeId, nodeName, level, message}]
    node_count: int = 0
    success_count: int = 0
    failed_count: int = 0
    skipped_count: int = 0

    class Config:
        from_attributes = True


class ExecutionStatusResponse(BaseModel):
    """Execution 状态响应"""

    id: str
    status: str
    result: Optional[dict]
    error_message: Optional[str]
    started_at: Optional[datetime]
    finished_at: Optional[datetime]


def build_flow_snapshot(flow_data: Optional[dict]) -> Optional[dict]:
    """提取可用于历史回放的流程快照"""
    if not isinstance(flow_data, dict):
        return None

    nodes = flow_data.get("nodes")
    edges = flow_data.get("edges")

    if not isinstance(nodes, list) or not isinstance(edges, list):
        return None

    flow_snapshot = {
        "nodes": [sanitize_snapshot_node(node) for node in nodes],
        "edges": copy.deepcopy(edges),
    }

    groups = flow_data.get("groups")
    if isinstance(groups, list):
        flow_snapshot["groups"] = copy.deepcopy(groups)

    options = flow_data.get("options")
    if isinstance(options, dict):
        flow_snapshot["options"] = copy.deepcopy(options)

    return flow_snapshot


class PaginatedExecutionResponse(BaseModel):
    """分页 Execution 列表响应"""

    records: List[ExecutionListResponse]
    total: int
    page: int
    pageSize: int
    totalPages: int


class CleanupExecutionsRequest(BaseModel):
    """清理执行记录请求"""

    flow_id: Optional[str] = Field(
        default=None, description="仅清理某个 Flow 的执行记录"
    )
    keep_latest: int = Field(default=0, ge=0, description="保留最近 N 条记录")
    vacuum: bool = Field(default=True, description="清理后是否执行 VACUUM")


class CleanupExecutionsResponse(BaseModel):
    """清理执行记录响应"""

    deleted_executions: int
    deleted_node_executions: int
    deleted_screenshot_dirs: int
    kept_executions: int
    database_compacted: bool
    freelist_before: Optional[int] = None
    freelist_after: Optional[int] = None
    page_count_before: Optional[int] = None
    page_count_after: Optional[int] = None


# ============== 辅助函数 ==============


@router.get("/paginated", response_model=PaginatedExecutionResponse)
async def list_executions_paginated(
    flow_id: Optional[str] = None,
    status: Optional[str] = None,
    page: int = 1,
    pageSize: int = 10,
    user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """获取分页 Execution 列表"""
    query = db.query(ExecutionModel).filter(ExecutionModel.user_id == user.id)
    if flow_id:
        query = query.filter(ExecutionModel.flow_id == flow_id)
    if status:
        query = query.filter(ExecutionModel.status == status)

    # 计算总数
    total = query.count()
    totalPages = max(1, (total + pageSize - 1) // pageSize)
    safePage = max(1, min(page, totalPages))

    # 分页查询
    offset = (safePage - 1) * pageSize
    executions = (
        query.order_by(ExecutionModel.created_at.desc())
        .offset(offset)
        .limit(pageSize)
        .all()
    )

    # 获取关联的 flow 和 identity 名称
    flow_ids = [e.flow_id for e in executions]
    identity_ids = [e.identity_id for e in executions if e.identity_id]
    flows = db.query(FlowModel).filter(FlowModel.id.in_(flow_ids)).all()
    flow_map = {f.id: f.name for f in flows}
    identities = (
        db.query(IdentityModel).filter(IdentityModel.id.in_(identity_ids)).all()
        if identity_ids
        else []
    )
    identity_map = {i.id: i.name for i in identities}

    # 获取所有 execution 的节点执行记录，用于统计
    execution_ids = [e.id for e in executions]
    all_node_executions = (
        db.query(NodeExecutionModel)
        .filter(NodeExecutionModel.execution_id.in_(execution_ids))
        .all()
    )

    # 按 execution_id 分组
    node_executions_by_execution = {}
    for ne in all_node_executions:
        if ne.execution_id not in node_executions_by_execution:
            node_executions_by_execution[ne.execution_id] = []
        node_executions_by_execution[ne.execution_id].append(ne)

    records = []
    for e in executions:
        # 获取该 execution 的节点执行记录
        node_execs = node_executions_by_execution.get(e.id, [])

        # 计算统计
        node_count = len(node_execs)
        success_count = sum(1 for ne in node_execs if ne.status == "success")
        failed_count = sum(1 for ne in node_execs if ne.status == "failed")
        skipped_count = sum(1 for ne in node_execs if ne.status == "skipped")

        # 构建 node_results 字典
        node_results = {}
        logs = []
        for ne in node_execs:
            enriched_result_data = enrich_result_data_with_screenshot(
                e.id, ne.node_id, ne.result_data
            )
            node_results[ne.node_id] = {
                "nodeId": ne.node_id,
                "nodeType": ne.node_type,
                "status": ne.status,
                "message": ne.message,
                "error": ne.error,
                "startedAt": ne.started_at.isoformat() if ne.started_at else None,
                "finishedAt": ne.finished_at.isoformat() if ne.finished_at else None,
                "duration": ne.duration_ms,
                "screenshot": extract_screenshot_url(enriched_result_data),
            }
            logs.append(
                {
                    "nodeId": ne.node_id,
                    "level": ne.status,
                    "nodeName": ne.node_label,
                    "message": ne.message,
                    "timestamp": ne.created_at.isoformat(),
                }
            )

        records.append(
            ExecutionListResponse(
                id=e.id,
                flow_id=e.flow_id,
                flow_name=flow_map.get(e.flow_id),
                identity_id=e.identity_id,
                identity_name=(
                    identity_map.get(e.identity_id) if e.identity_id else None
                ),
                status=e.status,
                started_at=e.started_at,
                finished_at=e.finished_at,
                created_at=e.created_at,
                flow_snapshot=e.flow_snapshot,
                node_results=node_results if node_results else None,
                logs=logs if logs else None,
                node_count=node_count,
                success_count=success_count,
                failed_count=failed_count,
                skipped_count=skipped_count,
            )
        )

    return PaginatedExecutionResponse(
        records=records,
        total=total,
        page=safePage,
        pageSize=pageSize,
        totalPages=totalPages,
    )


async def execute_flow_task(
    execution_id: str,
    user_id: str,
    flow_id: str,
    identity_id: Optional[str],
    flow_data: dict,
    client_id: str,
    db_url: str,
    user_agent_id: Optional[str] = None,
    headless: Optional[bool] = None,
    viewport: Optional[dict] = None,
    locale: Optional[str] = "en-US",
    timezone: Optional[str] = "America/New_York",
    proxy: Optional[str] = "",
    humanize: Optional[bool] = True,
    device: Optional[str] = None,
):
    """后台执行 Flow 的任务"""
    from models.database import SessionLocal
    from core.queue import ExecutionQueueItem

    db = SessionLocal()
    try:
        # 获取 execution 记录
        execution = (
            db.query(ExecutionModel).filter(ExecutionModel.id == execution_id).first()
        )

        if not execution:
            return

        resolved_flow_data = resolve_flow_credentials(flow_data, user_id)

        # 更新状态为运行中
        execution.status = "running"
        execution.started_at = datetime.utcnow()
        execution.flow_snapshot = build_flow_snapshot(flow_data)
        db.commit()

        # 创建执行项
        item = ExecutionQueueItem(
            execution_id=execution_id,
            user_id=user_id,
            flow_id=flow_id,
            identity_id=identity_id,
            flow_data=resolved_flow_data,
            client_id=client_id,
            status=ExecutionStatus.RUNNING,
            started_at=datetime.utcnow(),
            user_agent_id=user_agent_id,
            headless=headless,
            viewport=viewport,
            locale=locale,
            timezone=timezone,
            proxy=proxy,
            humanize=humanize,
            device=device,
        )

        # 执行
        result = await run_execution(item)

        # 更新 execution 记录
        execution.status = result.get("status", "completed")
        execution.result = result
        execution.finished_at = datetime.utcnow()
        if result.get("error"):
            execution.error_message = result["error"]
        db.commit()

        # 更新 identity 的 last_used
        if identity_id:
            identity = (
                db.query(IdentityModel).filter(IdentityModel.id == identity_id).first()
            )
            if identity:
                identity.last_used = datetime.utcnow()
                db.commit()

    except Exception as e:
        # 更新错误状态
        execution = (
            db.query(ExecutionModel).filter(ExecutionModel.id == execution_id).first()
        )
        if execution:
            execution.status = "failed"
            execution.error_message = str(e)
            execution.finished_at = datetime.utcnow()
            db.commit()

    finally:
        db.close()


# ============== API 端点 ==============


@router.post("", response_model=ExecutionResponse)
async def create_execution(
    data: ExecuteRequest,
    background_tasks: BackgroundTasks,
    user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """创建并执行 Flow"""
    # 验证 Flow 存在
    flow = (
        db.query(FlowModel)
        .filter(
            FlowModel.id == data.flow_id,
            FlowModel.user_id == user.id,
        )
        .first()
    )

    if not flow:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Flow not found"
        )

    # 验证 Identity（如果指定）
    identity = None
    if data.identity_id:
        identity = (
            db.query(IdentityModel)
            .filter(
                IdentityModel.id == data.identity_id,
                IdentityModel.user_id == user.id,
            )
            .first()
        )

        if not identity:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Identity not found"
            )

        # 检查 Identity 是否被锁定
        if is_identity_locked(data.identity_id):
            lock_owner = get_lock_owner(data.identity_id)
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Identity is currently in use by execution: {lock_owner}",
            )

    # 创建 Execution 记录
    execution = ExecutionModel(
        user_id=user.id,
        flow_id=data.flow_id,
        identity_id=data.identity_id,
        status="pending",
        flow_snapshot=build_flow_snapshot(flow.flow_data),
    )
    db.add(execution)
    db.commit()
    db.refresh(execution)

    # 获取 WebSocket client_id
    client_id = ws_manager.get_client_id(user.id) or str(uuid.uuid4())

    # 添加后台任务执行
    from models.database import DATABASE_URL

    merged_run_settings = merge_run_settings(flow.run_settings, data)

    background_tasks.add_task(
        execute_flow_task,
        execution.id,
        user.id,
        data.flow_id,
        data.identity_id,
        flow.flow_data,
        client_id,
        DATABASE_URL,
        data.user_agent_id,
        merged_run_settings["headless"],
        merged_run_settings["viewport"],
        merged_run_settings["locale"],
        merged_run_settings["timezone"],
        merged_run_settings["proxy"],
        merged_run_settings["humanize"],
        merged_run_settings["device"],
    )

    return ExecutionResponse(
        id=execution.id,
        flow_id=execution.flow_id,
        flow_name=flow.name,
        identity_id=execution.identity_id,
        identity_name=identity.name if identity else None,
        status=execution.status,
        result=execution.result,
        flow_snapshot=execution.flow_snapshot,
        error_message=execution.error_message,
        started_at=execution.started_at,
        finished_at=execution.finished_at,
        created_at=execution.created_at,
    )


@router.get("", response_model=List[ExecutionListResponse])
async def list_executions(
    flow_id: Optional[str] = None,
    status: Optional[str] = None,
    limit: int = 50,
    user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """获取 Execution 列表"""
    query = db.query(ExecutionModel).filter(ExecutionModel.user_id == user.id)

    if flow_id:
        query = query.filter(ExecutionModel.flow_id == flow_id)
    if status:
        query = query.filter(ExecutionModel.status == status)

    executions = query.order_by(ExecutionModel.created_at.desc()).limit(limit).all()

    # 获取关联的 flow 和 identity 名称
    flow_ids = [e.flow_id for e in executions]
    identity_ids = [e.identity_id for e in executions if e.identity_id]

    flows = db.query(FlowModel).filter(FlowModel.id.in_(flow_ids)).all()
    flow_map = {f.id: f.name for f in flows}

    identities = (
        db.query(IdentityModel).filter(IdentityModel.id.in_(identity_ids)).all()
        if identity_ids
        else []
    )
    identity_map = {i.id: i.name for i in identities}

    return [
        ExecutionListResponse(
            id=e.id,
            flow_id=e.flow_id,
            flow_name=flow_map.get(e.flow_id),
            identity_id=e.identity_id,
            identity_name=identity_map.get(e.identity_id) if e.identity_id else None,
            status=e.status,
            started_at=e.started_at,
            finished_at=e.finished_at,
            created_at=e.created_at,
            flow_snapshot=e.flow_snapshot,
        )
        for e in executions
    ]


@router.get("/{execution_id}", response_model=ExecutionResponse)
async def get_execution(
    execution_id: str,
    user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """获取单个 Execution"""
    execution = (
        db.query(ExecutionModel)
        .filter(
            ExecutionModel.id == execution_id,
            ExecutionModel.user_id == user.id,
        )
        .first()
    )

    if not execution:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Execution not found"
        )

    # 获取关联的 flow 和 identity 名称
    flow = db.query(FlowModel).filter(FlowModel.id == execution.flow_id).first()
    identity = None
    if execution.identity_id:
        identity = (
            db.query(IdentityModel)
            .filter(IdentityModel.id == execution.identity_id)
            .first()
        )

    return ExecutionResponse(
        id=execution.id,
        flow_id=execution.flow_id,
        flow_name=flow.name if flow else None,
        identity_id=execution.identity_id,
        identity_name=identity.name if identity else None,
        status=execution.status,
        result=execution.result,
        flow_snapshot=execution.flow_snapshot,
        error_message=execution.error_message,
        started_at=execution.started_at,
        finished_at=execution.finished_at,
        created_at=execution.created_at,
    )


@router.get("/{execution_id}/status", response_model=ExecutionStatusResponse)
async def get_execution_status(
    execution_id: str,
    user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """获取 Execution 状态"""
    execution = (
        db.query(ExecutionModel)
        .filter(
            ExecutionModel.id == execution_id,
            ExecutionModel.user_id == user.id,
        )
        .first()
    )

    if not execution:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Execution not found"
        )

    return ExecutionStatusResponse(
        id=execution.id,
        status=execution.status,
        result=execution.result,
        error_message=execution.error_message,
        started_at=execution.started_at,
        finished_at=execution.finished_at,
    )


@router.post("/{execution_id}/cancel")
async def cancel_execution(
    execution_id: str,
    user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """取消 Execution"""
    execution = (
        db.query(ExecutionModel)
        .filter(
            ExecutionModel.id == execution_id,
            ExecutionModel.user_id == user.id,
        )
        .first()
    )

    if not execution:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Execution not found"
        )

    if execution.status not in ["pending", "running"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Cannot cancel execution with status: {execution.status}",
        )

    # 更新状态
    execution.status = "cancelled"
    execution.finished_at = datetime.utcnow()
    db.commit()

    return {"message": "Execution cancelled", "execution_id": execution_id}


@router.delete("/{execution_id}")
async def delete_execution(
    execution_id: str,
    user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """删除 Execution"""
    execution = (
        db.query(ExecutionModel)
        .filter(
            ExecutionModel.id == execution_id,
            ExecutionModel.user_id == user.id,
        )
        .first()
    )

    if not execution:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Execution not found"
        )

    # if execution.status == "running":
    #     raise HTTPException(
    #         status_code=status.HTTP_400_BAD_REQUEST,
    #         detail="Cannot delete running execution",
    #     )

    remove_execution_screenshots(execution_id, user.id)

    # 删除节点执行记录
    db.query(NodeExecutionModel).filter(
        NodeExecutionModel.execution_id == execution_id
    ).delete()

    # 删除 execution 记录
    db.delete(execution)
    db.commit()

    return {"message": "Execution deleted successfully"}


@router.delete("/by-flow/{flow_id}")
async def delete_executions_by_flow(
    flow_id: str,
    user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """删除指定 Flow 的所有执行记录（兼容旧 clear all 接口，内部复用 cleanup 逻辑）。"""
    return await cleanup_executions(
        CleanupExecutionsRequest(
            flow_id=flow_id,
            keep_latest=0,
            vacuum=True,
        ),
        user,
        db,
    )


@router.post("/cleanup", response_model=CleanupExecutionsResponse)
async def cleanup_executions(
    data: CleanupExecutionsRequest,
    user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """清理当前用户的执行记录，并可选执行 VACUUM 回收 SQLite 空间。"""
    query = db.query(ExecutionModel).filter(ExecutionModel.user_id == user.id)

    if data.flow_id:
        flow = (
            db.query(FlowModel)
            .filter(FlowModel.id == data.flow_id, FlowModel.user_id == user.id)
            .first()
        )
        if not flow:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Flow not found",
            )
        query = query.filter(ExecutionModel.flow_id == data.flow_id)

    executions = query.order_by(ExecutionModel.created_at.desc()).all()
    kept_executions = executions[: data.keep_latest]
    deleted_executions = executions[data.keep_latest :]

    if not deleted_executions:
        return CleanupExecutionsResponse(
            deleted_executions=0,
            deleted_node_executions=0,
            deleted_screenshot_dirs=0,
            kept_executions=len(kept_executions),
            database_compacted=False,
        )

    # running 也可以被删除，running可能是异常退出造成的
    # running = [item for item in deleted_executions if item.status == "running"]
    # if running:
    #     raise HTTPException(
    #         status_code=status.HTTP_400_BAD_REQUEST,
    #         detail=f"Cannot cleanup {len(running)} running execution(s)",
    #     )

    execution_ids = [item.id for item in deleted_executions]
    deleted_node_executions = (
        db.query(NodeExecutionModel)
        .filter(NodeExecutionModel.execution_id.in_(execution_ids))
        .count()
    )

    deleted_screenshot_dirs = 0
    for execution_id in execution_ids:
        if remove_execution_screenshots(execution_id, user.id):
            deleted_screenshot_dirs += 1

    db.query(NodeExecutionModel).filter(
        NodeExecutionModel.execution_id.in_(execution_ids)
    ).delete(synchronize_session=False)

    db.query(ExecutionModel).filter(ExecutionModel.id.in_(execution_ids)).delete(
        synchronize_session=False
    )
    db.commit()

    freelist_before = None
    freelist_after = None
    page_count_before = None
    page_count_after = None
    database_compacted = False

    if data.vacuum and DATABASE_URL.startswith("sqlite:///"):
        with engine.connect() as conn:
            freelist_before = conn.execute(text("PRAGMA freelist_count")).scalar()
            page_count_before = conn.execute(text("PRAGMA page_count")).scalar()

        with engine.connect().execution_options(isolation_level="AUTOCOMMIT") as conn:
            conn.execute(text("VACUUM"))

        with engine.connect() as conn:
            freelist_after = conn.execute(text("PRAGMA freelist_count")).scalar()
            page_count_after = conn.execute(text("PRAGMA page_count")).scalar()

        database_compacted = True

    return CleanupExecutionsResponse(
        deleted_executions=len(execution_ids),
        deleted_node_executions=deleted_node_executions,
        deleted_screenshot_dirs=deleted_screenshot_dirs,
        kept_executions=len(kept_executions),
        database_compacted=database_compacted,
        freelist_before=freelist_before,
        freelist_after=freelist_after,
        page_count_before=page_count_before,
        page_count_after=page_count_after,
    )


# ============== 节点执行记录 API ==============


class NodeExecutionResponse(BaseModel):
    """节点执行记录响应"""

    id: str
    execution_id: str
    node_id: str
    node_type: str
    status: str
    message: Optional[str] = None
    error: Optional[str] = None
    result_data: Optional[dict] = None
    started_at: Optional[datetime] = None
    finished_at: Optional[datetime] = None
    duration_ms: Optional[int] = None
    created_at: datetime

    class Config:
        from_attributes = True


class ExecutionDetailResponse(BaseModel):
    """Execution 详情响应（包含节点执行记录）"""

    id: str
    flow_id: str
    flow_name: Optional[str] = None
    identity_id: Optional[str]
    identity_name: Optional[str] = None
    status: str
    result: Optional[dict] = None
    flow_snapshot: Optional[dict] = None
    error_message: Optional[str] = None
    started_at: Optional[datetime] = None
    finished_at: Optional[datetime] = None
    created_at: datetime
    node_executions: List[NodeExecutionResponse] = []

    class Config:
        from_attributes = True


@router.get("/{execution_id}/detail", response_model=ExecutionDetailResponse)
async def get_execution_detail(
    execution_id: str,
    user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """获取 Execution 详情（包含节点执行记录）"""
    from models.db_models import NodeExecutionModel

    execution = (
        db.query(ExecutionModel)
        .filter(
            ExecutionModel.id == execution_id,
            ExecutionModel.user_id == user.id,
        )
        .first()
    )
    if not execution:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Execution not found"
        )

    # 获取关联的 flow 和 identity 名称
    flow = db.query(FlowModel).filter(FlowModel.id == execution.flow_id).first()
    identity = None
    if execution.identity_id:
        identity = (
            db.query(IdentityModel)
            .filter(IdentityModel.id == execution.identity_id)
            .first()
        )

    # 获取节点执行记录
    node_executions = (
        db.query(NodeExecutionModel)
        .filter(NodeExecutionModel.execution_id == execution_id)
        .order_by(NodeExecutionModel.started_at)
        .all()
    )

    return ExecutionDetailResponse(
        id=execution.id,
        flow_id=execution.flow_id,
        flow_name=flow.name if flow else None,
        identity_id=execution.identity_id,
        identity_name=identity.name if identity else None,
        status=execution.status,
        result=execution.result,
        flow_snapshot=execution.flow_snapshot,
        error_message=execution.error_message,
        started_at=execution.started_at,
        finished_at=execution.finished_at,
        created_at=execution.created_at,
        node_executions=[
            NodeExecutionResponse(
                id=ne.id,
                execution_id=ne.execution_id,
                node_id=ne.node_id,
                node_type=ne.node_type,
                status=ne.status,
                message=ne.message,
                error=ne.error,
                result_data=enrich_result_data_with_screenshot(
                    execution.id, ne.node_id, ne.result_data
                ),
                started_at=ne.started_at,
                finished_at=ne.finished_at,
                duration_ms=ne.duration_ms,
                created_at=ne.created_at,
            )
            for ne in node_executions
        ],
    )


@router.get("/{execution_id}/nodes/{node_id}/screenshot")
async def get_execution_screenshot(
    execution_id: str,
    node_id: str,
    filename: str,
    user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """获取某次执行中某个节点生成的截图，仅允许访问当前用户自己的截图。"""
    execution = (
        db.query(ExecutionModel)
        .filter(
            ExecutionModel.id == execution_id,
            ExecutionModel.user_id == user.id,
        )
        .first()
    )
    if not execution:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Execution not found"
        )

    node_execution = (
        db.query(NodeExecutionModel)
        .filter(
            NodeExecutionModel.execution_id == execution_id,
            NodeExecutionModel.node_id == node_id,
        )
        .first()
    )
    if not node_execution:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Screenshot not found"
        )

    # 检查是否有截图（支持 screenshot 节点和自动截图）
    has_screenshot = False
    if isinstance(node_execution.result_data, dict):
        has_screenshot = node_execution.result_data.get("has_screenshot", False)
    if not has_screenshot:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="No screenshot for this node"
        )

    expected_path = os.path.join(
        build_screenshot_dir(user.id, execution_id, node_id), filename
    )
    legacy_execution_path = os.path.join(
        build_legacy_screenshot_dir(execution_id, node_id), filename
    )
    fallback_path = os.path.join(SCREENSHOTS_DIR, execution.flow_id, node_id, filename)

    stored_path = None
    if isinstance(node_execution.result_data, dict):
        candidate = node_execution.result_data.get("path")
        if isinstance(candidate, str) and os.path.isfile(candidate):
            stored_path = candidate

    file_path = None
    for candidate in [stored_path, expected_path, legacy_execution_path, fallback_path]:
        if candidate and os.path.isfile(candidate):
            file_path = candidate
            break

    if not file_path:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Screenshot file not found"
        )

    return FileResponse(file_path, media_type="image/png", filename=filename)
