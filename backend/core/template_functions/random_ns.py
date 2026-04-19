from __future__ import annotations

import secrets
import string
import uuid
from typing import Any, Dict

from .registry import TemplateFunctionRegistry, TemplateFunctionError


def _secure_shuffle(items: list[str]) -> list[str]:
    shuffled = list(items)
    for index in range(len(shuffled) - 1, 0, -1):
        swap_index = secrets.randbelow(index + 1)
        shuffled[index], shuffled[swap_index] = shuffled[swap_index], shuffled[index]
    return shuffled


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


def _random_values(kind: str, length: int, count: int) -> Any:
    if count < 1:
        count = 1

    if kind == "uuid":
        values = [str(uuid.uuid4()) for _ in range(count)]
        return values[0] if count == 1 else values

    if length < 1:
        raise TemplateFunctionError("length must be > 0")

    if kind == "alnum":
        alphabet = string.ascii_letters + string.digits
    elif kind == "alpha":
        alphabet = string.ascii_letters
    elif kind == "numeric":
        alphabet = string.digits
    elif kind == "hex":
        alphabet = string.hexdigits.lower()[:16]
    else:
        raise TemplateFunctionError(f"unsupported random kind: {kind}")

    values = [
        "".join(secrets.choice(alphabet) for _ in range(length)) for _ in range(count)
    ]
    return values[0] if count == 1 else values


def _random_password(length: int, count: int, specials: str | None = None) -> Any:
    if length < 1:
        raise TemplateFunctionError("length must be > 0")

    specials = specials or "!@#$%^&*"
    alphabet = string.ascii_letters + string.digits + specials

    values: list[str] = []
    for _ in range(max(1, count)):
        chars = [secrets.choice(specials)]
        chars.extend(secrets.choice(alphabet) for _ in range(max(0, length - 1)))
        values.append("".join(_secure_shuffle(chars)))

    return values[0] if count == 1 else values


def _ms_password(length: int, count: int, specials: str | None = None) -> Any:
    if length < 10:
        raise TemplateFunctionError("length must be >= 10")

    specials = (specials or "@#$%!&*").strip()
    if not specials:
        raise TemplateFunctionError("special chars must not be empty")

    values: list[str] = []
    for _ in range(max(1, count)):
        chars: list[str] = []
        chars.extend(secrets.choice(string.ascii_uppercase) for _ in range(2))
        chars.extend(secrets.choice(string.ascii_lowercase) for _ in range(4))
        chars.extend(secrets.choice(string.digits) for _ in range(3))
        chars.append(secrets.choice(specials))

        remainder = length - 10
        if remainder > 0:
            alphabet = string.ascii_letters + string.digits
            chars.extend(secrets.choice(alphabet) for _ in range(remainder))

        values.append("".join(_secure_shuffle(chars)))

    return values[0] if count == 1 else values


def register(registry: TemplateFunctionRegistry) -> None:
    # random.alnum(length[, count])
    registry.register(
        "random",
        "alnum",
        lambda args, _ctx: _random_values(
            "alnum",
            _require_int(args[0], "length"),
            _require_int(args[1], "count") if len(args) > 1 else 1,
        ),
        description="生成字母+数字随机串",
        signature="random.alnum(length, count=1)",
    )

    registry.register(
        "random",
        "alpha",
        lambda args, _ctx: _random_values(
            "alpha",
            _require_int(args[0], "length"),
            _require_int(args[1], "count") if len(args) > 1 else 1,
        ),
        description="生成纯字母随机串",
        signature="random.alpha(length, count=1)",
    )

    registry.register(
        "random",
        "numeric",
        lambda args, _ctx: _random_values(
            "numeric",
            _require_int(args[0], "length"),
            _require_int(args[1], "count") if len(args) > 1 else 1,
        ),
        description="生成纯数字随机串",
        signature="random.numeric(length, count=1)",
    )

    registry.register(
        "random",
        "hex",
        lambda args, _ctx: _random_values(
            "hex",
            _require_int(args[0], "length"),
            _require_int(args[1], "count") if len(args) > 1 else 1,
        ),
        description="生成十六进制随机串",
        signature="random.hex(length, count=1)",
    )

    # random.password(length[, count][, specials])
    def password_fn(args: list[Any], _ctx: Dict[str, Any]) -> Any:
        if not args:
            raise TemplateFunctionError("random.password requires at least length")
        length = _require_int(args[0], "length")
        count = 1
        specials: str | None = None

        if len(args) >= 2:
            if isinstance(args[1], str):
                specials = args[1]
            else:
                count = _require_int(args[1], "count")
        if len(args) >= 3:
            count = _require_int(args[1], "count")
            specials = _require_str(args[2], "specials")
        if len(args) > 3:
            raise TemplateFunctionError(
                "random.password supports: length, count, specials"
            )

        return _random_password(length, count, specials)

    registry.register(
        "random",
        "password",
        password_fn,
        description="生成带特殊字符的随机密码（至少 1 个特殊字符）",
        signature='random.password(length, count=1, specials="!@#$%^&*")',
    )

    # random.ms_password(length[, count][, specials])
    def ms_password_fn(args: list[Any], _ctx: Dict[str, Any]) -> Any:
        if not args:
            raise TemplateFunctionError("random.ms_password requires at least length")
        length = _require_int(args[0], "length")
        count = 1
        specials: str | None = None

        if len(args) >= 2:
            if isinstance(args[1], str):
                specials = args[1]
            else:
                count = _require_int(args[1], "count")
        if len(args) >= 3:
            count = _require_int(args[1], "count")
            specials = _require_str(args[2], "specials")
        if len(args) > 3:
            raise TemplateFunctionError(
                "random.ms_password supports: length, count, specials"
            )

        return _ms_password(length, count, specials)

    registry.register(
        "random",
        "ms_password",
        ms_password_fn,
        description="生成符合微软复杂度要求的随机密码（大写+小写+数字+特殊字符）",
        signature='random.ms_password(length, count=1, specials="@#$%!&*")',
    )

    # random.uuid([count])
    def uuid_fn(args: list[Any], _ctx: Dict[str, Any]) -> Any:
        count = _require_int(args[0], "count") if args else 1
        return _random_values("uuid", 0, count)

    registry.register(
        "random",
        "uuid",
        uuid_fn,
        description="生成 UUID",
        signature="random.uuid(count=1)",
    )
