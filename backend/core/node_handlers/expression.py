from __future__ import annotations

import ast
from typing import Any

from .common import (
    get_private_store,
    get_variable_store,
    resolve_output_reference_for_eval,
)


class SafeAttrDict(dict):
    def __getattr__(self, name: str) -> Any:
        if name.startswith("__"):
            raise AttributeError(name)
        try:
            return self[name]
        except KeyError as exc:
            raise AttributeError(name) from exc


def _wrap_value(value: Any) -> Any:
    if isinstance(value, SafeAttrDict):
        return value
    if isinstance(value, dict):
        return SafeAttrDict({k: _wrap_value(v) for k, v in value.items()})
    if isinstance(value, list):
        return [_wrap_value(v) for v in value]
    if isinstance(value, tuple):
        return tuple(_wrap_value(v) for v in value)
    if isinstance(value, set):
        return {_wrap_value(v) for v in value}
    return value


SAFE_FUNCTIONS: dict[str, Any] = {
    "len": len,
    "int": int,
    "float": float,
    "str": str,
    "bool": bool,
    "sum": sum,
    "min": min,
    "max": max,
    "sorted": sorted,
    "abs": abs,
    "round": round,
    "list": list,
    "dict": dict,
    "tuple": tuple,
    "set": set,
    "any": any,
    "all": all,
}


def _to_str(value: Any) -> str:
    return "" if value is None else str(value)


def _strip(value: Any, chars: Any = None) -> str:
    text = _to_str(value)
    return text.strip(None if chars is None else str(chars))


def _lstrip(value: Any, chars: Any = None) -> str:
    text = _to_str(value)
    return text.lstrip(None if chars is None else str(chars))


def _rstrip(value: Any, chars: Any = None) -> str:
    text = _to_str(value)
    return text.rstrip(None if chars is None else str(chars))


def _lower(value: Any) -> str:
    return _to_str(value).lower()


def _upper(value: Any) -> str:
    return _to_str(value).upper()


def _title(value: Any) -> str:
    return _to_str(value).title()


def _replace(value: Any, old: Any, new: Any, count: Any = -1) -> str:
    text = _to_str(value)
    return text.replace(str(old), str(new), int(count))


def _split(value: Any, sep: Any = None, maxsplit: Any = -1) -> list[str]:
    text = _to_str(value)
    return text.split(None if sep is None else str(sep), int(maxsplit))


def _join(items: Any, sep: Any = "") -> str:
    if items is None:
        return ""
    if not isinstance(items, (list, tuple, set)):
        raise ValueError("join(items, sep) requires items to be a list/tuple/set")
    return str(sep).join("" if item is None else str(item) for item in items)


def _startswith(value: Any, prefix: Any) -> bool:
    return _to_str(value).startswith(str(prefix))


def _endswith(value: Any, suffix: Any) -> bool:
    return _to_str(value).endswith(str(suffix))


def _contains(container: Any, item: Any) -> bool:
    try:
        return item in container
    except Exception as exc:
        raise ValueError(
            "contains(container, item) requires a container value"
        ) from exc


SAFE_FUNCTIONS.update(
    {
        "strip": _strip,
        "lstrip": _lstrip,
        "rstrip": _rstrip,
        "lower": _lower,
        "upper": _upper,
        "title": _title,
        "replace": _replace,
        "split": _split,
        "join": _join,
        "startswith": _startswith,
        "endswith": _endswith,
        "contains": _contains,
    }
)

SAFE_BIN_OPS = {
    ast.Add: lambda a, b: a + b,
    ast.Sub: lambda a, b: a - b,
    ast.Mult: lambda a, b: a * b,
    ast.Div: lambda a, b: a / b,
    ast.FloorDiv: lambda a, b: a // b,
    ast.Mod: lambda a, b: a % b,
    ast.Pow: lambda a, b: a**b,
}

SAFE_UNARY_OPS = {
    ast.UAdd: lambda a: +a,
    ast.USub: lambda a: -a,
    ast.Not: lambda a: not a,
}

SAFE_COMPARE_OPS = {
    ast.Eq: lambda a, b: a == b,
    ast.NotEq: lambda a, b: a != b,
    ast.Lt: lambda a, b: a < b,
    ast.LtE: lambda a, b: a <= b,
    ast.Gt: lambda a, b: a > b,
    ast.GtE: lambda a, b: a >= b,
    ast.In: lambda a, b: a in b,
    ast.NotIn: lambda a, b: a not in b,
    ast.Is: lambda a, b: a is b,
    ast.IsNot: lambda a, b: a is not b,
}


class SafeExpressionEvaluator:
    def __init__(self, context: dict[str, Any]) -> None:
        self.context = context

    def evaluate(self, expression: str) -> Any:
        tree = ast.parse(expression, mode="eval")
        return self._eval(tree)

    def _eval(self, node: ast.AST) -> Any:
        if isinstance(node, ast.Expression):
            return self._eval(node.body)

        if isinstance(node, ast.Constant):
            return node.value

        if isinstance(node, ast.Name):
            if node.id in self.context:
                return self.context[node.id]
            raise ValueError(f"Unknown name: {node.id}")

        if isinstance(node, ast.List):
            return [self._eval(elt) for elt in node.elts]

        if isinstance(node, ast.Tuple):
            return tuple(self._eval(elt) for elt in node.elts)

        if isinstance(node, ast.Set):
            return {self._eval(elt) for elt in node.elts}

        if isinstance(node, ast.Dict):
            return {
                self._eval(key): self._eval(value)
                for key, value in zip(node.keys, node.values)
            }

        if isinstance(node, ast.BinOp):
            op_type = type(node.op)
            handler = SAFE_BIN_OPS.get(op_type)
            if handler is None:
                raise ValueError(f"Unsupported binary operator: {op_type.__name__}")
            return handler(self._eval(node.left), self._eval(node.right))

        if isinstance(node, ast.UnaryOp):
            op_type = type(node.op)
            handler = SAFE_UNARY_OPS.get(op_type)
            if handler is None:
                raise ValueError(f"Unsupported unary operator: {op_type.__name__}")
            return handler(self._eval(node.operand))

        if isinstance(node, ast.BoolOp):
            if isinstance(node.op, ast.And):
                result = self._eval(node.values[0])
                for value in node.values[1:]:
                    if not result:
                        return result
                    result = self._eval(value)
                return result
            if isinstance(node.op, ast.Or):
                result = self._eval(node.values[0])
                for value in node.values[1:]:
                    if result:
                        return result
                    result = self._eval(value)
                return result
            raise ValueError(f"Unsupported boolean operator: {type(node.op).__name__}")

        if isinstance(node, ast.Compare):
            left = self._eval(node.left)
            for op, comparator in zip(node.ops, node.comparators):
                op_type = type(op)
                handler = SAFE_COMPARE_OPS.get(op_type)
                if handler is None:
                    raise ValueError(
                        f"Unsupported compare operator: {op_type.__name__}"
                    )
                right = self._eval(comparator)
                if not handler(left, right):
                    return False
                left = right
            return True

        if isinstance(node, ast.IfExp):
            return (
                self._eval(node.body)
                if self._eval(node.test)
                else self._eval(node.orelse)
            )

        if isinstance(node, ast.Call):
            if not isinstance(node.func, ast.Name):
                raise ValueError("Only direct function calls are allowed")
            fn_name = node.func.id
            fn = SAFE_FUNCTIONS.get(fn_name)
            if fn is None:
                raise ValueError(f"Unsupported function: {fn_name}")
            args = [self._eval(arg) for arg in node.args]
            kwargs = {kw.arg: self._eval(kw.value) for kw in node.keywords if kw.arg}
            return fn(*args, **kwargs)

        if isinstance(node, ast.Subscript):
            value = self._eval(node.value)
            if isinstance(node.slice, ast.Slice):
                lower = (
                    self._eval(node.slice.lower)
                    if node.slice.lower is not None
                    else None
                )
                upper = (
                    self._eval(node.slice.upper)
                    if node.slice.upper is not None
                    else None
                )
                step = (
                    self._eval(node.slice.step) if node.slice.step is not None else None
                )
                return value[slice(lower, upper, step)]
            return value[self._eval(node.slice)]

        if isinstance(node, ast.Attribute):
            value = self._eval(node.value)
            attr = node.attr
            if attr.startswith("__"):
                raise ValueError("Dunder attribute access is not allowed")
            if isinstance(value, dict):
                if attr in value:
                    return value[attr]
                raise ValueError(f"Unknown attribute: {attr}")
            raise ValueError("Attribute access is only allowed on object-like values")

        raise ValueError(f"Unsupported expression node: {type(node).__name__}")


def _build_expression_context(ctx, normalized_node: dict) -> dict[str, Any]:
    outputs = ctx.outputs
    variable_store = get_variable_store(outputs)
    private_store = get_private_store(outputs)
    resolved_inputs = normalized_node.get("resolved_inputs", {}) or {}

    context: dict[str, Any] = {
        "vars": _wrap_value(variable_store),
        "private": _wrap_value(private_store),
        "True": True,
        "False": False,
        "None": None,
    }

    for key, value in variable_store.items():
        if isinstance(key, str) and key.isidentifier() and key not in context:
            context[key] = _wrap_value(value)

    for key, value in resolved_inputs.items():
        if isinstance(key, str) and key.isidentifier() and key not in context:
            context[key] = _wrap_value(value)

    for key, value in outputs.items():
        if not isinstance(key, str) or not key.isidentifier() or key.startswith("__"):
            continue
        if key in context:
            continue
        context[key] = _wrap_value(value)

    return context


async def handle_expression_node(
    ctx, data: dict, normalized_node: dict, result, __: Any
) -> None:
    expression = str(data.get("expression") or "").strip()
    variable_name = str(data.get("variableName") or "").strip()
    node_id = normalized_node["id"]

    if not expression:
        result.status = "skipped"
        result.message = "No expression provided"
        return

    resolved_expression = resolve_output_reference_for_eval(expression, ctx.outputs)
    evaluator = SafeExpressionEvaluator(_build_expression_context(ctx, normalized_node))

    try:
        out = evaluator.evaluate(resolved_expression)
    except Exception as exc:
        result.status = "failed"
        result.error = str(exc)
        result.message = "Expression evaluation failed"
        return

    if variable_name:
        store = get_variable_store(ctx.outputs)
        store[variable_name] = out
        ctx.locals[variable_name] = out

    result.status = "success"
    result.data = {
        "result": out,
        "expression": expression,
        "resolvedExpression": resolved_expression,
        "variableName": variable_name or None,
    }
    ctx.outputs[node_id] = result.data
    result.message = f"Expression evaluated: {expression}"
