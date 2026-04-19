from __future__ import annotations

import json
from typing import Any, Dict

from .registry import TemplateFunctionRegistry, TemplateFunctionError


def _require_str(value: Any, name: str) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    return str(value)


def register(registry: TemplateFunctionRegistry) -> None:
    # json.parse(text) -> object
    def parse_fn(args: list[Any], _ctx: Dict[str, Any]) -> Any:
        if not args:
            raise TemplateFunctionError("json.parse requires (text)")
        text = _require_str(args[0], "text")
        return json.loads(text)

    registry.register(
        "json",
        "parse",
        parse_fn,
        description="解析 JSON 字符串为对象/数组",
        signature="json.parse(text)",
    )

    # json.dumps(value[, indent]) -> string
    def dumps_fn(args: list[Any], _ctx: Dict[str, Any]) -> str:
        if not args:
            raise TemplateFunctionError("json.dumps requires (value)")
        value = args[0]
        indent = None
        if len(args) >= 2 and args[1] not in (None, ""):
            try:
                indent = int(args[1])
            except Exception as exc:
                raise TemplateFunctionError("indent must be int") from exc
        return json.dumps(value, ensure_ascii=False, indent=indent)

    registry.register(
        "json",
        "dumps",
        dumps_fn,
        description="把对象/数组序列化为 JSON 字符串",
        signature="json.dumps(value, indent=None)",
    )

    # json.get(obj, path, default=None) -> any
    # path: dot / [index] (same token rules as existing store references)
    def get_fn(args: list[Any], _ctx: Dict[str, Any]) -> Any:
        if len(args) < 2:
            raise TemplateFunctionError("json.get requires (obj, path, default=None)")
        obj = args[0]
        path = _require_str(args[1], "path")
        default = args[2] if len(args) >= 3 else None

        # Lightweight path resolver
        tokens: list[Any] = []
        current = []
        index_buffer = []
        in_index = False
        for ch in path:
            if in_index:
                if ch == "]":
                    index_text = "".join(index_buffer).strip()
                    if index_text.isdigit() or (
                        index_text.startswith("-") and index_text[1:].isdigit()
                    ):
                        tokens.append(int(index_text))
                    else:
                        tokens.append(index_text.strip("\"'"))
                    index_buffer = []
                    in_index = False
                else:
                    index_buffer.append(ch)
                continue
            if ch == ".":
                if current:
                    tokens.append("".join(current))
                    current = []
                continue
            if ch == "[":
                if current:
                    tokens.append("".join(current))
                    current = []
                in_index = True
                continue
            current.append(ch)
        if current:
            tokens.append("".join(current))
        tokens = [t for t in tokens if t != ""]

        cur: Any = obj
        for t in tokens:
            if isinstance(t, int):
                if isinstance(cur, (list, tuple)) and -len(cur) <= t < len(cur):
                    cur = cur[t]
                else:
                    return default
            else:
                if isinstance(cur, dict) and t in cur:
                    cur = cur[t]
                else:
                    return default
        return cur

    registry.register(
        "json",
        "get",
        get_fn,
        description="从对象中按路径取值（支持 . 和 [index]），取不到返回 default",
        signature="json.get(obj, path, default=None)",
    )
