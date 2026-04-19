from __future__ import annotations

import json
import re
from typing import Any, Dict

from .registry import TemplateFunctionRegistry, TemplateFunctionError

# Keep this mapping consistent with the Faker node presets.
FAKER_PRESETS: dict[str, str] = {
    "name": "name",
    "first_name": "first_name",
    "last_name": "last_name",
    "email": "email",
    "user_name": "user_name",
    "phone_number": "phone_number",
    "address": "address",
    "company": "company",
    "job": "job",
    "ipv4": "ipv4",
    "url": "url",
    "uuid4": "uuid4",
}

_METHOD_NAME_PATTERN = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


def _validate_method_name(name: str) -> bool:
    if not name:
        return False
    # Disallow private/dunder.
    if name.startswith("_"):
        return False
    return bool(_METHOD_NAME_PATTERN.fullmatch(name))


def _coerce_int(value: Any, name: str) -> int:
    try:
        return int(value)
    except Exception as exc:
        raise TemplateFunctionError(f"{name} must be an integer") from exc


def _coerce_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


def _coerce_kwargs(value: Any) -> dict[str, Any]:
    if value in (None, ""):
        return {}
    if isinstance(value, dict):
        return value
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
        except Exception as exc:
            raise TemplateFunctionError(f"kwargs must be a JSON object: {exc}") from exc
        if not isinstance(parsed, dict):
            raise TemplateFunctionError("kwargs JSON must be an object")
        return parsed
    raise TemplateFunctionError("kwargs must be an object (dict) or JSON string")


def _faker_generate(
    method: str,
    *,
    count: int = 1,
    locale: str | None = None,
    unique: bool = False,
    seed: int | None = None,
    kwargs: dict[str, Any] | None = None,
) -> Any:
    try:
        from faker import Faker
        from faker.exceptions import UniquenessException
    except ModuleNotFoundError as exc:
        raise TemplateFunctionError("Faker is not installed on backend") from exc

    if not _validate_method_name(method):
        raise TemplateFunctionError(f"Invalid faker methodName: {method}")

    if count < 1:
        count = 1
    if count > 1000:
        raise TemplateFunctionError("count is too large (max 1000)")

    fake = Faker(locale) if locale else Faker()
    if seed is not None:
        fake.seed_instance(seed)

    provider = fake.unique if unique else fake
    fn = getattr(provider, method, None)
    if fn is None or not callable(fn):
        raise TemplateFunctionError(f"Unknown faker method: {method}")

    items: list[Any] = []
    for _ in range(count):
        try:
            items.append(fn(**(kwargs or {})))
        except UniquenessException as exc:
            raise TemplateFunctionError(f"Faker unique exhausted: {exc}") from exc

    return items[0] if count == 1 else items


def register(registry: TemplateFunctionRegistry) -> None:
    # faker.call(method, count=1, locale=None, unique=false, seed=None, kwargs=None)
    def faker_call_fn(args: list[Any], _ctx: Dict[str, Any]) -> Any:
        if not args:
            raise TemplateFunctionError("faker.call requires at least method name")

        method = str(args[0]).strip()
        count = (
            _coerce_int(args[1], "count")
            if len(args) > 1 and args[1] not in (None, "")
            else 1
        )
        locale = (
            str(args[2]).strip()
            if len(args) > 2 and args[2] not in (None, "")
            else None
        )
        unique = (
            _coerce_bool(args[3])
            if len(args) > 3 and args[3] not in (None, "")
            else False
        )
        seed = (
            _coerce_int(args[4], "seed")
            if len(args) > 4 and args[4] not in (None, "")
            else None
        )
        kwargs = _coerce_kwargs(args[5]) if len(args) > 5 else {}

        if len(args) > 6:
            raise TemplateFunctionError(
                "faker.call supports: method, count, locale, unique, seed, kwargs"
            )

        return _faker_generate(
            method,
            count=count,
            locale=locale,
            unique=unique,
            seed=seed,
            kwargs=kwargs,
        )

    registry.register(
        "faker",
        "call",
        faker_call_fn,
        description="调用 Faker 生成假数据（method 由参数指定）",
        signature='faker.call("email", count=1, locale=None, unique=false, seed=None, kwargs=None)',
    )

    # faker.preset(preset, count=1, locale=None, unique=false, seed=None, kwargs=None)
    def faker_preset_fn(args: list[Any], _ctx: Dict[str, Any]) -> Any:
        if not args:
            raise TemplateFunctionError("faker.preset requires preset key")

        preset = str(args[0]).strip()
        method = FAKER_PRESETS.get(preset)
        if not method:
            raise TemplateFunctionError(f"Unknown faker preset: {preset}")

        forwarded = [method, *args[1:]]
        return faker_call_fn(forwarded, _ctx)

    registry.register(
        "faker",
        "preset",
        faker_preset_fn,
        description="使用内置 preset 调用 Faker 生成假数据",
        signature='faker.preset("email", count=1, locale=None, unique=false, seed=None, kwargs=None)',
    )
