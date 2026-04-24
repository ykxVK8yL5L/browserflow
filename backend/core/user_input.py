from __future__ import annotations

import asyncio
from typing import Any

from .websocket_manager import ws_manager


class UserInputCancelledError(Exception):
    """Raised when the user cancels a wait-for-user prompt."""


_pending_user_inputs: dict[str, asyncio.Future[dict[str, Any]]] = {}


def _make_key(execution_id: str, node_id: str) -> str:
    return f"{execution_id}:{node_id}"


async def request_user_input(
    *,
    client_id: str,
    execution_id: str,
    node_id: str,
    title: str,
    message: str,
    input_type: str = "text",
    placeholder: str = "",
    default_value: Any = None,
    confirm_text: str = "Submit",
    cancel_text: str = "Cancel",
    required: bool = False,
    timeout_ms: int = 0,
) -> dict[str, Any]:
    key = _make_key(execution_id, node_id)
    loop = asyncio.get_running_loop()
    future: asyncio.Future[dict[str, Any]] = loop.create_future()
    _pending_user_inputs[key] = future

    await ws_manager.send(
        client_id,
        {
            "type": "waitForUser",
            "executionId": execution_id,
            "data": {
                "nodeId": node_id,
                "title": title,
                "message": message,
                "inputType": input_type,
                "placeholder": placeholder,
                "defaultValue": default_value,
                "confirmText": confirm_text,
                "cancelText": cancel_text,
                "required": required,
                "timeoutMs": timeout_ms,
            },
        },
    )

    try:
        if timeout_ms and timeout_ms > 0:
            response = await asyncio.wait_for(future, timeout=timeout_ms / 1000)
        else:
            response = await future
    finally:
        _pending_user_inputs.pop(key, None)

    if response.get("cancelled"):
        raise UserInputCancelledError(response.get("message") or "User cancelled input")

    return response


def submit_user_input(
    execution_id: str,
    node_id: str,
    payload: dict[str, Any] | None,
) -> bool:
    key = _make_key(execution_id, node_id)
    future = _pending_user_inputs.get(key)
    if not future or future.done():
        return False

    future.set_result(payload or {})
    return True
