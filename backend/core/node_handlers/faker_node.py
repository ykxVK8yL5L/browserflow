from __future__ import annotations

from typing import Any
import json
import re

from .common import get_variable_store, resolve_template_value


# Curated safe presets -> faker method names.
# Keep this list small and stable; users can still use custom methodName.
FAKER_PRESETS: dict[str, dict[str, Any]] = {
    "name": {"method": "name", "label": "Full Name"},
    "first_name": {"method": "first_name", "label": "First Name"},
    "last_name": {"method": "last_name", "label": "Last Name"},
    "email": {"method": "email", "label": "Email"},
    "user_name": {"method": "user_name", "label": "Username"},
    "phone_number": {"method": "phone_number", "label": "Phone Number"},
    "address": {"method": "address", "label": "Address"},
    "company": {"method": "company", "label": "Company"},
    "job": {"method": "job", "label": "Job"},
    "ipv4": {"method": "ipv4", "label": "IPv4"},
    "url": {"method": "url", "label": "URL"},
    "uuid4": {"method": "uuid4", "label": "UUID4"},
}


_METHOD_NAME_PATTERN = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


def _validate_method_name(name: str) -> bool:
    # Disallow private/dunder and any non-identifier-ish names.
    if not name:
        return False
    if name.startswith("_"):
        return False
    return bool(_METHOD_NAME_PATTERN.fullmatch(name))


def _coerce_int(value: Any, default: int) -> int:
    if value in (None, ""):
        return default
    try:
        return int(value)
    except Exception:
        return default


def _coerce_bool(value: Any, default: bool = False) -> bool:
    if value in (None, ""):
        return default
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


async def handle_faker_node(
    ctx, data: dict, normalized_node: dict, result, __: Any
) -> None:
    """Faker node — generate fake data via the `Faker` library.

    Design goals:
    - Encapsulated: only allow a single faker method call per node.
    - Extensible: presets + custom method.
    - Safe: no eval; kwargs must be an object (dict).

    Params:
      - preset: optional preset key from FAKER_PRESETS
      - methodName: optional faker method name (e.g. "name", "email")
      - locale: optional locale string (e.g. "zh_CN", "en_US"); empty -> Faker default
      - count: number of items; default 1
      - unique: bool; use faker.unique
      - seed: optional int; seed_instance for reproducibility
      - kwargs: optional dict of keyword args passed to faker method
      - variableName: optional, save result to vars

    Output:
      - result: single value if count==1 else first item
      - items: list of generated values
      - preset/methodName/locale/count/unique/seed
    """

    node_id = normalized_node["id"]

    preset = str(data.get("preset") or "").strip()
    method_name = str(data.get("methodName") or "").strip()
    locale = str(data.get("locale") or "").strip() or None
    count = _coerce_int(data.get("count"), 1)
    unique = _coerce_bool(data.get("unique"), False)
    seed = data.get("seed")
    seed_value = None
    if seed not in (None, ""):
        try:
            seed_value = int(seed)
        except Exception:
            result.status = "failed"
            result.error = "seed must be an integer"
            result.message = "Faker generation failed"
            return

    raw_kwargs = data.get("kwargs")
    variable_name = str(data.get("variableName") or "").strip()

    # Resolve nested templates in key params
    resolved = resolve_template_value(
        {
            "preset": preset,
            "methodName": method_name,
            "locale": locale,
            "count": count,
            "unique": unique,
            "seed": seed_value,
            "kwargs": raw_kwargs,
            "variableName": variable_name,
        },
        ctx.outputs,
    )

    preset = str(resolved.get("preset") or "").strip()
    method_name = str(resolved.get("methodName") or "").strip()
    locale = resolved.get("locale")
    locale = str(locale).strip() if locale not in (None, "") else None
    count = _coerce_int(resolved.get("count"), 1)
    unique = _coerce_bool(resolved.get("unique"), False)
    seed_value = resolved.get("seed")
    seed_value = int(seed_value) if seed_value not in (None, "") else None
    raw_kwargs = resolved.get("kwargs")
    variable_name = str(resolved.get("variableName") or "").strip()

    if preset and preset in FAKER_PRESETS:
        method_name = FAKER_PRESETS[preset]["method"]

    if not method_name:
        result.status = "failed"
        result.error = "Faker node requires preset or methodName"
        result.message = "Faker generation failed"
        return

    if not _validate_method_name(method_name):
        result.status = "failed"
        result.error = f"Invalid faker methodName: {method_name}"
        result.message = "Faker generation failed"
        return

    if count < 1:
        count = 1
    if count > 1000:
        result.status = "failed"
        result.error = "count is too large (max 1000)"
        result.message = "Faker generation failed"
        return

    kwargs: dict[str, Any] = {}
    if raw_kwargs in (None, ""):
        kwargs = {}
    elif isinstance(raw_kwargs, dict):
        kwargs = raw_kwargs
    elif isinstance(raw_kwargs, str):
        try:
            parsed = json.loads(raw_kwargs)
        except Exception as exc:
            result.status = "failed"
            result.error = f"kwargs must be valid JSON object: {exc}"
            result.message = "Faker generation failed"
            return
        if not isinstance(parsed, dict):
            result.status = "failed"
            result.error = "kwargs JSON must be an object"
            result.message = "Faker generation failed"
            return
        kwargs = parsed
    else:
        result.status = "failed"
        result.error = "kwargs must be an object (dict)"
        result.message = "Faker generation failed"
        return

    try:
        from faker import Faker
        from faker.exceptions import UniquenessException

        fake = Faker(locale) if locale else Faker()
        if seed_value is not None:
            fake.seed_instance(seed_value)

        provider = fake.unique if unique else fake

        fn = getattr(provider, method_name, None)
        if fn is None or not callable(fn):
            result.status = "failed"
            result.error = f"Unknown faker method: {method_name}"
            result.message = "Faker generation failed"
            return

        items: list[Any] = []
        for _ in range(max(1, count)):
            try:
                items.append(fn(**kwargs))
            except UniquenessException as exc:
                result.status = "failed"
                result.error = f"Faker unique exhausted: {exc}"
                result.message = "Faker generation failed"
                return

        value: Any = items[0]
        if variable_name:
            store = get_variable_store(ctx.outputs)
            store[variable_name] = items[0] if count == 1 else items
            ctx.locals[variable_name] = store[variable_name]

        result.status = "success"
        result.data = {
            "result": value,
            "items": items,
            "preset": preset or None,
            "methodName": method_name,
            "locale": locale,
            "count": count,
            "unique": unique,
            "seed": seed_value,
            "kwargs": kwargs or None,
            "variableName": variable_name or None,
        }
        ctx.outputs[node_id] = result.data
        result.message = f"Faker generated: {method_name} x{count}"

    except ModuleNotFoundError:
        result.status = "failed"
        result.error = "Faker is not installed on backend"
        result.message = "Faker generation failed"
    except Exception as exc:
        result.status = "failed"
        result.error = str(exc)
        result.message = "Faker generation failed"
