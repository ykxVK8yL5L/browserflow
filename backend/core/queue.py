"""执行队列系统"""

import asyncio
from dataclasses import dataclass, field
from typing import Optional, Dict, Any
from datetime import datetime
from enum import Enum


class ExecutionStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


@dataclass
class ExecutionQueueItem:
    """执行队列项"""

    execution_id: str
    user_id: str
    flow_id: str
    identity_id: Optional[str]
    flow_data: Dict[str, Any]  # Flow JSON 定义
    client_id: str  # WebSocket client_id，用于发送消息
    user_agent_id: Optional[str] = None
    headless: Optional[bool] = None
    viewport: Optional[Dict[str, int]] = None
    locale: Optional[str] = None
    timezone: Optional[str] = None
    proxy: Optional[str] = None
    humanize: Optional[bool] = None
    device: Optional[str] = None  # 新增设备字段
    created_at: datetime = field(default_factory=datetime.utcnow)
    started_at: Optional[datetime] = None
    finished_at: Optional[datetime] = None
    status: ExecutionStatus = ExecutionStatus.PENDING
    result: Optional[Dict[str, Any]] = None
    error: Optional[str] = None


class ExecutionQueue:
    """执行队列管理器"""

    def __init__(self, max_workers: int = 2):
        self._queue: asyncio.Queue[ExecutionQueueItem] = asyncio.Queue()
        self._workers: list[asyncio.Task] = []
        self._max_workers = max_workers
        self._running = False
        # 执行项缓存，用于查询状态
        self._items: Dict[str, ExecutionQueueItem] = {}

    async def put(self, item: ExecutionQueueItem) -> None:
        """将执行项加入队列"""
        self._items[item.execution_id] = item
        await self._queue.put(item)

    async def get(self) -> ExecutionQueueItem:
        """从队列获取执行项"""
        return await self._queue.get()

    def task_done(self) -> None:
        """标记队列任务完成"""
        self._queue.task_done()

    def get_item(self, execution_id: str) -> Optional[ExecutionQueueItem]:
        """获取执行项"""
        return self._items.get(execution_id)

    def update_item(self, execution_id: str, **kwargs) -> None:
        """更新执行项"""
        item = self._items.get(execution_id)
        if item:
            for key, value in kwargs.items():
                if hasattr(item, key):
                    setattr(item, key, value)

    def get_user_items(self, user_id: str) -> list[ExecutionQueueItem]:
        """获取用户的所有执行项"""
        return [item for item in self._items.values() if item.user_id == user_id]

    @property
    def size(self) -> int:
        """队列大小"""
        return self._queue.qsize()

    @property
    def is_empty(self) -> bool:
        """队列是否为空"""
        return self._queue.empty()


# 全局执行队列实例
execution_queue = ExecutionQueue(max_workers=2)
