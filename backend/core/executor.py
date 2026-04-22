"""执行器和沙箱

负责实际执行 Flow 的核心逻辑。
"""

import asyncio
from typing import Dict, Any, Optional, List, Tuple
from datetime import datetime
from dataclasses import dataclass, field
import json
import os
import traceback
import base64
import random
import copy
import re
from .queue import ExecutionQueueItem, ExecutionStatus
from .identity_lock import acquire_identity, release_identity
from .websocket_manager import ws_manager
from .notifications import dispatch_flow_notifications
from .screenshot_storage import SCREENSHOTS_DIR, build_screenshot_dir
from models.database import SessionLocal
from models.db_models import (
    NodeExecutionModel,
    IdentityModel,
    UserAgentModel,
    ExecutionModel,
    CredentialModel,
)
from utils.auth_utils import decrypt_data
from .node_handlers import (
    NODE_HANDLERS,
    NodeHandler,
    evaluate_condition_config,
    get_variable_store,
    normalize_node,
)

# 截图更新间隔（秒）
SCREENSHOT_INTERVAL = 0.5
CREDENTIAL_TEMPLATE_PATTERN = re.compile(r"\{\{credential:([^}]+)\}\}")

# 统一的数据目录
BACKEND_DIR = os.path.dirname(os.path.dirname(__file__))
DATA_DIR = os.path.join(BACKEND_DIR, "data")
PROFILES_DIR = os.path.join(DATA_DIR, "profiles", "default")  # 统一使用 default 目录


# 导入 CloakBrowser（如果可用）
try:
    from cloakbrowser import launch_persistent_context_async, launch_async

    CLOAKBROWSER_AVAILABLE = True
except ImportError:
    CLOAKBROWSER_AVAILABLE = False

# 导入设备配置
from utils.device_profiles import device_profiles


@dataclass
class ExecutionContext:
    """运行时执行上下文

    保存不可序列化的运行时对象（如 Playwright Locator）和序列化输出。
    """

    sandbox: Any  # ExecutionSandbox
    item: Any  # ExecutionQueueItem
    page: Any
    pages: Dict[str, Any]
    values: Dict[str, Any] = field(
        default_factory=dict
    )  # node_id -> runtime_value (e.g. Locator)
    outputs: Dict[str, Any] = field(
        default_factory=dict
    )  # node_id -> serialized_output
    locals: Dict[str, Any] = field(
        default_factory=dict
    )  # local variables (e.g. foreach.item)


@dataclass
class NodeResult:
    """节点执行结果"""

    node_id: str
    node_type: str
    status: str  # running, success, failed, skipped
    started_at: datetime = field(default_factory=datetime.utcnow)
    finished_at: Optional[datetime] = None
    duration_ms: Optional[float] = None
    message: str = ""
    error: Optional[str] = None
    data: Optional[Dict[str, Any]] = None


def get_node_runtime_data(node_data: dict) -> Tuple[str, str, dict]:
    """标准化节点运行时数据，兼容现有前后端结构。"""
    normalized = normalize_node(node_data)
    data = normalized["data"]
    node_type = normalized["type"]
    node_id = normalized["id"]
    return node_id, node_type, data


def build_node_result_payload(result: NodeResult) -> Dict[str, Any]:
    """统一构建 WebSocket 节点结果载荷。"""
    return {
        "nodeId": result.node_id,
        "nodeType": result.node_type,
        "status": result.status,
        "startedAt": result.started_at.isoformat(),
        "finishedAt": result.finished_at.isoformat() if result.finished_at else None,
        "durationMs": result.duration_ms,
        "message": result.message,
        "error": result.error,
        "data": result.data,
    }


def finalize_result(result: NodeResult) -> None:
    """统一补齐结束时间和耗时。"""
    result.finished_at = datetime.utcnow()
    result.duration_ms = (result.finished_at - result.started_at).total_seconds() * 1000


def parse_wait_duration_ms(value: Any) -> int:
    """解析节点配置中的等待时长，非法值按 0 处理。"""
    try:
        if value is None or value == "":
            return 0
        return max(0, int(float(value)))
    except (TypeError, ValueError):
        return 0


def _load_user_credential_values(user_id: str) -> Dict[str, str]:
    """加载用户凭证并转换为模板可替换的字符串值。"""
    db = SessionLocal()
    try:
        credentials = (
            db.query(CredentialModel)
            .filter(
                CredentialModel.user_id == user_id, CredentialModel.is_valid == True
            )
            .all()
        )

        resolved: Dict[str, str] = {}
        for credential in credentials:
            try:
                raw_json = decrypt_data(credential.credential_data, user_id)
                data = json.loads(raw_json)
            except Exception as exc:
                print(
                    f"[Credential] Failed to decrypt credential {credential.id}: {exc}"
                )
                continue

            value = None
            if isinstance(data, dict):
                value = data.get("value") or data.get("password") or data.get("token")
                if value is None:
                    value = json.dumps(data, ensure_ascii=False)

            if value is not None:
                resolved[str(credential.name)] = str(value)

        return resolved
    finally:
        db.close()


def _resolve_credential_templates(value: Any, credential_values: Dict[str, str]) -> Any:
    """递归解析 `{{credential:name}}` 占位符。"""
    if isinstance(value, str):
        return CREDENTIAL_TEMPLATE_PATTERN.sub(
            lambda match: credential_values.get(match.group(1), match.group(0)),
            value,
        )

    if isinstance(value, dict):
        return {
            key: _resolve_credential_templates(item, credential_values)
            for key, item in value.items()
        }

    if isinstance(value, list):
        return [
            _resolve_credential_templates(item, credential_values) for item in value
        ]

    return value


def resolve_flow_credentials(flow_data: Dict[str, Any], user_id: str) -> Dict[str, Any]:
    """在后端执行前统一解析流程中的 credential 模板。"""
    if not isinstance(flow_data, dict):
        return flow_data

    credential_values = _load_user_credential_values(user_id)
    if not credential_values:
        return flow_data

    return _resolve_credential_templates(copy.deepcopy(flow_data), credential_values)


async def send_node_event(
    client_id: str,
    execution_id: str,
    event_type: str,
    result: NodeResult,
) -> None:
    """统一发送节点事件。"""
    await ws_manager.send(
        client_id,
        {
            "type": event_type,
            "executionId": execution_id,
            "result": build_node_result_payload(result),
        },
    )


def create_node_execution_record(
    execution_id: str,
    data: dict,
    node_type: str,
    node_id: str,
    result: NodeResult,
) -> Optional[str]:
    """创建节点执行记录，返回记录 ID。"""
    db = SessionLocal()
    try:
        node_execution = NodeExecutionModel(
            execution_id=execution_id,
            node_label=data.get("label", node_type),
            node_id=node_id,
            node_type=node_type,
            status=result.status,
            started_at=result.started_at,
            finished_at=result.finished_at,
            duration_ms=int(result.duration_ms) if result.duration_ms else None,
            message=result.message,
        )
        db.add(node_execution)
        db.commit()
        db.refresh(node_execution)
        return node_execution.id
    except Exception as e:
        print(f"Failed to create node execution record: {e}")
        db.rollback()
        return None
    finally:
        db.close()


def update_node_execution_record(record_id: Optional[str], result: NodeResult) -> None:
    """更新节点执行记录。"""
    if not record_id:
        return

    db = SessionLocal()
    try:
        node_exec = (
            db.query(NodeExecutionModel)
            .filter(NodeExecutionModel.id == record_id)
            .first()
        )
        if node_exec:
            node_exec.status = result.status
            node_exec.message = result.message
            node_exec.error = result.error
            node_exec.result_data = result.data
            node_exec.finished_at = result.finished_at
            node_exec.duration_ms = (
                int(result.duration_ms) if result.duration_ms else None
            )
            db.commit()
    except Exception as e:
        print(f"Failed to update node execution record: {e}")
        db.rollback()
    finally:
        db.close()


class ExecutionSandbox:
    """执行沙箱

    为每次执行创建独立的浏览器环境。
    """

    def __init__(
        self, item: ExecutionQueueItem, identity: Optional[IdentityModel] = None
    ):
        self.item = item
        self.identity = identity
        self.browser = None
        self.context = None
        self._playwright = None

        # 运行时上下文
        self.runtime_ctx = None  # Will be initialized in start()

    async def emit_log(
        self,
        level: str,
        message: str,
        *,
        node_id: Optional[str] = None,
        node_name: Optional[str] = None,
    ) -> None:
        """发送运行时日志到前端。"""
        await ws_manager.send(
            self.item.client_id,
            {
                "type": "log",
                "executionId": self.item.execution_id,
                "data": {
                    "timestamp": datetime.utcnow().isoformat(),
                    "nodeId": node_id,
                    "nodeName": node_name,
                    "level": level,
                    "message": message,
                },
            },
        )

    def attach_page_log_listeners(self, page: Any) -> None:
        """为页面挂载浏览器侧日志监听。"""

        def safe_create_task(coro):
            try:
                asyncio.create_task(coro)
            except RuntimeError:
                pass

        page.on(
            "console",
            lambda msg: safe_create_task(
                self.emit_log(
                    (
                        "error"
                        if msg.type == "error"
                        else "warn" if msg.type == "warning" else "info"
                    ),
                    f"[browser:{msg.type}] {msg.text}",
                )
            ),
        )
        page.on(
            "pageerror",
            lambda err: safe_create_task(self.emit_log("error", f"[pageerror] {err}")),
        )
        page.on(
            "requestfailed",
            lambda request: safe_create_task(
                self.emit_log(
                    "warn",
                    f"[requestfailed] {request.method} {request.url}",
                )
            ),
        )

    async def start(self) -> None:
        """启动浏览器"""
        # 1. 解析 Headless 设置
        # 优先级: 运行时请求 > Identity 配置 > 默认 True
        headless = True
        if self.item.headless is not None:
            headless = self.item.headless

        # 2. 解析 User-Agent 设置
        # 优先级: 运行时请求 (Random/Specific/Device) > 默认 User-Agent > Identity 配置 > 默认空
        # "device" 表示使用设备配置的 userAgent，此时不查询数据库
        user_agent = ""
        db = SessionLocal()
        try:
            if self.item.user_agent_id and self.item.user_agent_id != "device":
                if self.item.user_agent_id == "random":
                    # 随机选择一个
                    uas = (
                        db.query(UserAgentModel)
                        .filter(UserAgentModel.user_id == self.item.user_id)
                        .all()
                    )
                    if uas:
                        user_agent = random.choice(uas).value
                else:
                    # 指定 ID
                    ua = (
                        db.query(UserAgentModel)
                        .filter(
                            UserAgentModel.id == self.item.user_agent_id,
                            UserAgentModel.user_id == self.item.user_id,
                        )
                        .first()
                    )
                    if ua:
                        user_agent = ua.value
            elif self.item.user_agent_id != "device":
                # 尝试获取默认 User-Agent
                default_ua = (
                    db.query(UserAgentModel)
                    .filter(
                        UserAgentModel.user_id == self.item.user_id,
                        UserAgentModel.is_default == True,
                    )
                    .first()
                )
                if default_ua:
                    user_agent = default_ua.value

        finally:
            db.close()

        # 处理设备配置：如果指定了 device，则从 device_profiles 中获取配置
        device_config = None
        if self.item.device and self.item.device in device_profiles:
            device_config = device_profiles[self.item.device]

        # 设置 viewport：手动设置优先（width > 0 表示有效），否则使用设备配置（如果有），最后使用默认值
        # 前端传递 {width: 0, height: 0} 表示使用设备配置
        if self.item.viewport and self.item.viewport.get("width", 0) > 0:
            viewport = self.item.viewport
        elif device_config and device_config.get("viewport"):
            viewport = device_config["viewport"]
        else:
            viewport = {"width": 1920, "height": 1080}

        # 设置 locale：手动设置优先，否则使用默认值
        # 注意：device_config 中没有 locale 字段
        if self.item.locale:
            locale = self.item.locale
        else:
            locale = "en-US"

        # 设置 user_agent：手动设置优先，否则使用设备配置（如果有）
        # 注意：如果 user_agent_id == "device"，此时 user_agent 为空，会使用设备配置
        if not user_agent and device_config and device_config.get("userAgent"):
            user_agent = device_config["userAgent"]

        timezone = (self.item.timezone or "America/New_York").strip()
        proxy = (self.item.proxy or "").strip()
        humanize = True if self.item.humanize is None else bool(self.item.humanize)

        if CLOAKBROWSER_AVAILABLE:
            # 使用 CloakBrowser
            if self.identity and self.identity.type == "profile":
                # Profile 模式：使用持久化上下文
                kwargs = {
                    "headless": headless,
                    "user_data_dir": self.identity.storage_path,
                }
                if user_agent:
                    kwargs["user_agent"] = user_agent
                if locale:
                    kwargs["locale"] = locale
                if timezone:
                    kwargs["timezone"] = timezone
                if viewport:
                    kwargs["viewport"] = viewport
                if proxy:
                    kwargs["proxy"] = proxy
                kwargs["humanize"] = humanize

                if device_config:
                    # deviceScaleFactor -> device_scale_factor
                    if "deviceScaleFactor" in device_config:
                        kwargs["device_scale_factor"] = device_config[
                            "deviceScaleFactor"
                        ]
                    # isMobile -> is_mobile
                    if "isMobile" in device_config:
                        kwargs["is_mobile"] = device_config["isMobile"]
                    # screen
                    if "screen" in device_config:
                        kwargs["screen"] = device_config["screen"]
                    # hasTouch -> has_touch
                    if "hasTouch" in device_config:
                        kwargs["has_touch"] = device_config["hasTouch"]
                    # 注意：defaultBrowserType 不需要，因为 CloakBrowser 只用 chromium

                self.context = await launch_persistent_context_async(**kwargs)
            else:
                # None 或 File 模式：使用普通上下文
                kwargs = {
                    "headless": headless,
                }

                if locale:
                    kwargs["locale"] = locale
                if timezone:
                    kwargs["timezone"] = timezone
                if proxy:
                    kwargs["proxy"] = proxy
                kwargs["humanize"] = humanize

                # 构建上下文参数，从 device_config 中提取驼峰命名字段并转换为下划线命名
                context_kwargs = {}
                if device_config:
                    # deviceScaleFactor -> device_scale_factor
                    if "deviceScaleFactor" in device_config:
                        context_kwargs["device_scale_factor"] = device_config[
                            "deviceScaleFactor"
                        ]
                    # screen
                    if "screen" in device_config:
                        context_kwargs["screen"] = device_config["screen"]
                    # isMobile -> is_mobile
                    if "isMobile" in device_config:
                        context_kwargs["is_mobile"] = device_config["isMobile"]
                    # hasTouch -> has_touch
                    if "hasTouch" in device_config:
                        context_kwargs["has_touch"] = device_config["hasTouch"]
                    # 注意：defaultBrowserType 不需要，因为 CloakBrowser 只用 chromium
                if (
                    self.identity
                    and self.identity.type == "file"
                    and self.identity.storage_path
                ):
                    state_path = os.path.join(self.identity.storage_path, "state.json")
                    # Ensure the directory exists and create an empty storage state file if missing.
                    if not os.path.exists(state_path):
                        # Create the parent directory if it does not exist.
                        os.makedirs(os.path.dirname(state_path), exist_ok=True)
                        # Use pathlib to reliably create an empty JSON file.
                        try:
                            from pathlib import Path

                            Path(state_path).write_text("{}", encoding="utf-8")
                        except Exception:
                            # Fallback to traditional file write in case of unexpected errors.
                            with open(state_path, "w", encoding="utf-8") as f:
                                f.write("{}")
                    context_kwargs["storage_state"] = state_path
                if user_agent:
                    context_kwargs["user_agent"] = user_agent

                if viewport:
                    context_kwargs["viewport"] = viewport

                self.browser = await launch_async(**kwargs)
                self.context = await self.browser.new_context(**context_kwargs)

            page = await self.context.new_page()
        else:
            # 导入 Playwright（当 CloakBrowser 不可用时使用）
            try:
                from playwright.async_api import async_playwright
            except ImportError:
                async_playwright = None

            # 使用标准 Playwright
            self._playwright = await async_playwright().start()

            if self.identity and self.identity.type == "profile":
                # Profile 模式：启动持久化上下文
                self.context = (
                    await self._playwright.chromium.launch_persistent_context(
                        user_data_dir=self.identity.storage_path,
                        headless=headless,
                        userAgent=user_agent or None,
                        locale=locale or None,
                        timezone_id=timezone or None,
                        viewport=viewport,
                    )
                )
                page = await self.context.new_page()
            else:
                # None 或 File 模式：启动浏览器 -> 创建上下文
                launch_options = {"headless": headless}
                if proxy:
                    launch_options["proxy"] = {"server": proxy}
                self.browser = await self._playwright.chromium.launch(**launch_options)

                context_options = {
                    "locale": locale,
                    "timezone_id": timezone or None,
                    "viewport": viewport,
                }
                if user_agent:
                    context_options["userAgent"] = user_agent
                if (
                    self.identity
                    and self.identity.type == "file"
                    and self.identity.storage_path
                ):
                    # Ensure the storage state file exists. If it does not, create an empty JSON file.
                    state_path = os.path.join(self.identity.storage_path, "state.json")
                    # Ensure the directory exists and create an empty storage state file if missing.
                    if not os.path.exists(state_path):
                        # Create the parent directory if it does not exist.
                        os.makedirs(os.path.dirname(state_path), exist_ok=True)
                        # Use pathlib to reliably create an empty JSON file.
                        try:
                            from pathlib import Path

                            Path(state_path).write_text("{}", encoding="utf-8")
                        except Exception:
                            # Fallback to traditional file write in case of unexpected errors.
                            with open(state_path, "w", encoding="utf-8") as f:
                                f.write("{}")
                    # At this point the file exists, set it for the browser context
                    context_options["storage_state"] = state_path

                self.context = await self.browser.new_context(**context_options)
                page = await self.context.new_page()

            self.attach_page_log_listeners(page)

        pages = {"main": page}

        # 初始化运行时上下文
        self.runtime_ctx = ExecutionContext(
            sandbox=self,
            item=self.item,
            page=page,
            pages=pages,
            values={},
            outputs={},
            locals={},
        )
        get_variable_store(self.runtime_ctx.outputs)
        self.current_page = "main"

    async def close(self) -> None:
        """关闭浏览器"""
        if self.context:
            try:
                if (
                    self.identity
                    and self.identity.type == "file"
                    and self.identity.storage_path
                ):
                    state_path = os.path.join(self.identity.storage_path, "state.json")
                    try:
                        await self.context.storage_state(path=state_path)
                    except Exception as e:
                        print(f"Execution error: {e}")
            finally:
                try:
                    await self.context.close()
                except Exception as e:
                    print(f"Failed to close browser context: {e}")
                finally:
                    self.context = None

        if self.browser:
            try:
                await self.browser.close()
            except Exception as e:
                print(f"Failed to close browser: {e}")
            finally:
                self.browser = None

        if self._playwright:
            try:
                await self._playwright.stop()
            except Exception as e:
                print(f"Failed to stop playwright: {e}")
            finally:
                self._playwright = None

    def get_current_page(self) -> Any:
        """获取当前页面"""
        if not self.runtime_ctx:
            return None
        return self.runtime_ctx.pages.get(self.current_page)

    async def create_page(self, name: str) -> Any:
        """创建新页面"""
        page = await self.context.new_page()
        self.attach_page_log_listeners(page)
        self.runtime_ctx.pages[name] = page
        return page

    async def switch_page(self, name: str) -> bool:
        """切换到指定页面"""
        if self.runtime_ctx and name in self.runtime_ctx.pages:
            self.current_page = name
            self.runtime_ctx.page = self.runtime_ctx.pages[name]
            return True
        return False

    async def close_page(self, name: str) -> bool:
        """关闭指定页面"""
        if self.runtime_ctx and name in self.runtime_ctx.pages and name != "main":
            page = self.runtime_ctx.pages.pop(name)
            await page.close()
            if self.current_page == name:
                self.current_page = "main"
                self.runtime_ctx.page = self.runtime_ctx.pages["main"]
            return True
        return False

    async def save_storage_state(self, path: str) -> None:
        """保存 storage state"""
        await self.context.storage_state(path=path)


def get_identity_state_path(identity: Optional[IdentityModel]) -> Optional[str]:
    """获取 file 类型 identity 的 state.json 路径。"""
    if not identity or identity.type != "file" or not identity.storage_path:
        return None
    return os.path.join(identity.storage_path, "state.json")


async def execute_node(
    sandbox: ExecutionSandbox,
    node_data: dict,
    client_id: str,
    predecessor_output: Any = None,
    extra_outputs: Optional[Dict[str, Any]] = None,
) -> NodeResult:
    """
    执行单个节点

    Args:
        sandbox: 执行沙箱
        node_data: 节点数据
        client_id: WebSocket 客户端 ID
        predecessor_output: 前驱节点的输出结果
    Returns:
        节点执行结果
    """
    effective_outputs = sandbox.runtime_ctx.outputs if sandbox.runtime_ctx else {}
    if extra_outputs:
        # 确保 __vars__ 存在于 sandbox.runtime_ctx.outputs 中
        variable_store = effective_outputs.get("__vars__")
        if variable_store is None:
            variable_store = {}
            sandbox.runtime_ctx.outputs["__vars__"] = variable_store
        # 合并 extra_outputs，但保留对 __vars__ 的引用
        effective_outputs = {**effective_outputs, **extra_outputs}
        effective_outputs["__vars__"] = variable_store

    normalized_node = normalize_node(node_data, effective_outputs)
    node_id = normalized_node["id"]
    node_type = normalized_node["type"]
    data = normalized_node["data"]
    wait_before_ms = parse_wait_duration_ms(data.get("waitBeforeMs"))
    wait_after_ms = parse_wait_duration_ms(data.get("waitAfterMs"))
    screenshot_timing = str(data.get("screenshotTiming") or "after").lower()
    result = NodeResult(node_id=node_id, node_type=node_type, status="running")
    result.data = {}  # 确保 data 始终是一个字典，避免 .get() 崩溃

    def mark_as_stopped(message: str = "Execution cancelled") -> NodeResult:
        result.status = "skipped"
        result.message = message
        result.data = {**(result.data or {}), "cancelled": True}
        finalize_result(result)
        update_node_execution_record(node_execution_id, result)
        return result

    async def capture_node_screenshot() -> Optional[Dict[str, Any]]:
        if not data.get("captureScreenshot"):
            return None
        if node_type == "screenshot":
            return None
        current_page = sandbox.get_current_page()
        if current_page is None:
            return None

        execution_id = sandbox.item.execution_id
        screenshot_dir = build_screenshot_dir(
            sandbox.item.user_id, execution_id, node_id
        )
        os.makedirs(screenshot_dir, exist_ok=True)

        filename = f"{node_id}-auto.png"
        path = os.path.join(screenshot_dir, filename)
        await current_page.screenshot(path=path)

        return {
            "path": path,
            "filename": filename,
            "execution_id": execution_id,
            "node_id": node_id,
            "has_screenshot": True,
        }

    # 跳过禁用节点
    if data.get("disabled"):
        result.status = "skipped"
        result.message = "Node is disabled"
        result.data = {**(result.data or {}), "disabled": True}
        finalize_result(result)
        create_node_execution_record(
            sandbox.item.execution_id, data, node_type, node_id, result
        )
        await send_node_event(
            client_id, sandbox.item.execution_id, "nodeComplete", result
        )
        return result

    # 创建节点执行记录（开始时）
    node_execution_id = create_node_execution_record(
        sandbox.item.execution_id, data, node_type, node_id, result
    )

    if _is_execution_cancelled(sandbox.item.execution_id):
        stopped_result = mark_as_stopped("Execution cancelled before node start")
        await send_node_event(
            client_id, sandbox.item.execution_id, "nodeComplete", stopped_result
        )
        return stopped_result

    # 发送节点开始事件
    await send_node_event(client_id, sandbox.item.execution_id, "nodeStart", result)

    page = sandbox.get_current_page()
    if page is None:
        # 如果没有可用页面，直接标记为失败
        result.status = "failed"
        result.error = "No active browser page found"
        result.message = "执行失败: 未找到活动浏览器页面"
        return result

    try:
        if wait_before_ms > 0:
            await asyncio.sleep(wait_before_ms / 1000)

        if _is_execution_cancelled(sandbox.item.execution_id):
            stopped_result = mark_as_stopped("Execution cancelled before node handler")
            await send_node_event(
                client_id, sandbox.item.execution_id, "nodeComplete", stopped_result
            )
            return stopped_result

        if screenshot_timing == "before":
            screenshot_data = await capture_node_screenshot()
            if screenshot_data:
                result.data = {**(result.data or {}), **screenshot_data}

        handler = NODE_HANDLERS.get(node_type)
        if handler:
            await handler(
                sandbox.runtime_ctx,
                data,
                normalized_node,
                result,
                predecessor_output,
            )
        else:
            result.status = "skipped"
            result.message = f"Unknown node type: {node_type}"

        if result.status == "running":
            result.status = "success"

        if _is_execution_cancelled(sandbox.item.execution_id):
            stopped_result = mark_as_stopped("Execution cancelled after node handler")
            await send_node_event(
                client_id, sandbox.item.execution_id, "nodeComplete", stopped_result
            )
            return stopped_result

        if result.status == "success" and screenshot_timing == "after":
            screenshot_data = await capture_node_screenshot()
            if screenshot_data:
                result.data = {**(result.data or {}), **screenshot_data}

        if wait_after_ms > 0 and result.status != "failed":
            await asyncio.sleep(wait_after_ms / 1000)

    except Exception as e:
        import traceback

        error_traceback = traceback.format_exc()
        print(f"Execution error: {error_traceback}")
        result.status = "failed"
        result.error = str(e)
        result.message = f"Node execution failed: {node_type}"

        if screenshot_timing == "failure":
            screenshot_data = await capture_node_screenshot()
            if screenshot_data:
                result.data = {**(result.data or {}), **screenshot_data}

    finalize_result(result)

    # 更新节点执行记录（完成时）
    update_node_execution_record(node_execution_id, result)

    # 发送节点完成事件
    await send_node_event(client_id, sandbox.item.execution_id, "nodeComplete", result)
    return result


def find_node_by_id(nodes: List[dict], node_id: str) -> Optional[dict]:
    return next((n for n in nodes if n.get("id") == node_id), None)


def get_outgoing_edges(edges: List[dict], node_id: str) -> List[dict]:
    return [e for e in edges if e.get("source") == node_id]


def get_outgoing_edges_by_handle(
    edges: List[dict], node_id: str, source_handle: Optional[str] = None
) -> List[dict]:
    outgoing = get_outgoing_edges(edges, node_id)
    if source_handle is None:
        return [e for e in outgoing if not e.get("sourceHandle")]
    return [e for e in outgoing if e.get("sourceHandle") == source_handle]


def resolve_branch_condition(edge: dict) -> str:
    edge_data = edge.get("data", {}) or {}
    cond = edge_data.get("condition") or edge.get("sourceHandle") or "true"
    return str(cond).lower()


async def execute_foreach_children(
    sandbox: ExecutionSandbox,
    foreach_node: dict,
    edges: List[dict],
    nodes: List[dict],
    client_id: str,
    foreach_result: NodeResult,
) -> Optional[str]:
    foreach_data = foreach_result.data or {}
    items = foreach_data.get("items") or []
    item_name = foreach_data.get("itemName") or "item"
    previous_locals = dict(sandbox.runtime_ctx.locals or {})
    child_edges = get_outgoing_edges_by_handle(edges, foreach_node.get("id"), "body")

    if not child_edges:
        child_edges = get_outgoing_edges_by_handle(edges, foreach_node.get("id"), None)

    if not child_edges or not items:
        foreach_result.data = {**foreach_data, "iterations": []}
        return None

    child_nodes = []
    seen_child_ids = set()
    for edge in child_edges:
        target_id = edge.get("target")
        if target_id and target_id not in seen_child_ids:
            target_node = find_node_by_id(nodes, target_id)
            if target_node:
                child_nodes.append(target_node)
                seen_child_ids.add(target_id)

    iterations = []
    for index, item in enumerate(items):
        # 设置运行时局部变量 (foreach.item)
        sandbox.runtime_ctx.locals = {
            **previous_locals,
            item_name: item,
            "item": item,
            "index": index,
            "items": items,
            "__in_foreach__": True,
        }
        iteration_outputs = {item_name: item}
        iteration_results = []
        iteration_queue = [(child_node, item) for child_node in reversed(child_nodes)]
        iteration_executed = set()

        while iteration_queue:
            current_node, current_predecessor = iteration_queue.pop()
            current_node_id = current_node.get("id")

            if current_node_id in iteration_executed:
                continue

            child_result = await execute_node(
                sandbox,
                current_node,
                client_id,
                predecessor_output=current_predecessor,
                extra_outputs=iteration_outputs,
            )

            iteration_results.append(
                {
                    "nodeId": child_result.node_id,
                    "status": child_result.status,
                    "message": child_result.message,
                    "data": child_result.data,
                }
            )
            iteration_executed.add(current_node_id)
            iteration_outputs[current_node_id] = child_result.data

            if child_result.node_type == "foreach" and child_result.status != "failed":
                foreach_state = await execute_foreach_children(
                    sandbox,
                    current_node,
                    edges,
                    nodes,
                    client_id,
                    child_result,
                )
                iteration_outputs[current_node_id] = child_result.data
                if foreach_state == "failed":
                    child_result.status = "failed"

            if child_result.status == "failed":
                foreach_result.status = "failed"
                foreach_result.error = child_result.error
                foreach_result.message = f"Foreach child failed at iteration {index + 1}: {child_result.node_id}"
                foreach_result.data = {
                    **foreach_data,
                    "iterations": iterations
                    + [
                        {
                            "index": index,
                            "item": item,
                            "results": iteration_results,
                        }
                    ],
                }
                sandbox.runtime_ctx.locals = previous_locals
                return "failed"

            if child_result.node_type == "stop":
                foreach_result.data = {
                    **foreach_data,
                    "iterations": iterations
                    + [
                        {
                            "index": index,
                            "item": item,
                            "results": iteration_results,
                        }
                    ],
                }
                foreach_result.message = f"Foreach stopped at iteration {index + 1}"
                sandbox.runtime_ctx.locals = previous_locals
                return "completed"

            if child_result.node_type == "break":
                iterations.append(
                    {
                        "index": index,
                        "item": item,
                        "results": iteration_results,
                    }
                )
                foreach_result.data = {
                    **foreach_data,
                    "iterations": iterations,
                    "result": iterations,
                }
                foreach_result.message = f"Foreach break at iteration {index + 1}"
                sandbox.runtime_ctx.locals = previous_locals
                return "completed"

            if child_result.node_type == "continue":
                break

            outgoing_edges = get_outgoing_edges(edges, current_node_id)
            is_branching_node = (
                child_result.node_type in ["if", "check_existence"]
                or current_node.get("type") in ["if", "check_existence"]
                or (
                    current_node.get("data")
                    and (
                        current_node.get("data").get("nodeType")
                        in ["if", "check_existence"]
                        or "condition" in current_node.get("data")
                    )
                )
            )

            if is_branching_node:
                if child_result.status == "skipped":
                    continue
                res_val = child_result.data.get("result") if child_result.data else None
                if res_val is None:
                    res_val = False

                for edge in outgoing_edges:
                    cond = resolve_branch_condition(edge)
                    if (bool(res_val) is True and cond == "true") or (
                        bool(res_val) is False and cond == "false"
                    ):
                        target_node = find_node_by_id(nodes, edge.get("target"))
                        if target_node:
                            iteration_queue.append((target_node, child_result.data))
                        break
            else:
                for edge in reversed(outgoing_edges):
                    target_node = find_node_by_id(nodes, edge.get("target"))
                    if target_node:
                        iteration_queue.append((target_node, child_result.data))

        iterations.append(
            {
                "index": index,
                "item": item,
                "results": iteration_results,
            }
        )

    foreach_result.data = {
        **foreach_data,
        "iterations": iterations,
        "result": iterations,
    }
    foreach_result.message = f"Foreach executed {len(iterations)} iteration(s)"
    sandbox.runtime_ctx.locals = previous_locals
    return "completed"


def _is_loop_node_type(node_type: str) -> bool:
    return node_type in ["foreach", "while", "for"]


def _is_branching_node(current_node: dict, child_result: NodeResult) -> bool:
    return (
        child_result.node_type in ["if", "check_existence"]
        or current_node.get("type") in ["if", "check_existence"]
        or (
            current_node.get("data")
            and (
                current_node.get("data").get("nodeType") in ["if", "check_existence"]
                or "condition" in current_node.get("data")
            )
        )
    )


def _is_execution_cancelled(execution_id: str) -> bool:
    db = SessionLocal()
    try:
        execution = (
            db.query(ExecutionModel).filter(ExecutionModel.id == execution_id).first()
        )
        return bool(execution and execution.status == "cancelled")
    finally:
        db.close()


async def execute_loop_children(
    sandbox: ExecutionSandbox,
    loop_node: dict,
    edges: List[dict],
    nodes: List[dict],
    client_id: str,
    loop_result: NodeResult,
) -> Optional[str]:
    loop_data = loop_result.data or {}
    loop_type = loop_result.node_type
    previous_locals = dict(sandbox.runtime_ctx.locals or {})
    child_edges = get_outgoing_edges_by_handle(edges, loop_node.get("id"), "body")

    if not child_edges:
        child_edges = get_outgoing_edges_by_handle(edges, loop_node.get("id"), None)

    if not child_edges:
        loop_result.data = {**loop_data, "iterations": []}
        return None

    child_nodes = []
    seen_child_ids = set()
    for edge in child_edges:
        target_id = edge.get("target")
        if target_id and target_id not in seen_child_ids:
            target_node = find_node_by_id(nodes, target_id)
            if target_node:
                child_nodes.append(target_node)
                seen_child_ids.add(target_id)

    if not child_nodes:
        loop_result.data = {**loop_data, "iterations": []}
        return None

    iterations = []

    async def run_iteration(
        iteration_index: int,
        iteration_locals: Dict[str, Any],
        iteration_seed: Dict[str, Any],
        predecessor_value: Any,
    ) -> Optional[str]:
        sandbox.runtime_ctx.locals = {**previous_locals, **iteration_locals}
        iteration_outputs = dict(iteration_seed)
        iteration_results = []
        iteration_queue = [
            (child_node, predecessor_value) for child_node in reversed(child_nodes)
        ]
        iteration_executed = set()

        while iteration_queue:
            if _is_execution_cancelled(sandbox.item.execution_id):
                sandbox.runtime_ctx.locals = previous_locals
                loop_result.message = (
                    f"{loop_type.title()} stopped at iteration {iteration_index + 1}"
                )
                return "stopped"

            current_node, current_predecessor = iteration_queue.pop()
            current_node_id = current_node.get("id")

            if current_node_id in iteration_executed:
                continue

            child_result = await execute_node(
                sandbox,
                current_node,
                client_id,
                predecessor_output=current_predecessor,
                extra_outputs=iteration_outputs,
            )

            iteration_results.append(
                {
                    "nodeId": child_result.node_id,
                    "status": child_result.status,
                    "message": child_result.message,
                    "data": child_result.data,
                }
            )
            iteration_executed.add(current_node_id)
            iteration_outputs[current_node_id] = child_result.data

            if (
                _is_loop_node_type(child_result.node_type)
                and child_result.status != "failed"
            ):
                nested_state = await execute_loop_children(
                    sandbox,
                    current_node,
                    edges,
                    nodes,
                    client_id,
                    child_result,
                )
                iteration_outputs[current_node_id] = child_result.data
                if nested_state == "failed":
                    child_result.status = "failed"
                elif nested_state == "stopped":
                    loop_result.message = f"{loop_type.title()} stopped at iteration {iteration_index + 1}"
                    sandbox.runtime_ctx.locals = previous_locals
                    return "stopped"

            if child_result.status == "failed":
                loop_result.status = "failed"
                loop_result.error = child_result.error
                loop_result.message = f"{loop_type.title()} child failed at iteration {iteration_index + 1}: {child_result.node_id}"
                iterations.append(
                    {
                        "index": iteration_index,
                        **iteration_seed,
                        "results": iteration_results,
                    }
                )
                loop_result.data = {
                    **loop_data,
                    "iterations": iterations,
                    "result": iterations,
                }
                sandbox.runtime_ctx.locals = previous_locals
                return "failed"

            if child_result.node_type == "stop":
                iterations.append(
                    {
                        "index": iteration_index,
                        **iteration_seed,
                        "results": iteration_results,
                    }
                )
                loop_result.data = {
                    **loop_data,
                    "iterations": iterations,
                    "result": iterations,
                }
                loop_result.message = (
                    f"{loop_type.title()} stopped at iteration {iteration_index + 1}"
                )
                # Mark the loop result as a stop so outer execution can halt the flow
                loop_result.node_type = "stop"
                # Ensure status is success (or could be stopped) – keep as success for now
                if loop_result.status == "running":
                    loop_result.status = "success"
                sandbox.runtime_ctx.locals = previous_locals
                return "completed"

            if child_result.node_type == "break":
                iterations.append(
                    {
                        "index": iteration_index,
                        **iteration_seed,
                        "results": iteration_results,
                    }
                )
                loop_result.data = {
                    **loop_data,
                    "iterations": iterations,
                    "result": iterations,
                }
                loop_result.message = (
                    f"{loop_type.title()} break at iteration {iteration_index + 1}"
                )
                sandbox.runtime_ctx.locals = previous_locals
                return "break"

            if child_result.node_type == "continue":
                iterations.append(
                    {
                        "index": iteration_index,
                        **iteration_seed,
                        "results": iteration_results,
                    }
                )
                return "continue"

            outgoing_edges = get_outgoing_edges(edges, current_node_id)
            if _is_branching_node(current_node, child_result):
                if child_result.status == "skipped":
                    continue
                res_val = child_result.data.get("result") if child_result.data else None
                if res_val is None:
                    res_val = False

                for edge in outgoing_edges:
                    cond = resolve_branch_condition(edge)
                    if (bool(res_val) is True and cond == "true") or (
                        bool(res_val) is False and cond == "false"
                    ):
                        target_node = find_node_by_id(nodes, edge.get("target"))
                        if target_node:
                            iteration_queue.append((target_node, child_result.data))
                        break
            else:
                for edge in reversed(outgoing_edges):
                    target_node = find_node_by_id(nodes, edge.get("target"))
                    if target_node:
                        iteration_queue.append((target_node, child_result.data))

        iterations.append(
            {"index": iteration_index, **iteration_seed, "results": iteration_results}
        )
        return None

    try:
        if loop_type == "foreach":
            items = loop_data.get("items") or []
            item_name = loop_data.get("itemName") or "item"
            if not items:
                loop_result.data = {**loop_data, "iterations": [], "result": []}
                return None

            for index, item in enumerate(items):
                if _is_execution_cancelled(sandbox.item.execution_id):
                    loop_result.message = (
                        f"Foreach stopped before iteration {index + 1}"
                    )
                    sandbox.runtime_ctx.locals = previous_locals
                    return "stopped"

                state = await run_iteration(
                    index,
                    {
                        item_name: item,
                        "item": item,
                        "index": index,
                        "items": items,
                        "__in_loop__": True,
                        "__loop_type__": "foreach",
                    },
                    {item_name: item, "item": item},
                    item,
                )
                if state == "failed":
                    return "failed"
                if state == "stopped":
                    return "stopped"
                if state == "completed" or state == "break":
                    if loop_result.status == "running":
                        loop_result.status = "success"
                    return "completed"

            loop_result.data = {
                **loop_data,
                "iterations": iterations,
                "result": iterations,
            }
            loop_result.status = "success"
            loop_result.message = f"Foreach executed {len(iterations)} iteration(s)"
            return "completed"

        if loop_type == "while":
            max_iterations = int(loop_data.get("maxIterations") or 1000)
            for index in range(max_iterations):
                if _is_execution_cancelled(sandbox.item.execution_id):
                    loop_result.message = f"While stopped before iteration {index + 1}"
                    sandbox.runtime_ctx.locals = previous_locals
                    return "stopped"

                # 每次迭代重新获取条件参数，确保能看到变量更新
                condition_result = evaluate_condition_config(
                    sandbox.runtime_ctx,
                    loop_data,  # 直接使用 loop_data，包含 leftValue/operator/value
                    {},  # 不使用 resolved_inputs，避免缓存问题
                    raw_condition=None,
                )
                if not condition_result.get("result"):
                    break

                state = await run_iteration(
                    index,
                    {
                        "index": index,
                        "iteration": index,
                        "__in_loop__": True,
                        "__loop_type__": "while",
                    },
                    {"index": index, "iteration": index},
                    condition_result,
                )
                if state == "failed":
                    return "failed"
                if state == "stopped":
                    return "stopped"
                if state == "completed" or state == "break":
                    if loop_result.status == "running":
                        loop_result.status = "success"
                    return "completed"

            loop_result.data = {
                **loop_data,
                "iterations": iterations,
                "result": iterations,
            }
            loop_result.status = "success"
            loop_result.message = f"While executed {len(iterations)} iteration(s)"
            return "completed"

        if loop_type == "for":
            variable_name = loop_data.get("variableName") or "i"
            start = int(loop_data.get("start") or 0)
            end = int(loop_data.get("end") or 0)
            step = int(loop_data.get("step") or 1)
            inclusive = bool(loop_data.get("inclusive"))
            max_iterations = int(loop_data.get("maxIterations") or 1000)

            if step == 0:
                loop_result.status = "failed"
                loop_result.error = "For loop step 不能为 0"
                return "failed"

            current = start
            index = 0
            while index < max_iterations:
                if _is_execution_cancelled(sandbox.item.execution_id):
                    loop_result.message = f"For stopped before iteration {index + 1}"
                    sandbox.runtime_ctx.locals = previous_locals
                    return "stopped"

                if step > 0:
                    in_range = current <= end if inclusive else current < end
                else:
                    in_range = current >= end if inclusive else current > end
                if not in_range:
                    break

                state = await run_iteration(
                    index,
                    {
                        variable_name: current,
                        "index": index,
                        "iteration": index,
                        "value": current,
                        "__in_loop__": True,
                        "__loop_type__": "for",
                    },
                    {variable_name: current, "value": current},
                    current,
                )
                if state == "failed":
                    return "failed"
                if state == "stopped":
                    return "stopped"
                if state == "completed" or state == "break":
                    if loop_result.status == "running":
                        loop_result.status = "success"
                    return "completed"

                current += step
                index += 1

            loop_result.data = {
                **loop_data,
                "iterations": iterations,
                "result": iterations,
            }
            loop_result.status = "success"
            loop_result.message = f"For executed {len(iterations)} iteration(s)"
            return "completed"

        return None
    finally:
        sandbox.runtime_ctx.locals = previous_locals


def topological_sort(nodes: List[dict], edges: List[dict]) -> List[dict]:
    """
    拓扑排序节点

    Args:
        nodes: 节点列表
        edges: 边列表

    Returns:
        排序后的节点列表
    """
    node_map = {n["id"]: n for n in nodes}
    indegree = {n["id"]: 0 for n in nodes}
    adj: Dict[str, List[str]] = {n["id"]: [] for n in nodes}

    for e in edges:
        source = e.get("source")
        target = e.get("target")
        if source in adj and target in indegree:
            adj[source].append(target)
            indegree[target] += 1

    queue = [nid for nid, deg in indegree.items() if deg == 0]
    sorted_nodes = []

    while queue:
        nid = queue.pop(0)
        sorted_nodes.append(node_map[nid])
        for nxt in adj[nid]:
            indegree[nxt] -= 1
            if indegree[nxt] == 0:
                queue.append(nxt)

    return sorted_nodes


async def send_periodic_screenshots(
    sandbox: ExecutionSandbox,
    client_id: str,
    execution_id: str,
    stop_event: asyncio.Event,
):
    """
    定期发送浏览器截图

    Args:
        sandbox: 执行沙箱
        client_id: WebSocket 客户端 ID
        execution_id: 执行 ID
        stop_event: 停止事件
    """
    while not stop_event.is_set():
        try:
            page = sandbox.get_current_page()
            if page:
                # 截取屏幕截图并转换为 base64
                screenshot_bytes = await page.screenshot()
                screenshot_base64 = base64.b64encode(screenshot_bytes).decode("utf-8")

                # 通过 WebSocket 发送截图
                await ws_manager.send(
                    client_id,
                    {
                        "type": "screenshot",
                        "executionId": execution_id,
                        "data": {
                            "image": f"data:image/png;base64,{screenshot_base64}",
                            "timestamp": datetime.utcnow().isoformat(),
                        },
                    },
                )
        except Exception as e:
            print(f"Screenshot error: {e}")

        # 等待指定间隔
        await asyncio.sleep(SCREENSHOT_INTERVAL)


async def run_execution(item: ExecutionQueueItem) -> Dict[str, Any]:
    """
    执行 Flow

    Args:
        item: 执行队列项

    Returns:
        执行结果
    """
    # 获取 Identity 锁
    if item.identity_id:
        acquired = await acquire_identity(item.identity_id, item.execution_id)
        if not acquired:
            return {"status": "failed", "error": "Failed to acquire identity lock"}

    # 获取 Identity 配置
    identity = None
    if item.identity_id:
        db = SessionLocal()
        try:
            identity = (
                db.query(IdentityModel)
                .filter(IdentityModel.id == item.identity_id)
                .first()
            )
        finally:
            db.close()

    sandbox = ExecutionSandbox(item, identity)
    results: List[NodeResult] = []
    stop_screenshot_event = asyncio.Event()
    screenshot_task = None

    async def emit_execution_notification(event: str) -> None:
        try:
            await dispatch_flow_notifications(
                item.execution_id,
                event,
                node_results=[build_node_result_payload(result) for result in results],
            )
        except Exception as exc:
            print(f"[Notification] dispatch failed: {exc}")

    try:
        await emit_execution_notification("execution_started")
        # 启动浏览器
        await sandbox.start()

        # 启动定期截图任务
        screenshot_task = asyncio.create_task(
            send_periodic_screenshots(
                sandbox, item.client_id, item.execution_id, stop_screenshot_event
            )
        )

        # 获取 Flow 数据
        flow_data = item.flow_data
        nodes = flow_data.get("nodes", [])
        edges = flow_data.get("edges", [])

        # 找到起始节点 (没有入边的节点)
        all_targets = {e.get("target") for e in edges}
        start_nodes = [n for n in nodes if n.get("id") not in all_targets]

        # 如果没有起始节点但有节点，则从第一个节点开始
        if not start_nodes and nodes:
            start_nodes = [nodes[0]]

        # 初始队列：(节点, 前驱输出)
        queue = [(n, None) for n in start_nodes]
        executed_nodes = set()

        # 执行节点 (基于图的深度优先遍历，避免分支交替执行导致的状态干扰)
        while queue:
            db = SessionLocal()
            try:
                execution = (
                    db.query(ExecutionModel)
                    .filter(ExecutionModel.id == sandbox.item.execution_id)
                    .first()
                )
                if execution and execution.status == "cancelled":
                    await ws_manager.send(
                        item.client_id,
                        {
                            "type": "flowComplete",
                            "executionId": item.execution_id,
                            "status": "stopped",
                            "result": {
                                "status": "stopped",
                                "executionId": item.execution_id,
                            },
                            "finishedAt": datetime.utcnow().isoformat(),
                        },
                    )
                    await emit_execution_notification("execution_cancelled")
                    return {
                        "status": "stopped",
                        "totalNodes": len(results),
                        "successCount": sum(
                            1 for r in results if r.status == "success"
                        ),
                        "failedCount": sum(1 for r in results if r.status == "failed"),
                        "skippedCount": sum(
                            1 for r in results if r.status == "skipped"
                        ),
                        "nodes": [
                            {
                                "nodeId": r.node_id,
                                "nodeType": r.node_type,
                                "status": r.status,
                                "startedAt": (
                                    r.started_at.isoformat() if r.started_at else None
                                ),
                                "finishedAt": (
                                    r.finished_at.isoformat() if r.finished_at else None
                                ),
                                "durationMs": r.duration_ms,
                                "message": r.message,
                                "error": r.error,
                            }
                            for r in results
                        ],
                    }
            finally:
                db.close()

            node, predecessor_output = queue.pop()  # 使用 pop() 实现 DFS
            node_id = node.get("id")

            if node_id in executed_nodes:
                continue

            result = await execute_node(
                sandbox, node, item.client_id, predecessor_output
            )
            results.append(result)

            # 将结果存入上下文，供后续节点引用
            if sandbox.runtime_ctx:
                sandbox.runtime_ctx.outputs[result.node_id] = result.data
            executed_nodes.add(node_id)

            if _is_loop_node_type(result.node_type) and result.status != "failed":
                foreach_state = await execute_loop_children(
                    sandbox,
                    node,
                    edges,
                    nodes,
                    item.client_id,
                    result,
                )
                if sandbox.runtime_ctx:
                    sandbox.runtime_ctx.outputs[result.node_id] = result.data
                if foreach_state == "failed":
                    break
                if foreach_state == "stopped":
                    break
                done_edges = get_outgoing_edges_by_handle(edges, node_id, "done")
                if done_edges:
                    for edge in reversed(done_edges):
                        target_id = edge.get("target")
                        target_node = find_node_by_id(nodes, target_id)
                        if target_node:
                            queue.append((target_node, result.data))
                    continue

            # 如果节点失败，检查 stopOnFailure 选项
            if result.status == "failed":
                # 获取节点的 stopOnFailure 配置，默认为 True
                node_data_dict = node.get("data", {}) or {}
                stop_on_failure = node_data_dict.get("stopOnFailure", True)
                # 处理字符串类型的值
                if isinstance(stop_on_failure, str):
                    stop_on_failure = stop_on_failure.lower() == "true"

                if stop_on_failure:
                    # 1. 更新数据库状态为 failed
                    db = SessionLocal()
                    try:
                        execution = (
                            db.query(ExecutionModel)
                            .filter(ExecutionModel.id == sandbox.item.execution_id)
                            .first()
                        )
                        if execution:
                            execution.status = "failed"
                            execution.error_message = result.error or result.message
                            db.commit()
                    except Exception as e:
                        print(f"Failed to update execution status to failed: {e}")
                        db.rollback()
                    finally:
                        db.close()

                    # 2. 发送执行失败事件给前台
                    await ws_manager.send(
                        item.client_id,
                        {
                            "type": "executionFailed",
                            "executionId": item.execution_id,
                            "error": result.error or result.message,
                            "nodeId": result.node_id,
                        },
                    )
                    await emit_execution_notification("execution_failed")
                    break
                # stopOnFailure 为 False 时，记录错误但继续执行
                else:
                    await ws_manager.send(
                        item.client_id,
                        {
                            "type": "nodeError",
                            "executionId": item.execution_id,
                            "nodeId": result.node_id,
                            "error": result.error or result.message,
                            "message": f"节点 {result.node_id} 失败但继续执行",
                        },
                    )

            # 如果是 stop 节点，停止执行
            if result.node_type == "stop":
                break

            # 查找出边并决定下一个执行节点
            outgoing_edges = get_outgoing_edges(edges, node_id)

            # 确定是否为逻辑分支节点 (if 或 check_existence)
            is_branching_node = (
                result.node_type in ["if", "check_existence"]
                or node.get("type") in ["if", "check_existence"]
                or (
                    node.get("data")
                    and (
                        node.get("data").get("nodeType") in ["if", "check_existence"]
                        or "condition" in node.get("data")
                    )
                )
            )

            if is_branching_node:
                if result.status == "skipped":
                    continue
                # 分支节点：仅将匹配条件的边加入栈中
                res_val = result.data.get("result") if result.data else None

                # 如果没有结果，默认视为 False 并记录警告
                if res_val is None:
                    res_val = False
                    result.message = (
                        result.message or ""
                    ) + " [警告: 未找到判断结果, 默认走 False 分支]"

                found_branch = False
                for edge in outgoing_edges:
                    cond = resolve_branch_condition(edge)

                    # 使用 bool() 转换确保兼容性
                    if (bool(res_val) is True and cond == "true") or (
                        bool(res_val) is False and cond == "false"
                    ):
                        target_id = edge.get("target")
                        target_node = find_node_by_id(nodes, target_id)
                        if target_node:
                            if result.node_type == "foreach":
                                continue
                            queue.append((target_node, result.data))
                            found_branch = True
                        break  # 分支节点只走一个匹配分支

                if not found_branch:
                    result.message = (
                        (result.message or "")
                        + f" [停止: 结果为 {res_val}, 但未找到匹配的 { 'true' if res_val else 'false' } 分支]"
                    )
            else:
                # 普通节点：将所有后续节点按反序加入栈中，以保证正序执行
                for edge in reversed(outgoing_edges):
                    target_id = edge.get("target")
                    target_node = find_node_by_id(nodes, target_id)
                    if target_node:
                        if result.node_type == "foreach":
                            continue
                        queue.append((target_node, result.data))

        # 计算执行结果

        # 计算执行结果
        success_count = sum(1 for r in results if r.status == "success")
        failed_count = sum(1 for r in results if r.status == "failed")
        skipped_count = sum(1 for r in results if r.status == "skipped")

        # 检查是否由 stop 节点触发的错误停止
        stop_error = False
        if results:
            last_result = results[-1]
            if (
                last_result.node_type == "stop"
                and last_result.data
                and last_result.data.get("type") == "error"
            ):
                stop_error = True

        final_status = (
            "completed" if (failed_count == 0 and not stop_error) else "failed"
        )

        # 更新最终执行状态到数据库
        db = SessionLocal()
        try:
            execution = (
                db.query(ExecutionModel)
                .filter(ExecutionModel.id == sandbox.item.execution_id)
                .first()
            )
            if execution:
                if execution.status == "cancelled":
                    final_status = "stopped"
                else:
                    execution.status = final_status
                    execution.finished_at = datetime.utcnow()
                    if final_status == "failed" and not results:
                        execution.error_message = "No nodes were executed"
                    elif final_status == "failed" and results:
                        # 记录最后一个失败节点的错误
                        failed_nodes = [r for r in results if r.status == "failed"]
                        if failed_nodes:
                            execution.error_message = (
                                failed_nodes[-1].error or failed_nodes[-1].message
                            )
                    db.commit()
        except Exception as e:
            print(f"Failed to update final execution status: {e}")
            db.rollback()
        finally:
            db.close()

        execution_result = {
            "status": final_status,
            "totalNodes": len(results),
            "successCount": success_count,
            "failedCount": failed_count,
            "skippedCount": skipped_count,
            "nodes": [
                {
                    "nodeId": r.node_id,
                    "nodeType": r.node_type,
                    "status": r.status,
                    "durationMs": r.duration_ms,
                    "message": r.message,
                    "error": r.error,
                }
                for r in results
            ],
        }

        # 发送执行完成事件
        await ws_manager.send(
            item.client_id,
            {
                "type": "flowComplete",
                "executionId": item.execution_id,
                "status": final_status,
                "result": execution_result,
                "finishedAt": datetime.utcnow().isoformat(),
            },
        )

        if final_status == "completed":
            await emit_execution_notification("execution_completed")
        elif final_status in {"failed", "stopped"}:
            await emit_execution_notification(
                "execution_cancelled"
                if final_status == "stopped"
                else "execution_failed"
            )

        return execution_result

    except Exception as e:
        error_result = {"status": "failed", "error": str(e)}
        # 发送执行错误事件
        await ws_manager.send(
            item.client_id,
            {
                "type": "error",
                "message": str(e),
                "traceback": traceback.format_exc(),
                "finishedAt": datetime.utcnow().isoformat(),
            },
        )
        await emit_execution_notification("execution_failed")
        return error_result

    finally:
        state_path = get_identity_state_path(identity)
        if state_path:
            try:
                os.makedirs(os.path.dirname(state_path), exist_ok=True)
                await sandbox.save_storage_state(state_path)
            except Exception as e:
                print(f"Failed to save storage state for identity {identity.id}: {e}")
        # 停止截图任务
        if screenshot_task:
            stop_screenshot_event.set()
            try:
                await asyncio.wait_for(screenshot_task, timeout=2.0)
            except asyncio.TimeoutError:
                screenshot_task.cancel()
        # 关闭浏览器
        await sandbox.close()
        # 释放 Identity 锁
        if item.identity_id:
            release_identity(item.identity_id, item.execution_id)
