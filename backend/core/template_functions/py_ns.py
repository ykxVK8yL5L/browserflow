from __future__ import annotations

from typing import Any, Dict

from .registry import TemplateFunctionError, TemplateFunctionRegistry


def register(registry: TemplateFunctionRegistry) -> None:
    # py.len(value) -> int
    def len_fn(args: list[Any], _ctx: Dict[str, Any]) -> int:
        if not args:
            raise TemplateFunctionError("py.len requires (value)")
        value = args[0]
        try:
            return len(value)
        except Exception as exc:
            raise TemplateFunctionError(
                "py.len only supports string/list/tuple/dict/set/bytes-like values"
            ) from exc

    registry.register(
        "py",
        "len",
        len_fn,
        description="返回字符串、数组、对象等可迭代值的长度",
        signature="py.len(value)",
    )

    # py.str(value) -> string
    def str_fn(args: list[Any], _ctx: Dict[str, Any]) -> str:
        if not args:
            raise TemplateFunctionError("py.str requires (value)")
        value = args[0]
        return "" if value is None else str(value)

    registry.register(
        "py",
        "str",
        str_fn,
        description="将输入值转为字符串",
        signature="py.str(value)",
    )

    # py.int(value) -> int
    def int_fn(args: list[Any], _ctx: Dict[str, Any]) -> int:
        if not args:
            raise TemplateFunctionError("py.int requires (value)")
        value = args[0]
        try:
            return int(value)
        except Exception as exc:
            raise TemplateFunctionError(
                "py.int requires a numeric-compatible value"
            ) from exc

    registry.register(
        "py",
        "int",
        int_fn,
        description="将输入值转为整数",
        signature="py.int(value)",
    )

    # py.float(value) -> float
    def float_fn(args: list[Any], _ctx: Dict[str, Any]) -> float:
        if not args:
            raise TemplateFunctionError("py.float requires (value)")
        value = args[0]
        try:
            return float(value)
        except Exception as exc:
            raise TemplateFunctionError(
                "py.float requires a numeric-compatible value"
            ) from exc

    registry.register(
        "py",
        "float",
        float_fn,
        description="将输入值转为浮点数",
        signature="py.float(value)",
    )

    # py.bool(value) -> bool
    def bool_fn(args: list[Any], _ctx: Dict[str, Any]) -> bool:
        if not args:
            raise TemplateFunctionError("py.bool requires (value)")
        value = args[0]
        if isinstance(value, str):
            text = value.strip().lower()
            if text in {"", "0", "false", "no", "off", "null", "none"}:
                return False
            if text in {"1", "true", "yes", "on"}:
                return True
        return bool(value)

    registry.register(
        "py",
        "bool",
        bool_fn,
        description="将输入值转为布尔值",
        signature="py.bool(value)",
    )
