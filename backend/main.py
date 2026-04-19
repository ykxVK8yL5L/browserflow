from typing import List, Dict
import asyncio
import json
from datetime import datetime

# 加载环境变量（必须在其他导入之前）
from dotenv import load_dotenv

load_dotenv()

from fastapi import (
    FastAPI,
    WebSocket,
    WebSocketDisconnect,
    Query,
    Depends,
    Request,
    Response,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from typing import Dict, Optional
from cloakbrowser import launch_persistent_context_async
import uuid
from starlette.middleware.base import BaseHTTPMiddleware

# 数据库和认证
from models.database import get_db, init_db, SessionLocal, DATABASE_URL
from models.db_models import UserModel, SessionModel
from routers.auth import router as auth_router
from routers.passkey import router as passkey_router
from routers.flow import router as flow_router
from routers.credential import router as credential_router
from routers.identity import router as identity_router
from routers.user_agent import router as user_agent_router
from routers.execution import router as execution_router
from routers.websocket import router as websocket_router
from routers.schedule import router as schedule_router
from routers.notification import router as notification_router
from utils.auth_utils import is_otp_setup_deadline_expired
from routers.system import router as system_router
from utils.auth_utils import verify_jwt
from sqlalchemy.orm import Session
from core.scheduler import start_scheduler, shutdown_scheduler

app = FastAPI(
    title="BrowserFlow API",
    docs_url="/docs",
)


# 初始化数据库
@app.on_event("startup")
async def startup():
    init_db()
    start_scheduler()


@app.on_event("shutdown")
async def shutdown():
    shutdown_scheduler()


# ─────────────────────────────────────────────────────────────
# OTP 设置检查中间件
# ─────────────────────────────────────────────────────────────
# 不需要检查 OTP 设置的路径白名单
OTP_CHECK_EXCLUDE_PATHS = {
    "/api/auth/login",
    "/api/auth/register",
    "/api/auth/has-users",
    "/api/auth/settings",
    "/api/auth/otp/setup",
    "/api/auth/otp/confirm",
    "/api/auth/password/change",
    "/api/auth/logout",
    "/api/auth/recovery-codes/confirm-downloaded",
}


class OtpSetupCheckMiddleware(BaseHTTPMiddleware):
    """
    检查用户是否已完成 OTP 设置和恢复码下载。
    如果未完成，返回 403 错误，前端应跳转到 OTP 设置页面。
    """

    async def dispatch(self, request: Request, call_next):
        # 只检查 API 请求
        if not request.url.path.startswith("/api/"):
            return await call_next(request)

        # 跳过白名单路径
        if request.url.path in OTP_CHECK_EXCLUDE_PATHS:
            return await call_next(request)

        # 跳过 OTP 相关路径
        if request.url.path.startswith("/api/auth/otp"):
            return await call_next(request)

        # 获取 Authorization header
        auth_header = request.headers.get("Authorization", "")
        if not auth_header.startswith("Bearer "):
            return await call_next(request)

        token = auth_header[7:]  # 去掉 "Bearer " 前缀
        valid, payload = verify_jwt(token)

        if not valid:
            return await call_next(request)

        user_id = payload.get("sub")
        session_id = payload.get("sid")

        # 检查用户 OTP 设置状态
        db = SessionLocal()
        try:
            user = db.query(UserModel).filter(UserModel.id == user_id).first()
            if user:
                if not user.otp_setup_completed and is_otp_setup_deadline_expired(
                    user.otp_setup_deadline
                ):
                    session = (
                        db.query(SessionModel)
                        .filter(
                            SessionModel.id == session_id,
                            SessionModel.user_id == user_id,
                            SessionModel.active == True,
                        )
                        .first()
                    )
                    if session:
                        session.active = False
                        session.last_active = datetime.utcnow()
                        db.commit()
                    return JSONResponse(
                        status_code=403,
                        content={
                            "detail": "OTP setup expired, password recovery required",
                            "code": "OTP_SETUP_EXPIRED",
                            "otp_setup_completed": False,
                            "recovery_codes_downloaded": False,
                        },
                    )
                # 检查是否需要设置 OTP
                if not user.otp_setup_completed:
                    return JSONResponse(
                        status_code=403,
                        content={
                            "detail": "OTP setup required",
                            "code": "OTP_SETUP_REQUIRED",
                            "otp_setup_completed": False,
                            "recovery_codes_downloaded": False,
                        },
                    )
                # 检查是否需要下载恢复码
                if not user.recovery_codes_downloaded:
                    return JSONResponse(
                        status_code=403,
                        content={
                            "detail": "Recovery codes download required",
                            "code": "RECOVERY_CODES_REQUIRED",
                            "otp_setup_completed": True,
                            "recovery_codes_downloaded": False,
                        },
                    )
        finally:
            db.close()

        return await call_next(request)


# 添加中间件（注意顺序：先添加的最后执行，所以要在 CORS 之前）
app.add_middleware(OtpSetupCheckMiddleware)

# 跨域
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# 注册认证路由
app.include_router(auth_router)
app.include_router(passkey_router)

# 注册 Flow 相关路由
app.include_router(flow_router)
app.include_router(credential_router)
app.include_router(identity_router)
app.include_router(user_agent_router)
app.include_router(execution_router)
app.include_router(websocket_router)
app.include_router(schedule_router)
app.include_router(notification_router)
app.include_router(system_router)

# 1️⃣ 挂载静态资源目录
app.mount("/assets", StaticFiles(directory="public/assets"), name="assets")


@app.get("/")
async def home():
    return FileResponse("public/index.html")


# 2️⃣ SPA fallback：所有其他路径返回 index.html
@app.get("/{full_path:path}")
async def serve_spa(full_path: str):
    return FileResponse("public/index.html")


# ---------------- WebSocket 管理 ----------------
class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[str, WebSocket] = {}

    async def connect(self, websocket: WebSocket, client_id: str):
        await websocket.accept()
        self.active_connections[client_id] = websocket

    def disconnect(self, client_id: str):
        self.active_connections.pop(client_id, None)

    async def send(self, client_id: str, message: dict):
        websocket = self.active_connections.get(client_id)
        if websocket:
            await websocket.send_json(message)


manager = ConnectionManager()


# ---------------- WebSocket 鉴权 ----------------
async def verify_websocket_auth(token: Optional[str], db: Session) -> Optional[str]:
    """验证 WebSocket 连接的 JWT token，返回 user_id 或 None"""
    if not token:
        return None

    valid, payload = verify_jwt(token)
    if not valid:
        return None

    user_id = payload.get("sub")
    session_id = payload.get("sid")

    # 验证 session 是否有效
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

    return user_id


# ---------------- Flow 执行逻辑 ----------------
async def execute_node(node_data: dict, page, client_id: str):
    node_type = node_data.get("nodeType")
    node_id = node_data.get("id") or str(uuid.uuid4())

    result = {
        "nodeId": node_id,
        "status": "running",
        "startedAt": datetime.utcnow().isoformat(),
        "finishedAt": None,
        "duration": None,
        "message": "",
        "error": "",
    }

    # 节点开始
    await manager.send(client_id, {"type": "nodeStart", "result": result})

    start_ts = datetime.utcnow()

    try:
        if node_type == "navigate":
            print("Executing navigate node")
            url = node_data.get("url")
            response = await page.goto(url)
            print(response.status)
            await page.wait_for_load_state("networkidle")
            content = await page.content()

        elif node_type == "click":
            print("Executing click node")
            selector = node_data.get("selector")
            await page.click(selector)

        elif node_type == "type":
            selector = node_data.get("selector")
            text = node_data.get("text", "")
            await page.fill(selector, text)

        elif node_type == "screenshot":
            path = node_data.get("path", f"screenshot-{node_id}.png")
            await page.screenshot(path=path)
            result["screenshot"] = path

        else:
            # 未知操作，跳过
            result["status"] = "skipped"
            result["message"] = f"Unknown nodeType: {node_type}"
            return result

        # 成功
        result["status"] = "success"
        result["message"] = f"{node_type} completed"

    except Exception as e:
        result["status"] = "failed"
        result["message"] = f"{node_type} failed"
        result["error"] = str(e)

    end_ts = datetime.utcnow()
    result["finishedAt"] = end_ts.isoformat()
    result["duration"] = (end_ts - start_ts).total_seconds() * 1000

    # 节点完成
    await manager.send(client_id, {"type": "nodeComplete", "result": result})

    return result


async def execute_flow(flow_json: dict, client_id: str):
    nodes = flow_json.get("nodes", [])
    edges = flow_json.get("edges", [])

    # 拓扑排序（简单串行）
    node_map = {n["id"]: n for n in nodes}
    indegree = {n["id"]: 0 for n in nodes}
    adj: Dict[str, list] = {n["id"]: [] for n in nodes}

    for e in edges:
        adj[e["source"]].append(e["target"])
        indegree[e["target"]] += 1

    queue = [nid for nid, deg in indegree.items() if deg == 0]
    sorted_nodes = []

    while queue:
        nid = queue.pop(0)
        sorted_nodes.append(node_map[nid])
        for nxt in adj[nid]:
            indegree[nxt] -= 1
            if indegree[nxt] == 0:
                queue.append(nxt)

    ctx = await launch_persistent_context_async(
        user_data_dir="./my-profile",
        headless=True,
        locale="en-US",
        viewport={"width": 1920, "height": 1080},
    )
    page = await ctx.new_page()

    for node in sorted_nodes:
        node_data = node.get("data", {})
        node_data["id"] = node.get("id")

        disabled = node_data.get("disabled", False)
        if disabled:
            result = {
                "nodeId": node_data["id"],
                "status": "skipped",
                "message": "Node is disabled",
                "startedAt": datetime.utcnow().isoformat(),
                "finishedAt": datetime.utcnow().isoformat(),
                "duration": 0,
            }
            await manager.send(client_id, {"type": "nodeComplete", "result": result})
            continue

        result = await execute_node(node_data, page, client_id)

        if result["status"] == "failed":
            await manager.send(client_id, {"type": "flowComplete", "status": "failed"})
            await ctx.close()
            return

    await manager.send(client_id, {"type": "flowComplete", "status": "completed"})
    await ctx.close()


# ---------------- WebSocket 端点已移至 routers/websocket.py ----------------
