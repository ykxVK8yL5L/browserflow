"""WebSocket 路由

处理 WebSocket 连接，用于实时通信。
"""

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query, Depends
from typing import Optional
import json
import asyncio
import uuid
from models.database import SessionLocal
from models.db_models import (
    UserModel,
    SessionModel,
    ExecutionModel,
    FlowModel,
    IdentityModel,
)
from utils.auth_utils import verify_jwt
from core.websocket_manager import ws_manager
from core.identity_lock import get_all_locked_identities
from core.executor import run_execution, resolve_flow_credentials
from core.queue import ExecutionQueueItem, ExecutionStatus
from datetime import datetime
from routers.execution import build_flow_snapshot
from routers.auth import get_current_user

router = APIRouter(tags=["websocket"])
WS_TICKET_TTL_SECONDS = 30
_ws_tickets: dict[str, dict[str, object]] = {}


def _cleanup_expired_ws_tickets() -> None:
    now = datetime.utcnow().timestamp()
    expired_keys = [
        ticket
        for ticket, payload in _ws_tickets.items()
        if float(payload["expires_at"]) <= now or bool(payload.get("used", False))
    ]
    for ticket in expired_keys:
        _ws_tickets.pop(ticket, None)


def create_ws_ticket(user_id: str) -> str:
    _cleanup_expired_ws_tickets()
    ticket = uuid.uuid4().hex
    _ws_tickets[ticket] = {
        "user_id": user_id,
        "expires_at": datetime.utcnow().timestamp() + WS_TICKET_TTL_SECONDS,
        "used": False,
    }
    return ticket


def resolve_execution_identity_id(
    db, user_id: str, flow_id: Optional[str], data: dict
) -> Optional[str]:
    """优先从请求中读取 identity_id，否则回退到 Flow 绑定的 identity_id。"""
    options = data.get("options") or {}
    identity_id = data.get("identityId") or options.get("identityId")

    if identity_id:
        identity = (
            db.query(IdentityModel)
            .filter(IdentityModel.id == identity_id, IdentityModel.user_id == user_id)
            .first()
        )
        if identity:
            return identity_id
        return None

    if not flow_id or flow_id == "websocket-flow":
        return None

    flow = (
        db.query(FlowModel)
        .filter(FlowModel.id == flow_id, FlowModel.user_id == user_id)
        .first()
    )
    if not flow:
        return None
    return flow.identity_id


# ============== 辅助函数 ==============


async def execute_websocket_flow(
    execution_id: str,
    flow_id: str,
    item: ExecutionQueueItem,
):
    """WebSocket 执行 Flow 的后台任务，更新数据库状态"""
    from models.database import SessionLocal

    db = SessionLocal()
    try:
        # 获取 execution 记录
        execution = (
            db.query(ExecutionModel).filter(ExecutionModel.id == execution_id).first()
        )
        if not execution:
            return

        # 更新状态为运行中
        execution.status = "running"
        execution.started_at = datetime.utcnow()
        db.commit()

        # 执行
        result = await run_execution(item)

        # 更新 execution 记录
        execution.status = result.get("status", "completed")
        execution.result = result
        execution.finished_at = datetime.utcnow()
        if result.get("error"):
            execution.error_message = result["error"]
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


async def verify_websocket_auth(token: Optional[str]) -> Optional[str]:
    """
    验证 WebSocket 连接的 JWT token

    Args:
        token: JWT token

    Returns:
        user_id 或 None
    """
    if not token:
        return None

    valid, payload = verify_jwt(token)
    if not valid:
        return None

    user_id = payload.get("sub")
    session_id = payload.get("sid")

    # 验证 session 是否有效
    db = SessionLocal()
    try:
        session = (
            db.query(SessionModel)
            .filter(
                SessionModel.id == session_id,
                SessionModel.user_id == user_id,
                SessionModel.active == True,
            )
            .first()
        )
        if not session:
            return None

        # 检查用户 OTP 设置状态
        user = db.query(UserModel).filter(UserModel.id == user_id).first()
        if user and (
            not user.otp_setup_completed or not user.recovery_codes_downloaded
        ):
            return None

        return user_id
    finally:
        db.close()


# Removed redundant endpoint


async def verify_websocket_ticket(ticket: Optional[str]) -> Optional[str]:
    if not ticket:
        return None

    _cleanup_expired_ws_tickets()
    payload = _ws_tickets.get(ticket)
    if not payload:
        return None

    if float(payload["expires_at"]) <= datetime.utcnow().timestamp():
        _ws_tickets.pop(ticket, None)
        return None

    if bool(payload.get("used", False)):
        _ws_tickets.pop(ticket, None)
        return None

    payload["used"] = True
    user_id = str(payload["user_id"])
    _ws_tickets.pop(ticket, None)
    return user_id


@router.post("/api/ws-ticket")
async def issue_ws_ticket(current_user=Depends(get_current_user)):
    return {
        "ticket": create_ws_ticket(current_user.id),
        "expiresIn": WS_TICKET_TTL_SECONDS,
    }


@router.websocket("/ws/flow/{client_id}")
async def websocket_flow_endpoint(
    websocket: WebSocket,
    client_id: str,
    ticket: Optional[str] = Query(default=None),
):
    """
    Flow 执行 WebSocket 端点

    连接时需要提供有效的 JWT token:
    ws://localhost:8000/ws/flow/{client_id}?token=xxx

    客户端发送流程数据后，服务端执行并推送状态更新。
    """
    # 验证认证
    user_id = await verify_websocket_ticket(ticket)
    if not user_id:
        await websocket.accept()
        await websocket.close(code=4001, reason="Unauthorized")
        return

    # 连接
    await ws_manager.connect(websocket, client_id, user_id)
    try:
        # 发送连接成功消息
        await ws_manager.send(
            client_id,
            {
                "type": "connected",
                "data": {
                    "clientId": client_id,
                    "userId": user_id,
                },
            },
        )

        # 保持连接，接收流程数据并执行
        while True:
            try:
                message = await websocket.receive_text()
                data = json.loads(message)

                # 检查是否是执行请求
                if data.get("type") == "execute" or (
                    "nodes" in data and "edges" in data
                ):
                    original_data = data
                    resolved_data = resolve_flow_credentials(data, user_id)

                    # 从 nodes 中获取 flowId（每个 node 都有 flowId 字段）
                    flow_id = None
                    for node in resolved_data.get("nodes", []):
                        node_data = node.get("data", {})
                        if node_data.get("flowId"):
                            flow_id = node_data.get("flowId")
                            break

                    if not flow_id:
                        flow_id = "websocket-flow"

                    # 创建 Execution 记录
                    execution_id = str(uuid.uuid4())
                    db = SessionLocal()
                    try:
                        identity_id = resolve_execution_identity_id(
                            db, user_id, flow_id, resolved_data
                        )

                        execution = ExecutionModel(
                            id=execution_id,
                            user_id=user_id,
                            flow_id=flow_id,
                            identity_id=identity_id,
                            status="running",
                            started_at=datetime.utcnow(),
                            flow_snapshot=build_flow_snapshot(original_data),
                        )
                        db.add(execution)
                        db.commit()
                    except Exception as e:
                        print(f"Failed to create execution record: {e}")
                        db.rollback()
                    finally:
                        db.close()

                    # 创建执行项
                    item = ExecutionQueueItem(
                        execution_id=execution_id,
                        user_id=user_id,
                        flow_id=flow_id,
                        identity_id=identity_id,
                        flow_data=resolved_data,
                        client_id=client_id,
                        status=ExecutionStatus.RUNNING,
                        started_at=datetime.utcnow(),
                        user_agent_id=resolved_data.get("options", {}).get(
                            "userAgentId"
                        ),
                        headless=resolved_data.get("options", {}).get("headless"),
                        viewport=resolved_data.get("options", {}).get("viewport"),
                        locale=resolved_data.get("options", {}).get("locale", "en-US"),
                        timezone=resolved_data.get("options", {}).get(
                            "timezone", "America/New_York"
                        ),
                        proxy=resolved_data.get("options", {}).get("proxy", ""),
                        humanize=resolved_data.get("options", {}).get("humanize", True),
                        device=resolved_data.get("options", {}).get("device"),
                    )
                    # 在后台执行流程，并等待完成以更新数据库
                    asyncio.create_task(
                        execute_websocket_flow(
                            execution_id=execution_id,
                            flow_id=flow_id,
                            item=item,
                        )
                    )
                else:
                    # 其他消息类型，忽略或处理心跳
                    if data.get("type") == "ping":
                        await ws_manager.send(
                            client_id,
                            {
                                "type": "pong",
                                "data": {"timestamp": data.get("timestamp")},
                            },
                        )
            except json.JSONDecodeError:
                await ws_manager.send(
                    client_id,
                    {"type": "error", "data": {"message": "Invalid JSON format"}},
                )
            except Exception as e:
                print(f"WebSocket error: {e}")
                break
    except WebSocketDisconnect:
        pass
    finally:
        # 断开连接
        ws_manager.disconnect(client_id, user_id)
