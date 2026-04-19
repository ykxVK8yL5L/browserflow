from __future__ import annotations

import re
import secrets
import string
from types import SimpleNamespace
from typing import Any
import uuid

from .common import (
    build_locator,
    get_variable_store,
    resolve_locator_target,
    resolve_output_reference,
    resolve_output_reference_for_eval,
)


def _parse_variable_literal(raw_value: Any, value_type: str | None) -> Any:
    if value_type in {None, "auto"}:
        return raw_value
    if value_type == "string":
        return "" if raw_value is None else str(raw_value)
    if value_type == "number":
        if raw_value in (None, ""):
            return 0
        if isinstance(raw_value, (int, float)):
            return raw_value
        text = str(raw_value).strip()
        # 支持简单算术表达式
        try:
            # 先尝试直接转换
            if "." in text:
                return float(text)
            return int(text)
        except ValueError:
            # 尝试计算简单表达式（仅支持 + - * / ** 和数字）
            try:
                # 安全检查：只允许数字、运算符、空格、小数点、负号
                import re

                if re.match(r"^[\d\s\+\-\*\/\.\(\)]+$", text):
                    result = eval(text, {"__builtins__": None}, {})
                    if isinstance(result, (int, float)):
                        return result
            except Exception:
                pass
            raise ValueError(
                f"Cannot parse '{text}' as number. Use a numeric value or simple expression like '1+1'"
            )
    if value_type == "boolean":
        if isinstance(raw_value, bool):
            return raw_value
        return str(raw_value).strip().lower() in {"1", "true", "yes", "on"}
    if value_type == "array":
        if isinstance(raw_value, list):
            return raw_value
        if raw_value in (None, ""):
            return []
        if isinstance(raw_value, str):
            return eval(
                raw_value.replace("null", "None")
                .replace("true", "True")
                .replace("false", "False"),
                {"__builtins__": None},
                {},
            )
        return [raw_value]
    if value_type == "object":
        if isinstance(raw_value, dict):
            return raw_value
        if raw_value in (None, ""):
            return {}
        if isinstance(raw_value, str):
            return eval(
                raw_value.replace("null", "None")
                .replace("true", "True")
                .replace("false", "False"),
                {"__builtins__": None},
                {},
            )
        return {"value": raw_value}
    if value_type == "null":
        return None
    return raw_value


def _clone_variable_value(value: Any) -> Any:
    if isinstance(value, dict):
        return {k: _clone_variable_value(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_clone_variable_value(v) for v in value]
    return value


def _secure_shuffle(items: list[str]) -> list[str]:
    shuffled = list(items)
    for index in range(len(shuffled) - 1, 0, -1):
        swap_index = secrets.randbelow(index + 1)
        shuffled[index], shuffled[swap_index] = shuffled[swap_index], shuffled[index]
    return shuffled


def _generate_random_password(length: int, count: int, special_chars: str) -> list[str]:
    if length < 1:
        raise ValueError("Password length must be greater than 0")

    specials = special_chars or "!@#$%^&*"
    base_alphabet = string.ascii_letters + string.digits
    alphabet = base_alphabet + specials

    values: list[str] = []
    for _ in range(count):
        chars = [secrets.choice(specials)]
        chars.extend(secrets.choice(alphabet) for _ in range(max(0, length - 1)))
        values.append("".join(_secure_shuffle(chars)))
    return values


def _generate_ms_password(
    length: int, count: int, special_chars: str | None = None
) -> list[str]:
    """生成符合微软常见复杂度要求的随机密码。

    规则（默认）：
    - 至少 2 个大写字母
    - 至少 4 个小写字母
    - 至少 3 个数字
    - 至少 1 个特殊字符（默认集合："@#$%!&*"）
    - 其余位从字母+数字中补齐
    """

    if length < 10:
        raise ValueError("MS password length must be >= 10")

    specials = (special_chars or "@#$%!&*").strip()
    if not specials:
        raise ValueError("MS password specialChars must not be empty")

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

    return values


def _generate_random_node_values(
    kind: str,
    length: int | None,
    count: int,
    min_value: int | None = None,
    max_value: int | None = None,
    special_chars: str | None = None,
) -> list[Any]:
    count = max(1, int(count or 1))

    if kind == "uuid":
        return [str(uuid.uuid4()) for _ in range(count)]

    if kind == "numeric" and min_value is not None and max_value is not None:
        if min_value > max_value:
            raise ValueError("Random node requires min <= max")
        return [
            secrets.randbelow(max_value - min_value + 1) + min_value
            for _ in range(count)
        ]

    if length is None or int(length) < 1:
        raise ValueError("Random node requires length > 0")

    length = int(length)
    if kind == "alnum":
        alphabet = string.ascii_letters + string.digits
    elif kind == "alpha":
        alphabet = string.ascii_letters
    elif kind == "numeric":
        alphabet = string.digits
    elif kind == "hex":
        alphabet = string.hexdigits.lower()[:16]
    elif kind == "password":
        return _generate_random_password(length, count, special_chars or "!@#$%^&*")
    elif kind == "ms_password":
        return _generate_ms_password(length, count, special_chars)
    else:
        raise ValueError(f"Unsupported random kind: {kind}")

    return [
        "".join(secrets.choice(alphabet) for _ in range(length)) for _ in range(count)
    ]


async def handle_set_variable_node(
    ctx, data: dict, normalized_node: dict, result, __: Any
) -> None:
    variable_name = (data.get("variableName") or "").strip()
    operation = (data.get("operation") or "set").strip()
    value_type = (data.get("valueType") or "auto").strip()

    if not variable_name:
        result.status = "skipped"
        result.message = "No variable name provided"
        return

    resolved_inputs = normalized_node.get("resolved_inputs", {}) or {}
    raw_value = resolved_inputs.get("value")
    if raw_value is None:
        raw_value = data.get("value")

    parsed_value = _parse_variable_literal(raw_value, value_type)
    variable_store = get_variable_store(ctx.outputs)
    current_value = variable_store.get(variable_name)

    if operation == "set":
        next_value = _clone_variable_value(parsed_value)
    elif operation == "append":
        base_list = current_value if isinstance(current_value, list) else []
        next_value = list(base_list)
        if isinstance(parsed_value, list):
            next_value.extend(_clone_variable_value(parsed_value))
        else:
            next_value.append(_clone_variable_value(parsed_value))
    elif operation == "merge":
        base_dict = current_value if isinstance(current_value, dict) else {}
        if not isinstance(parsed_value, dict):
            result.status = "failed"
            result.error = "Merge operation requires object value"
            result.message = "Set variable merge failed"
            return
        next_value = {**base_dict, **_clone_variable_value(parsed_value)}
    elif operation == "clear":
        if isinstance(current_value, list):
            next_value = []
        elif isinstance(current_value, dict):
            next_value = {}
        else:
            next_value = None
    else:
        result.status = "failed"
        result.error = f"Unsupported variable operation: {operation}"
        result.message = "Set variable failed"
        return

    variable_store[variable_name] = next_value
    ctx.locals[variable_name] = next_value

    if next_value is None:
        preview = "null"
    elif isinstance(next_value, str):
        preview = next_value
    elif isinstance(next_value, (int, float, bool)):
        preview = str(next_value)
    elif isinstance(next_value, (dict, list, tuple)):
        try:
            preview = json.dumps(next_value, ensure_ascii=False)
        except Exception:
            preview = f"<{type(next_value).__name__}>"
    else:
        preview = f"<{type(next_value).__name__}>"

    if len(preview) > 120:
        preview = preview[:117] + "..."

    node_id = normalized_node["id"]
    result.data = {
        "result": next_value,
        "variableName": variable_name,
        "operation": operation,
        "value": next_value,
    }
    ctx.outputs[node_id] = result.data
    if operation == "set":
        result.message = f"Set '{variable_name}' = {preview}"
    elif operation == "append":
        result.message = f"Appended to '{variable_name}': {preview}"
    elif operation == "merge":
        result.message = f"Merged into '{variable_name}': {preview}"
    elif operation == "clear":
        result.message = f"Cleared '{variable_name}'"
    else:
        result.message = (
            f"Variable '{variable_name}' updated with operation '{operation}'"
        )


async def handle_random_node(
    ctx, data: dict, normalized_node: dict, result, __: Any
) -> None:
    kind = str(data.get("kind") or "alnum").strip().lower()
    raw_length = data.get("length")
    raw_count = data.get("count")
    raw_min = data.get("min")
    raw_max = data.get("max")
    special_chars = str(data.get("specialChars") or "").strip()
    variable_name = str(data.get("variableName") or "").strip()
    node_id = normalized_node["id"]

    try:
        length = None if raw_length in (None, "") else int(raw_length)
        count = 1 if raw_count in (None, "") else int(raw_count)
        min_value = None if raw_min in (None, "") else int(raw_min)
        max_value = None if raw_max in (None, "") else int(raw_max)
    except (TypeError, ValueError) as exc:
        result.status = "failed"
        result.error = f"Invalid random node params: {exc}"
        result.message = "Random generation failed"
        return

    if kind == "numeric" and ((min_value is None) ^ (max_value is None)):
        result.status = "failed"
        result.error = "Numeric range requires both min and max"
        result.message = "Random generation failed"
        return

    try:
        items = _generate_random_node_values(
            kind,
            length,
            count,
            min_value=min_value,
            max_value=max_value,
            special_chars=special_chars,
        )
    except Exception as exc:
        result.status = "failed"
        result.error = str(exc)
        result.message = "Random generation failed"
        return

    value: Any = items[0] if count == 1 else items
    if variable_name:
        variable_store = get_variable_store(ctx.outputs)
        variable_store[variable_name] = _clone_variable_value(value)
        ctx.locals[variable_name] = _clone_variable_value(value)

    result.data = {
        "result": value,
        "items": items,
        "kind": kind,
        "length": length,
        "count": count,
        "min": min_value,
        "max": max_value,
        "specialChars": special_chars or None,
        "variableName": variable_name or None,
    }
    ctx.outputs[node_id] = result.data
    result.message = (
        f"Generated {count} random {kind} value"
        if count == 1
        else f"Generated {count} random {kind} values"
    )


def _normalize_map_expression(expression: str, item_name: str) -> str:
    expr = (expression or "").strip()
    if not expr:
        return item_name

    if "=>" in expr:
        left, right = expr.split("=>", 1)
        param = left.strip().strip("()") or item_name
        body = right.strip()

        if body.startswith("{") and body.endswith("}"):
            inner = body[1:-1].strip()
            if inner.startswith("return "):
                body = inner[7:].strip()
                if body.endswith(";"):
                    body = body[:-1].strip()

        if param and param != item_name:
            body = body.replace(f"{param}?.", f"{item_name}?.")
            body = body.replace(f"{param}.", f"{item_name}.")
            body = body.replace(f"{param}[", f"{item_name}[")
            if body == param:
                body = item_name

        expr = body or item_name

    expr = expr.replace("?.", ".")
    expr = expr.replace("??", " or ")
    expr = _normalize_map_object_literal(expr)
    return (
        expr.replace("null", "None").replace("true", "True").replace("false", "False")
    )


def _normalize_map_object_literal(expression: str) -> str:
    expr = expression.strip()
    if not expr:
        return expr

    if expr.startswith("(") and expr.endswith(")"):
        inner = expr[1:-1].strip()
        if inner.startswith("{") and inner.endswith("}"):
            expr = inner

    if not (expr.startswith("{") and expr.endswith("}")):
        return expr

    body = expr[1:-1].strip()
    if not body:
        return "{}"

    parts: list[str] = []
    current: list[str] = []
    depth = 0
    in_string = False
    string_char = ""

    for char in body:
        if in_string:
            current.append(char)
            if char == string_char:
                in_string = False
            continue

        if char in {'"', "'"}:
            in_string = True
            string_char = char
            current.append(char)
            continue

        if char in "([{":
            depth += 1
        elif char in ")]}":
            depth -= 1

        if char == "," and depth == 0:
            parts.append("".join(current).strip())
            current = []
            continue

        current.append(char)

    if current:
        parts.append("".join(current).strip())

    normalized_parts: list[str] = []
    for part in parts:
        if not part:
            continue
        if ":" not in part:
            shorthand_key = part.strip()
            if shorthand_key:
                normalized_parts.append(f'"{shorthand_key}": {shorthand_key}')
            continue

        key, value = part.split(":", 1)
        key = key.strip()
        value = value.strip()

        if not re.match(r'^["\"]|^[\']', key):
            key = f'"{key}"'

        normalized_parts.append(f"{key}: {value}")

    return "{" + ", ".join(normalized_parts) + "}"


def _wrap_map_value(value: Any) -> Any:
    if isinstance(value, dict):
        return SimpleNamespace(
            **{key: _wrap_map_value(val) for key, val in value.items()}
        )
    if isinstance(value, list):
        return [_wrap_map_value(item) for item in value]
    return value


def _coerce_if_compare_value(value: Any, value_type: str | None) -> Any:
    if value is None:
        return None

    normalized_type = (value_type or "auto").strip()

    # Auto 类型：自动检测
    if normalized_type == "auto":
        if isinstance(value, bool):
            return value
        if isinstance(value, (int, float)):
            return value
        if isinstance(value, dict) or isinstance(value, list):
            return value
        # 字符串类型，尝试自动转换
        text = str(value).strip()
        if text == "":
            return ""
        # 尝试解析为数字
        try:
            if "." in text:
                return float(text)
            return int(text)
        except ValueError:
            pass
        # 尝试解析为布尔值
        if text.lower() in {"true", "yes", "on", "1"}:
            return True
        if text.lower() in {"false", "no", "off", "0"}:
            return False
        # 尝试解析为 JSON
        if text.startswith("{") or text.startswith("["):
            try:
                return eval(
                    text.replace("null", "None")
                    .replace("true", "True")
                    .replace("false", "False"),
                    {"__builtins__": None},
                    {},
                )
            except Exception:
                pass
        # 默认返回字符串
        return text

    if normalized_type == "string":
        return str(value)
    if normalized_type == "number":
        if isinstance(value, (int, float)):
            return value
        text = str(value).strip()
        return float(text) if "." in text else int(text)
    if normalized_type == "boolean":
        if isinstance(value, bool):
            return value
        text = str(value).strip().lower()
        return text in {"1", "true", "yes", "on"}
    if normalized_type == "null":
        return None
    if normalized_type == "json":
        return eval(
            str(value)
            .replace("null", "None")
            .replace("true", "True")
            .replace("false", "False"),
            {"__builtins__": None},
            {},
        )
    return value


def evaluate_condition_config(
    ctx: Any,
    data: dict,
    resolved_inputs: dict | None = None,
    raw_condition: str | None = None,
) -> dict:
    resolved_inputs = resolved_inputs or {}
    input_condition = resolved_inputs.get("condition")
    operator = data.get("operator")
    condition_expr = (
        raw_condition if raw_condition is not None else data.get("condition", "")
    )
    # 只有当 condition_expr 不是默认的 "True" 时才认为有表达式
    has_expression = (
        isinstance(condition_expr, str)
        and condition_expr.strip() != ""
        and condition_expr.strip().lower() != "true"
    )

    # 左值：优先使用 input 引用，其次使用 leftValue 字段
    left_value = data.get("leftValue")
    left_value_type = data.get("leftValueType", "auto")

    # 右值
    compare_value = data.get("value")
    compare_value_type = data.get("valueType", "auto")

    # 当 leftValue 有值时，优先使用 operator 模式
    use_operator_mode = operator and (
        left_value is not None and left_value != "" or input_condition is not None
    )

    if use_operator_mode and not has_expression:
        # 确定左值：input 引用 > leftValue 字段 > variable_store 查找
        variable_store = get_variable_store(ctx.outputs)
        if input_condition is not None:
            left = input_condition
        elif left_value is not None and left_value != "":
            # 检查是否是模板引用 ${varName}
            if (
                isinstance(left_value, str)
                and left_value.startswith("${")
                and left_value.endswith("}")
            ):
                # 提取变量名 ${test} -> test
                var_name = left_value[2:-1].strip()
                if var_name in variable_store:
                    left = variable_store[var_name]
                else:
                    # 变量不存在，回退到 expression 模式
                    left = None
            elif isinstance(left_value, str) and left_value in variable_store:
                # 变量名存在于 variable_store
                left = variable_store[left_value]
            elif isinstance(left_value, str) and not left_value.startswith("${"):
                # 可能是变量名但不存在，回退到 expression 模式
                left = None
            else:
                left = _coerce_if_compare_value(left_value, left_value_type)
        else:
            left = None

        # 如果左值为空，回退到 expression 模式
        if left is None:
            # 回退到 expression 模式
            pass
        else:
            right = _coerce_if_compare_value(compare_value, compare_value_type)
            operations = {
                "==": lambda a, b: a == b,
                "!=": lambda a, b: a != b,
                ">": lambda a, b: a > b,
                ">=": lambda a, b: a >= b,
                "<": lambda a, b: a < b,
                "<=": lambda a, b: a <= b,
                "contains": lambda a, b: b in a if a is not None else False,
                "not_contains": lambda a, b: b not in a if a is not None else True,
                "truthy": lambda a, _b: bool(a),
                "falsy": lambda a, _b: not bool(a),
            }

            if operator not in operations:
                raise ValueError(f"Unsupported if operator: {operator}")

            result = operations[operator](left, right)
            return {
                "result": bool(result),
                "mode": "operator",
                "condition": left,
                "operator": operator,
                "value": right,
                "valueType": compare_value_type or "auto",
            }

    if not condition_expr or condition_expr.strip() == "":
        condition_expr = "True"
    resolved_expr = resolve_output_reference_for_eval(condition_expr, ctx.outputs)
    safe_builtins = {
        "abs": abs,
        "float": float,
        "int": int,
        "str": str,
        "len": len,
        "bool": bool,
        "max": max,
        "min": min,
        "round": round,
        "sum": sum,
        "true": True,
        "false": False,
    }
    # 合并 variable_store 到 locals，确保循环条件能看到变量更新
    variable_store = get_variable_store(ctx.outputs)
    safe_locals = {**ctx.locals, **variable_store}
    result = eval(resolved_expr, {"__builtins__": None, **safe_builtins}, safe_locals)
    return {
        "result": bool(result),
        "mode": "expression",
        "expression": resolved_expr,
    }


async def handle_foreach_node(
    ctx, data: dict, normalized_node: dict, result, __: Any
) -> None:
    resolved_inputs = normalized_node.get("resolved_inputs", {}) or {}
    items = resolved_inputs.get("items")
    item_name = data.get("itemName") or "item"

    if items is None:
        result.status = "skipped"
        result.message = "No items input configured"
        result.data = {"items": [], "itemName": item_name, "count": 0}
        return

    if not isinstance(items, list):
        items = [items]

    node_id = normalized_node["id"]
    result.data = {
        "items": items,
        "itemName": item_name,
        "count": len(items),
        "result": items,
    }
    ctx.outputs[node_id] = result.data
    result.message = f"Foreach prepared {len(items)} item(s) as '{item_name}'"


def _coerce_loop_number(raw_value: Any, default: int) -> int:
    if raw_value in (None, ""):
        return default
    if isinstance(raw_value, (int, float)):
        return int(raw_value)
    text = str(raw_value).strip()
    return int(float(text))


async def handle_while_node(
    ctx, data: dict, normalized_node: dict, result, __: Any
) -> None:
    node_id = normalized_node["id"]
    max_iterations = _coerce_loop_number(data.get("maxIterations"), 1000)
    # 从 raw_data 或 raw.params 获取原始的 leftValue（未解析模板）
    raw_data = normalized_node.get("raw_data", {})
    raw_params = raw_data.get("params", {}) or {}
    raw_left_value = raw_params.get("leftValue", data.get("leftValue"))
    result.data = {
        "condition": data.get("condition", "True"),
        "operator": data.get("operator"),
        "leftValue": raw_left_value,  # 使用原始值，不解析模板
        "leftValueType": data.get("leftValueType", "auto"),
        "value": data.get("value"),
        "valueType": data.get("valueType", "auto"),
        "maxIterations": max_iterations,
        "result": [],
    }
    ctx.outputs[node_id] = result.data
    result.message = f"While loop prepared (max {max_iterations} iterations)"


async def handle_for_node(
    ctx, data: dict, normalized_node: dict, result, __: Any
) -> None:
    resolved_inputs = normalized_node.get("resolved_inputs", {}) or {}
    node_id = normalized_node["id"]
    variable_name = (data.get("variableName") or "i").strip() or "i"
    start = _coerce_loop_number(resolved_inputs.get("start", data.get("start")), 0)
    end = _coerce_loop_number(resolved_inputs.get("end", data.get("end")), 0)
    step = _coerce_loop_number(resolved_inputs.get("step", data.get("step")), 1)
    max_iterations = _coerce_loop_number(data.get("maxIterations"), 1000)
    inclusive = str(data.get("inclusive", "false")).lower() == "true"

    if step == 0:
        raise ValueError("For loop step 不能为 0")

    result.data = {
        "variableName": variable_name,
        "start": start,
        "end": end,
        "step": step,
        "inclusive": inclusive,
        "maxIterations": max_iterations,
        "result": [],
    }
    ctx.outputs[node_id] = result.data
    result.message = (
        f"For loop prepared ({variable_name} from {start} to {end}, step {step})"
    )


async def handle_map_node(
    ctx, data: dict, normalized_node: dict, result, __: Any
) -> None:
    resolved_inputs = normalized_node.get("resolved_inputs", {}) or {}
    items = resolved_inputs.get("items")
    item_name = data.get("itemName") or "item"
    expression = data.get("expression") or data.get("fn") or item_name
    normalized_expression = _normalize_map_expression(expression, item_name)

    if items is None:
        result.status = "skipped"
        result.message = "No items input configured"
        result.data = {"items": [], "result": [], "count": 0, "expression": expression}
        return
        return

    if not isinstance(items, list):
        items = [items]

    safe_globals = {"__builtins__": None}
    safe_locals_base = {
        "len": len,
        "str": str,
        "int": int,
        "float": float,
        "bool": bool,
        "sum": sum,
        "min": min,
        "max": max,
        "round": round,
        "abs": abs,
    }

    mapped = []
    for index, item in enumerate(items):
        wrapped_item = _wrap_map_value(item)
        safe_locals = {
            **safe_locals_base,
            item_name: wrapped_item,
            "item": wrapped_item,
            "index": index,
            "items": _wrap_map_value(items),
        }
        try:
            mapped.append(eval(normalized_expression, safe_globals, safe_locals))
        except Exception as e:
            result.status = "failed"
            result.error = f"Map expression error at index {index}: {str(e)}"
            result.message = f"Map failed at item {index + 1}"
            result.data = {
                "items": items,
                "result": mapped,
                "count": len(mapped),
                "expression": expression,
                "normalizedExpression": normalized_expression,
            }
            return

    result.data = {
        "items": items,
        "result": mapped,
        "count": len(mapped),
        "expression": expression,
        "normalizedExpression": normalized_expression,
        "itemName": item_name,
    }
    node_id = normalized_node["id"]
    ctx.outputs[node_id] = result.data
    result.message = f"Map produced {len(mapped)} item(s)"


async def handle_extract_node(
    ctx, data: dict, normalized_node: dict, result, predecessor_output: Any
) -> None:
    extractions = data.get("extractions", [])
    if not extractions or not isinstance(extractions, list):
        result.status = "skipped"
        result.message = "No extractions configured"
        return

    extracted_data = {}
    for ext in extractions:
        selector = ext.get("selector")
        var_name = ext.get("variableName")
        attr = ext.get("attribute", "textContent")

        if not var_name:
            continue

        try:
            if (
                predecessor_output
                and isinstance(predecessor_output, dict)
                and predecessor_output.get("__type__") == "document_ref"
            ):
                val = await ctx.page.evaluate(
                    f"""
                    (() => {{
                        try {{ return {attr}; }} catch(e) {{}}
                        try {{ return document.{attr}; }} catch(e) {{}}
                        try {{ return window.{attr}; }} catch(e) {{}}
                        return null;
                    }})()
                    """
                )
                extracted_data[var_name] = val
            elif selector or (normalized_node.get("resolved_inputs", {}) or {}).get(
                "target"
            ):
                extraction_params = {**data, **ext}
                locator = resolve_locator_target(
                    ctx, extraction_params, normalized_node
                )
                if locator is None and selector:
                    locator = build_locator(ctx.page, extraction_params)
                if await locator.count() > 0:
                    if attr == "textContent":
                        val = await locator.text_content()
                    elif attr == "innerText":
                        val = await locator.inner_text()
                    elif attr == "value":
                        val = await locator.input_value()
                    else:
                        val = await locator.get_attribute(attr)
                    extracted_data[var_name] = val
                else:
                    extracted_data[var_name] = None
            else:
                extracted_data[var_name] = None
        except Exception as e:
            print(f"Extraction error for {selector or 'document'}: {e}")
            extracted_data[var_name] = None

    details = ", ".join(
        [
            f"{k}={str(v)[:50] + '...' if v and len(str(v)) > 50 else v}"
            for k, v in extracted_data.items()
        ]
    )
    node_id = normalized_node["id"]
    result.data = extracted_data
    ctx.outputs[node_id] = extracted_data
    result.message = f"Extracted {len(extracted_data)} values: {details}"


async def handle_if_node(
    ctx, data: dict, normalized_node: dict, result, __: Any
) -> None:
    resolved_inputs = normalized_node.get("resolved_inputs", {}) or {}
    raw_params = normalized_node.get("params", {}) or {}
    node_id = normalized_node["id"]
    on_error = (
        str(data.get("onError") or raw_params.get("onError") or "fail").strip().lower()
    )
    try:
        condition_result = evaluate_condition_config(
            ctx,
            data,
            resolved_inputs,
            raw_condition=(
                raw_params.get("condition")
                if isinstance(raw_params.get("condition"), str)
                else None
            ),
        )
        result.message = f"条件判断结果: {condition_result.get('result')}"
        result.data = condition_result
        ctx.outputs[node_id] = result.data
    except Exception as e:
        error_message = f"条件解析错误: {str(e)}"
        if on_error == "false":
            result.message = "条件判断结果: False"
            result.error = error_message
            result.data = {
                "result": False,
                "mode": "error",
                "expression": (
                    raw_params.get("condition")
                    if isinstance(raw_params.get("condition"), str)
                    else data.get("condition")
                ),
                "error": error_message,
            }
            ctx.outputs[node_id] = result.data
        else:
            result.status = "failed"
            result.error = error_message


async def handle_stop_node(
    ctx, data: dict, normalized_node: dict, result, __: Any
) -> None:
    stop_type = data.get("stopType", "success")
    raw_error_message = data.get("errorMessage", "")
    error_message = resolve_output_reference(raw_error_message, ctx.outputs)
    node_id = normalized_node["id"]
    result.status = "success"
    result.data = {"stop": True, "type": stop_type, "message": error_message}
    ctx.outputs[node_id] = result.data
    if stop_type == "error":
        result.message = f"流程停止 (错误): {error_message}"
    else:
        result.message = f"流程正常停止: {error_message}"


async def handle_break_node(
    ctx, data: dict, normalized_node: dict, result, __: Any
) -> None:
    loop_type = ctx.locals.get("__loop_type__")
    if not ctx.locals.get("__in_loop__"):
        result.status = "skipped"
        result.message = "Break node only works inside loop"
        return

    node_id = normalized_node["id"]
    result.data = {"control": "break", "result": "break", "loopType": loop_type}
    ctx.outputs[node_id] = result.data
    result.message = f"Break current {loop_type or 'loop'}"


async def handle_continue_node(
    ctx, data: dict, normalized_node: dict, result, __: Any
) -> None:
    loop_type = ctx.locals.get("__loop_type__")
    if not ctx.locals.get("__in_loop__"):
        result.status = "skipped"
        result.message = "Continue node only works inside loop"
        return

    node_id = normalized_node["id"]
    result.data = {
        "control": "continue",
        "result": "continue",
        "loopType": loop_type,
    }
    ctx.outputs[node_id] = result.data
    result.message = f"Continue next {loop_type or 'loop'} iteration"
