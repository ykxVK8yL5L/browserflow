from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Dict

from .registry import TemplateFunctionRegistry, TemplateFunctionError


def _require_int(value: Any, name: str) -> int:
    try:
        return int(value)
    except Exception as exc:
        raise TemplateFunctionError(f"{name} must be an integer") from exc


def _require_str(value: Any, name: str) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    return str(value)


def register(registry: TemplateFunctionRegistry) -> None:
    # time.now([tz]) -> ISO string
    def now_fn(args: list[Any], _ctx: Dict[str, Any]) -> str:
        tz = _require_str(args[0], "tz") if args else "local"
        if tz.lower() in {"utc", "z"}:
            return datetime.now(timezone.utc).isoformat()
        return datetime.now().isoformat()

    registry.register(
        "time",
        "now",
        now_fn,
        description="返回当前时间（ISO8601 字符串）",
        signature='time.now(tz="local"|"utc")',
    )

    # time.epoch_ms() -> int
    def epoch_ms_fn(_args: list[Any], _ctx: Dict[str, Any]) -> int:
        return int(datetime.now(timezone.utc).timestamp() * 1000)

    registry.register(
        "time",
        "epoch_ms",
        epoch_ms_fn,
        description="返回当前 UTC epoch 毫秒数",
        signature="time.epoch_ms()",
    )

    # time.format(iso_or_epoch_ms, fmt) -> string
    def format_fn(args: list[Any], _ctx: Dict[str, Any]) -> str:
        if len(args) < 2:
            raise TemplateFunctionError("time.format requires (value, fmt)")
        value = args[0]
        fmt = _require_str(args[1], "fmt")

        dt: datetime
        if isinstance(value, (int, float)) or (
            isinstance(value, str) and value.strip().isdigit()
        ):
            ms = int(value)
            dt = datetime.fromtimestamp(ms / 1000, tz=timezone.utc)
        else:
            dt = datetime.fromisoformat(_require_str(value, "value"))
        return dt.strftime(fmt)

    registry.register(
        "time",
        "format",
        format_fn,
        description="格式化时间（支持 ISO 字符串或 epoch 毫秒）",
        signature='time.format(value, fmt="%Y-%m-%d")',
    )

    # time.add_ms(iso_or_epoch_ms, delta_ms) -> ISO string
    def add_ms_fn(args: list[Any], _ctx: Dict[str, Any]) -> str:
        if len(args) < 2:
            raise TemplateFunctionError("time.add_ms requires (value, delta_ms)")
        value = args[0]
        delta_ms = _require_int(args[1], "delta_ms")

        if isinstance(value, (int, float)) or (
            isinstance(value, str) and value.strip().isdigit()
        ):
            base = datetime.fromtimestamp(int(value) / 1000, tz=timezone.utc)
        else:
            base = datetime.fromisoformat(_require_str(value, "value"))

        return (base + timedelta(milliseconds=delta_ms)).isoformat()

    registry.register(
        "time",
        "add_ms",
        add_ms_fn,
        description="在时间上加/减毫秒（返回 ISO 字符串）",
        signature="time.add_ms(value, delta_ms)",
    )
