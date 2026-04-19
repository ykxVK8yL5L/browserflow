from __future__ import annotations

from typing import Any

from .common import get_variable_store, resolve_template_value
from core.template_functions.registry import TemplateFunctionError


async def handle_transform_node(
    ctx, data: dict, normalized_node: dict, result, __: Any
) -> None:
    """Transform node — apply a built-in template function to a value.

    This is the workflow-level counterpart to `${ns.fn(...)}`.

    Params:
      - fn: "namespace.name" (e.g. "json.parse", "json.dumps", "time.now")
      - args: list (optional) additional arguments, after the input value
      - variableName: optional, save result to vars

    Inputs:
      - value: the primary input value

    Output:
      - result: transformed value
    """

    node_id = normalized_node["id"]
    resolved_inputs = normalized_node.get("resolved_inputs", {}) or {}

    fn_text = str(data.get("fn") or "").strip()
    raw_args = data.get("args")
    variable_name = str(data.get("variableName") or "").strip()

    value = resolved_inputs.get("value")
    if value is None and "value" in data:
        value = data.get("value")

    args_list: list[Any]
    if raw_args in (None, ""):
        args_list = []
    elif isinstance(raw_args, list):
        # UI list items are objects like { arg: "..." }
        flattened: list[Any] = []
        for item in raw_args:
            if isinstance(item, dict) and "arg" in item:
                flattened.append(item.get("arg"))
            else:
                flattened.append(item)
        args_list = flattened
    else:
        # allow a single literal/string
        args_list = [raw_args]

    # Ensure nested templates inside args are resolved
    args_list = resolve_template_value(args_list, ctx.outputs)

    if not fn_text or "." not in fn_text:
        result.status = "failed"
        result.error = "Transform node requires fn like 'json.parse'"
        result.message = "Transform failed"
        return

    namespace, name = fn_text.split(".", 1)

    # Lazy-load registry from common
    from .common import ensure_template_functions_loaded

    registry = ensure_template_functions_loaded()

    entry = registry.get(namespace, name)
    if entry is None:
        result.status = "failed"
        result.error = f"Unknown transform fn: {fn_text}"
        result.message = "Transform failed"
        return

    try:
        out = registry.call(namespace, name, [value, *args_list], outputs=ctx.outputs)
    except TemplateFunctionError as exc:
        result.status = "failed"
        result.error = str(exc)
        result.message = "Transform failed"
        return
    except Exception as exc:
        result.status = "failed"
        result.error = str(exc)
        result.message = "Transform failed"
        return

    if variable_name:
        store = get_variable_store(ctx.outputs)
        store[variable_name] = out
        ctx.locals[variable_name] = out

    result.status = "success"
    result.data = {
        "result": out,
        "fn": fn_text,
        "args": args_list,
        "variableName": variable_name or None,
    }
    ctx.outputs[node_id] = result.data
    result.message = f"Transform applied: {fn_text}"
