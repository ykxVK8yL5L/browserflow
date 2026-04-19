"""Identity 锁管理

确保同一个 Identity 不会被多个执行同时使用，
避免登录状态冲突和浏览器资源竞争。
"""

import asyncio
from typing import Dict, Optional
from datetime import datetime


# 全局 Identity 锁管理
_identity_locks: Dict[str, asyncio.Lock] = {}
_lock_owners: Dict[str, str] = {}  # identity_id -> execution_id
_lock_timestamps: Dict[str, datetime] = {}  # identity_id -> lock time


async def acquire_identity(
    identity_id: str, execution_id: str, timeout: float = 300.0
) -> bool:
    """
    获取 Identity 锁

    Args:
        identity_id: Identity ID
        execution_id: 执行 ID（用于标识锁的持有者）
        timeout: 超时时间（秒），默认 5 分钟

    Returns:
        是否成功获取锁
    """
    if identity_id is None:
        # 没有 identity，不需要锁
        return True

    lock = _identity_locks.setdefault(identity_id, asyncio.Lock())

    try:
        # 尝试获取锁，带超时
        await asyncio.wait_for(lock.acquire(), timeout=timeout)
        _lock_owners[identity_id] = execution_id
        _lock_timestamps[identity_id] = datetime.utcnow()
        return True
    except asyncio.TimeoutError:
        return False


def release_identity(identity_id: str, execution_id: str) -> None:
    """
    释放 Identity 锁

    Args:
        identity_id: Identity ID
        execution_id: 执行 ID
    """
    if identity_id is None:
        return

    lock = _identity_locks.get(identity_id)
    if lock and lock.locked():
        # 验证是否是同一个执行持有的锁
        owner = _lock_owners.get(identity_id)
        if owner == execution_id:
            lock.release()
            _lock_owners.pop(identity_id, None)
            _lock_timestamps.pop(identity_id, None)


def is_identity_locked(identity_id: str) -> bool:
    """
    检查 Identity 是否被锁定

    Args:
        identity_id: Identity ID

    Returns:
        是否被锁定
    """
    if identity_id is None:
        return False

    lock = _identity_locks.get(identity_id)
    return lock is not None and lock.locked()


def get_lock_owner(identity_id: str) -> Optional[str]:
    """
    获取锁的持有者

    Args:
        identity_id: Identity ID

    Returns:
        持有锁的 execution_id，或 None
    """
    return _lock_owners.get(identity_id)


def get_lock_time(identity_id: str) -> Optional[datetime]:
    """
    获取锁的获取时间

    Args:
        identity_id: Identity ID

    Returns:
        锁的获取时间，或 None
    """
    return _lock_timestamps.get(identity_id)


def get_all_locked_identities() -> Dict[str, Dict[str, any]]:
    """
    获取所有被锁定的 Identity 信息

    Returns:
        Dict[identity_id, {execution_id, locked_at}]
    """
    result = {}
    for identity_id, execution_id in _lock_owners.items():
        result[identity_id] = {
            "execution_id": execution_id,
            "locked_at": _lock_timestamps.get(identity_id),
        }
    return result
