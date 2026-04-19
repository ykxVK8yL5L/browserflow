"""WebSocket 连接管理器

管理 WebSocket 连接，用于向客户端发送执行状态更新。
"""

from typing import Dict, Optional
from fastapi import WebSocket
from datetime import datetime
import json
import asyncio


class WebSocketManager:
    """WebSocket 连接管理器"""

    def __init__(self):
        self._connections: Dict[str, WebSocket] = {}
        self._user_connections: Dict[str, str] = {}  # user_id -> client_id

    async def connect(self, websocket: WebSocket, client_id: str, user_id: str) -> None:
        """
        接受 WebSocket 连接

        Args:
            websocket: WebSocket 连接
            client_id: 客户端 ID
            user_id: 用户 ID
        """
        await websocket.accept()
        self._connections[client_id] = websocket
        self._user_connections[user_id] = client_id

    def disconnect(self, client_id: str, user_id: str) -> None:
        """
        断开 WebSocket 连接

        Args:
            client_id: 客户端 ID
            user_id: 用户 ID
        """
        self._connections.pop(client_id, None)
        # 只有当当前 client_id 对应 user_id 时才删除
        if self._user_connections.get(user_id) == client_id:
            self._user_connections.pop(user_id, None)

    async def send(self, client_id: str, message: dict) -> bool:
        """
        向指定客户端发送消息

        Args:
            client_id: 客户端 ID
            message: 消息内容

        Returns:
            是否发送成功
        """
        websocket = self._connections.get(client_id)
        if websocket:
            try:
                await websocket.send_json(message)
                return True
            except Exception:
                # 连接可能已断开
                self._connections.pop(client_id, None)
                return False
        return False

    async def send_to_user(self, user_id: str, message: dict) -> bool:
        """
        向指定用户发送消息

        Args:
            user_id: 用户 ID
            message: 消息内容

        Returns:
            是否发送成功
        """
        client_id = self._user_connections.get(user_id)
        if client_id:
            return await self.send(client_id, message)
        return False

    async def broadcast(self, message: dict) -> int:
        """
        向所有连接广播消息

        Args:
            message: 消息内容

        Returns:
            成功发送的连接数
        """
        success_count = 0
        for client_id in list(self._connections.keys()):
            if await self.send(client_id, message):
                success_count += 1
        return success_count

    def is_connected(self, client_id: str) -> bool:
        """
        检查客户端是否已连接

        Args:
            client_id: 客户端 ID

        Returns:
            是否已连接
        """
        return client_id in self._connections

    def get_client_id(self, user_id: str) -> Optional[str]:
        """
        获取用户的客户端 ID

        Args:
            user_id: 用户 ID

        Returns:
            客户端 ID，或 None
        """
        return self._user_connections.get(user_id)

    @property
    def connection_count(self) -> int:
        """当前连接数"""
        return len(self._connections)


# 全局 WebSocket 管理器实例
ws_manager = WebSocketManager()
