from __future__ import annotations

from typing import Any, Awaitable, Callable, Dict, Optional, TYPE_CHECKING
import os
import re
import secrets
import string
import uuid
import ast

from core.template_functions.registry import TemplateFunctionRegistry


if TYPE_CHECKING:
    from core.executor import ExecutionSandbox, NodeResult
    from core.executor import ExecutionContext

NodeHandler = Callable[
    ["ExecutionContext", dict, dict, "NodeResult", Any], Awaitable[None]
]

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.dirname(__file__)))
DATA_DIR = os.path.join(BACKEND_DIR, "data")
VARIABLE_STORE_KEY = "__vars__"
TEMPLATE_PATTERN = re.compile(r"\$\{([^}]+)\}")
RANDOM_EXPR_PATTERN = re.compile(
    r"^random\.(alnum|alpha|numeric|hex|password|ms_password|uuid)\((.*?)\)(?::([A-Za-z_][A-Za-z0-9_]*))?$"
)


_TEMPLATE_FUNCTIONS: TemplateFunctionRegistry | None = None


def ensure_template_functions_loaded() -> TemplateFunctionRegistry:
    """Load built-in template function namespaces on first use.

    This is intentionally lightweight and safe: no dynamic imports from user input.
    """
    global _TEMPLATE_FUNCTIONS
    if _TEMPLATE_FUNCTIONS is not None:
        return _TEMPLATE_FUNCTIONS

    registry = TemplateFunctionRegistry()

    # Built-in namespaces
    from core.template_functions import faker_ns, json_ns, random_ns, regex_ns, time_ns

    random_ns.register(registry)
    time_ns.register(registry)
    json_ns.register(registry)
    faker_ns.register(registry)
    regex_ns.register(registry)

    _TEMPLATE_FUNCTIONS = registry
    return registry


_TEMPLATE_FN_CALL_PATTERN = re.compile(
    r"^([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)\((.*?)\)(?::([A-Za-z_][A-Za-z0-9_]*))?$"
)


def _resolve_template_function_call(reference: str, outputs: Dict[str, Any]) -> Any:
    match = _TEMPLATE_FN_CALL_PATTERN.fullmatch(reference.strip())
    if not match:
        return None

    namespace, name, args_text, variable_name = match.groups()
    args = [
        _parse_template_arg(item, outputs) for item in _split_function_args(args_text)
    ]

    registry = ensure_template_functions_loaded()
    value = registry.call(namespace, name, args, outputs=outputs)
    if value is None:
        return None

    if variable_name:
        variable_store = get_variable_store(outputs)
        variable_store[variable_name] = value

    return value


def _generate_ms_passwords(
    length: int, count: int, special_chars: str | None = None
) -> Any:
    """生成符合微软常见复杂度要求的随机密码。

    规则（默认）：
    - 至少 2 个大写字母
    - 至少 4 个小写字母
    - 至少 3 个数字
    - 至少 1 个特殊字符（默认集合："@#$%!&*"）
    - 其余位从字母+数字中补齐
    """

    if length < 10:
        raise ValueError("random.ms_password 长度必须 >= 10")

    specials = special_chars or "@#$%!&*"
    if not specials:
        raise ValueError("random.ms_password 特殊字符集合不能为空")

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


def get_variable_store(outputs: Dict[str, Any]) -> Dict[str, Any]:
    store = outputs.get(VARIABLE_STORE_KEY)
    if not isinstance(store, dict):
        store = {}
        outputs[VARIABLE_STORE_KEY] = store
    return store


def _split_reference_tokens(reference: str) -> list[Any]:
    tokens: list[Any] = []
    current = []
    index_buffer = []
    in_index = False

    for char in reference:
        if in_index:
            if char == "]":
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
                index_buffer.append(char)
            continue

        if char == ".":
            if current:
                tokens.append("".join(current))
                current = []
            continue

        if char == "[":
            if current:
                tokens.append("".join(current))
                current = []
            in_index = True
            continue

        current.append(char)

    if current:
        tokens.append("".join(current))

    return [token for token in tokens if token != ""]


def _resolve_from_tokens(root: Any, tokens: list[Any]) -> Any:
    current = root
    for token in tokens:
        if isinstance(token, int):
            if isinstance(current, (list, tuple)) and -len(current) <= token < len(
                current
            ):
                current = current[token]
            else:
                return None
            continue

        if isinstance(current, dict):
            current = current.get(token)
        else:
            return None

        if current is None:
            return None

    return current


def _generate_random_values(kind: str, length: int | None, count: int) -> Any:
    if count < 1:
        count = 1

    if kind == "uuid":
        values = [str(uuid.uuid4()) for _ in range(count)]
    else:
        if length is None or length < 1:
            raise ValueError("随机字符串长度必须大于 0")

        if kind == "alnum":
            alphabet = string.ascii_letters + string.digits
        elif kind == "alpha":
            alphabet = string.ascii_letters
        elif kind == "numeric":
            alphabet = string.digits
        elif kind == "hex":
            alphabet = string.hexdigits.lower()[:16]
        else:
            raise ValueError(f"不支持的随机类型: {kind}")

        values = [
            "".join(secrets.choice(alphabet) for _ in range(length))
            for _ in range(count)
        ]

    return values[0] if count == 1 else values


def _secure_shuffle(items: list[str]) -> list[str]:
    shuffled = list(items)
    for index in range(len(shuffled) - 1, 0, -1):
        swap_index = secrets.randbelow(index + 1)
        shuffled[index], shuffled[swap_index] = shuffled[swap_index], shuffled[index]
    return shuffled


def _generate_random_passwords(
    length: int, count: int, special_chars: str | None = None
) -> Any:
    if length < 1:
        raise ValueError("随机密码长度必须大于 0")

    specials = special_chars or "!@#$%^&*"
    alphabet = string.ascii_letters + string.digits + specials
    values: list[str] = []

    for _ in range(max(1, count)):
        chars = [secrets.choice(specials)]
        chars.extend(secrets.choice(alphabet) for _ in range(max(0, length - 1)))
        values.append("".join(_secure_shuffle(chars)))

    return values[0] if count == 1 else values


def _split_function_args(args_text: str) -> list[str]:
    args: list[str] = []
    current: list[str] = []
    quote_char = ""
    escaped = False

    for char in args_text:
        if escaped:
            current.append(char)
            escaped = False
            continue

        if char == "\\":
            current.append(char)
            escaped = True
            continue

        if quote_char:
            current.append(char)
            if char == quote_char:
                quote_char = ""
            continue

        if char in {'"', "'"}:
            current.append(char)
            quote_char = char
            continue

        if char == ",":
            item = "".join(current).strip()
            if item:
                args.append(item)
            current = []
            continue

        current.append(char)

    item = "".join(current).strip()
    if item:
        args.append(item)
    return args


def _parse_template_arg(raw_arg: str, outputs: Optional[Dict[str, Any]] = None) -> Any:
    text = raw_arg.strip()
    if not text:
        return ""
    # 尝试把数字/布尔/null/带引号字符串解析成真实类型。
    # 解析失败则按原始字符串返回（例如特殊字符集合：@#$%!&*）。
    try:
        return ast.literal_eval(text)
    except Exception:
        pass

    if outputs is not None:
        resolved = resolve_store_reference(text, outputs)
        if resolved is not None:
            return resolved

    return text


def _resolve_random_expression(reference: str, outputs: Dict[str, Any]) -> Any:
    match = RANDOM_EXPR_PATTERN.fullmatch(reference.strip())
    if not match:
        return None

    kind, args_text, variable_name = match.groups()
    args = [
        _parse_template_arg(item, outputs) for item in _split_function_args(args_text)
    ]

    if kind == "uuid":
        if len(args) > 1:
            raise ValueError("random.uuid 最多只支持一个数量参数")
        length = None
        count = int(args[0]) if args else 1
    elif kind == "ms_password":
        if not args:
            raise ValueError("random.ms_password 至少需要长度参数")
        if len(args) > 3:
            raise ValueError("random.ms_password 最多支持长度、数量、特殊字符三个参数")

        length = int(args[0])
        count = 1
        special_chars = None

        if len(args) >= 2:
            if isinstance(args[1], str):
                special_chars = args[1]
            else:
                count = int(args[1])

        if len(args) == 3:
            count = int(args[1])
            special_chars = str(args[2])

        generated = _generate_ms_passwords(length, count, special_chars)

        if variable_name:
            variable_store = get_variable_store(outputs)
            variable_store[variable_name] = generated

        return generated
    elif kind == "password":
        if not args:
            raise ValueError("random.password 至少需要长度参数")
        if len(args) > 3:
            raise ValueError("random.password 最多支持长度、数量、特殊字符三个参数")

        length = int(args[0])
        count = 1
        special_chars = None

        if len(args) >= 2:
            if isinstance(args[1], str):
                special_chars = args[1]
            else:
                count = int(args[1])

        if len(args) == 3:
            count = int(args[1])
            special_chars = str(args[2])

        generated = _generate_random_passwords(length, count, special_chars)

        if variable_name:
            variable_store = get_variable_store(outputs)
            variable_store[variable_name] = generated

        return generated
    else:
        if not args:
            raise ValueError(f"random.{kind} 至少需要长度参数")
        if len(args) > 2:
            raise ValueError(f"random.{kind} 最多支持长度和数量两个参数")
        length = int(args[0])
        count = int(args[1]) if len(args) > 1 else 1

    generated = _generate_random_values(kind, length, count)

    if variable_name:
        variable_store = get_variable_store(outputs)
        variable_store[variable_name] = generated

    return generated


def _apply_locator_filters(locator: Any, params: Dict[str, Any]) -> Any:
    """为 locator 应用常见链式过滤参数。"""
    if locator is None:
        return None

    if params.get("hasText"):
        locator = locator.filter(has_text=str(params["hasText"]))

    if params.get("first"):
        locator = locator.first
    elif params.get("last"):
        locator = locator.last
    elif params.get("index") is not None:
        locator = locator.nth(int(params["index"]))

    return locator


def _apply_locator_list_filters(locators: list[Any], params: Dict[str, Any]) -> Any:
    """为 locator 列表应用选择参数。

    列表无法像 Playwright Locator 一样继续链式 filter，因此这里只处理：
    - first
    - last
    - index
    未指定时返回原列表。
    """
    if not locators:
        return []

    if params.get("first"):
        return locators[0]

    if params.get("last"):
        return locators[-1]

    if params.get("index") is not None:
        index = int(params["index"])
        if -len(locators) <= index < len(locators):
            return locators[index]
        return None

    return locators


def create_locator_descriptor(
    params: Dict[str, Any], node_id: Optional[str] = None
) -> Dict[str, Any]:
    """创建可序列化的 locator 描述对象，供 DSL 节点在 store 中流转。"""
    allowed_fields = [
        "selector",
        "selectorType",
        "role",
        "name",
        "testId",
        "label",
        "placeholder",
        "xpath",
        "hasText",
        "first",
        "last",
        "index",
    ]
    descriptor = {
        "__type__": "locator_ref",
        "params": {key: params.get(key) for key in allowed_fields if key in params},
    }
    if node_id:
        descriptor["ref"] = node_id
    return descriptor


def _extract_locator_filter_params(params: Dict[str, Any]) -> Dict[str, Any]:
    """仅提取可安全叠加到已有 locator 上的过滤参数。"""
    allowed_fields = ["hasText", "first", "last", "index"]
    return {key: params.get(key) for key in allowed_fields if key in params}


def _is_locator_like(value: Any) -> bool:
    return hasattr(value, "locator") or "locator" in str(type(value)).lower()


def _resolve_locator_descriptor(
    ctx: Any, target: Dict[str, Any], data: Dict[str, Any]
) -> Any:
    if not isinstance(target, dict) or target.get("__type__") != "locator_ref":
        return None

    ref_node_id = target.get("ref")
    if ref_node_id and ref_node_id in ctx.values:
        runtime_val = ctx.values[ref_node_id]

        if isinstance(runtime_val, list):
            index = (target.get("params", {}) or {}).get("index")
            if index is not None:
                index = int(index)
                if 0 <= index < len(runtime_val):
                    return _apply_locator_filters(runtime_val[index], data)

        if _is_locator_like(runtime_val):
            return _apply_locator_filters(runtime_val, data)

    base_locator = build_locator(ctx.page, target.get("params", {}))
    if base_locator:
        return _apply_locator_filters(base_locator, data)

    return None


def build_locator(page: Any, params: Dict[str, Any]) -> Any:
    """根据兼容层参数构建 Playwright locator。"""
    selector = params.get("selector")
    selector_type = (params.get("selectorType") or "css").lower()
    selector_str = str(selector).strip() if selector is not None else ""

    if not selector_str and selector_type not in {
        "role",
        "testid",
        "test_id",
        "label",
        "placeholder",
        "xpath",
    }:
        return None

    if selector_type in {"native", "raw", "playwright"}:
        locator = page.locator(selector_str)
    elif selector_type == "css":
        if selector_str.startswith(
            ("css=", "xpath=", "text=", "id=", "data-testid=", "internal:")
        ):
            locator = page.locator(selector_str)
        else:
            locator = page.locator(selector_str)
    elif selector_type == "text":
        if selector is None:
            return None
        locator = page.get_by_text(str(selector))
    elif selector_type == "role":
        role = params.get("role") or selector
        if not role:
            return None
        role_options: Dict[str, Any] = {}
        if params.get("name") is not None:
            role_options["name"] = str(params["name"])
        locator = page.get_by_role(str(role), **role_options)
    elif selector_type in {"testid", "test_id"}:
        test_id = params.get("testId") or selector
        if test_id is None:
            return None
        locator = page.get_by_test_id(str(test_id))
    elif selector_type == "label":
        label = params.get("label") or selector
        if label is None:
            return None
        locator = page.get_by_label(str(label))
    elif selector_type == "placeholder":
        placeholder = params.get("placeholder") or selector
        if placeholder is None:
            return None
        locator = page.get_by_placeholder(str(placeholder))
    elif selector_type == "xpath":
        xpath = params.get("xpath") or selector
        if not xpath:
            return None
        locator = page.locator(f"xpath={xpath}")
    else:
        if not selector:
            return None
        locator = page.locator(str(selector))

    return _apply_locator_filters(locator, params)


def resolve_locator_target(ctx: Any, data: Dict[str, Any], node_data: dict) -> Any:
    """优先使用运行时上下文中的 Locator，否则回退到 DSL target 或 legacy selector。"""
    resolved_inputs = node_data.get("resolved_inputs", {}) or {}
    target = resolved_inputs.get("target")

    # 如果 resolved_inputs 中没有 target，尝试从 data 中获取并解析
    if target is None:
        target = data.get("target")
        if isinstance(target, dict) and "from" in target:
            # 使用 ctx.outputs 解析引用
            target = resolve_input_value(target, ctx.outputs)

    # 鲁棒性处理：如果 target 是 {"target": "node_id"} 这种形式，进行解包
    if isinstance(target, dict) and "target" in target and len(target) == 1:
        target = target["target"]

    # 0. 处理双花括号引用 (例如 {{item}} / {{node_id}} / {{node_id.result}})
    if isinstance(target, str) and target.startswith("{{") and target.endswith("}}"):
        reference = target[2:-2].strip()
        resolved_target = ctx.locals.get(reference)

        if resolved_target is None and isinstance(reference, str):
            if reference in ctx.values:
                resolved_target = ctx.values.get(reference)
            elif reference in ctx.outputs:
                resolved_target = ctx.outputs.get(reference)
            else:
                resolved_target = resolve_store_reference(reference, ctx.outputs)

        target = resolved_target

    # 1.2 target 可能只是一个 nodeId 字符串，需要继续从 outputs 中取序列化结果再解析。
    if isinstance(target, str):
        serialized_target = ctx.outputs.get(target)
        if serialized_target is not None and serialized_target is not target:
            target = serialized_target

    # 如果提供了 target (无论是否能解析成功)，则进入 target 解析流程，不再回退到 selector
    if target is not None:
        # 1. 尝试从运行时上下文 values 中获取上游节点的 Locator
        if isinstance(target, str) and target in ctx.values:
            runtime_val = ctx.values[target]
            if isinstance(runtime_val, list):
                return _apply_locator_list_filters(runtime_val, data)
            if _is_locator_like(runtime_val):
                return _apply_locator_filters(runtime_val, data)

        # 1.5 处理 list / all 输出结果
        if isinstance(target, dict):
            target_items = None
            if isinstance(target.get("items"), list):
                target_items = target.get("items")
            elif isinstance(target.get("result"), list):
                target_items = target.get("result")

            if target_items is not None:
                locators = []
                for item in target_items:
                    locator = _resolve_locator_descriptor(ctx, item, {})
                    if locator is not None:
                        locators.append(locator)
                return _apply_locator_list_filters(locators, data)

        if isinstance(target, list):
            locators = []
            for item in target:
                if _is_locator_like(item):
                    locators.append(item)
                    continue
                if isinstance(item, dict):
                    locator = _resolve_locator_descriptor(ctx, item, {})
                    if locator is not None:
                        locators.append(locator)
            return _apply_locator_list_filters(locators, data)

        # 2. 处理 locator_ref (描述符)
        if isinstance(target, dict) and target.get("__type__") == "locator_ref":
            locator = _resolve_locator_descriptor(ctx, target, data)
            if locator is not None:
                return locator

        # 3. 如果 target 是一个直接的 Locator 对象 (例如在 foreach 中传递)
        if _is_locator_like(target):
            return _apply_locator_filters(target, data)

        # 如果提供了 target 但无法解析为 Locator，直接返回 None (忽略 selector)
        return None

    # 4. 只有在完全没有提供 target 的情况下，才回退到基于当前节点 data 构建 (使用 selector)
    return build_locator(ctx.page, data)


def resolve_output_reference(value: str, outputs: Dict[str, Any]) -> str:
    """解析输出引用，支持 ${nodeId.field}。"""
    if not isinstance(value, str):
        return value

    matches = TEMPLATE_PATTERN.findall(value)

    if not matches:
        return value

    for match in matches:
        current = resolve_store_reference(match, outputs)

        if current is not None:
            value = value.replace(f"${{{match}}}", str(current))

    return value


def resolve_output_reference_for_eval(value: str, outputs: Dict[str, Any]) -> str:
    """解析输出引用，用于表达式 eval。"""
    if not isinstance(value, str):
        return value

    matches = TEMPLATE_PATTERN.findall(value)

    for match in matches:
        current = resolve_store_reference(match, outputs)

        if current is not None:
            value = value.replace(f"${{{match}}}", repr(current))
        else:
            value = value.replace(f"${{{match}}}", "None")

    return value


def resolve_store_reference(reference: str, outputs: Dict[str, Any]) -> Any:
    """解析 store 引用，支持 nodeId 或 nodeId.field.subfield。"""
    if not isinstance(reference, str) or not reference:
        return None

    # 1) Template functions: ${ns.fn(...)}
    fn_value = _resolve_template_function_call(reference, outputs)
    if fn_value is not None:
        return fn_value

    # 2) Back-compat: keep random.* parser for existing docs/flows
    random_value = _resolve_random_expression(reference, outputs)
    if random_value is not None:
        return random_value

    variable_store = get_variable_store(outputs)
    tokens = _split_reference_tokens(reference)

    if not tokens:
        return None

    first_token = tokens[0]

    if isinstance(first_token, str) and first_token in variable_store:
        return _resolve_from_tokens(variable_store.get(first_token), tokens[1:])

    if reference in variable_store:
        return variable_store.get(reference)

    if first_token == "vars":
        return _resolve_from_tokens(variable_store, tokens[1:])

    node_id = first_token
    current = outputs.get(node_id) if isinstance(node_id, str) else None

    if current is None:
        current = outputs.get(reference)
        if current is not None:
            return current

    return _resolve_from_tokens(current, tokens[1:])


def resolve_template_value(value: Any, outputs: Dict[str, Any]) -> Any:
    """递归解析模板变量。

    规则：
    - 纯模板字符串 `${nodeId.result}` 返回原始值类型
    - 混合模板字符串 `prefix-${nodeId.result}` 返回拼接后的字符串
    - dict / list 递归解析
    """
    if isinstance(value, str):
        full_match = TEMPLATE_PATTERN.fullmatch(value)
        if full_match:
            resolved = resolve_store_reference(full_match.group(1), outputs)
            return value if resolved is None else resolved
        return resolve_output_reference(value, outputs)

    if isinstance(value, dict):
        return {
            key: resolve_template_value(item, outputs) for key, item in value.items()
        }

    if isinstance(value, list):
        return [resolve_template_value(item, outputs) for item in value]

    return value


def resolve_input_value(input_ref: Any, outputs: Dict[str, Any]) -> Any:
    """解析 DSL input，兼容引用与模板字符串。

    支持：
    - {from: "varName"}
    - {from: "${varName}"}
    - {from: "prefix-${varName}"}
    - {value: ...}
    """
    current = input_ref
    depth = 0
    max_depth = 10

    while depth < max_depth:
        if isinstance(current, dict):
            if "from" in current:
                from_value = current["from"]
                if isinstance(from_value, str):
                    current = resolve_template_value(from_value, outputs)
                else:
                    resolved = resolve_store_reference(from_value, outputs)
                    if resolved is current:
                        break
                    current = resolved
                depth += 1
                continue
            if "value" in current:
                current = current["value"]
                depth += 1
                continue
        break
    return resolve_template_value(current, outputs)


def normalize_node(
    node_data: dict, outputs: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """标准化节点结构，兼容 legacy data 与 DSL 风格 data.params / data.inputs。"""
    outputs = outputs or {}
    raw_data = node_data.get("data", {}) or {}
    params = (
        raw_data.get("params", {}) if isinstance(raw_data.get("params"), dict) else {}
    )
    resolved_params = resolve_template_value(params, outputs)
    resolved_raw_data = resolve_template_value(
        {
            key: value
            for key, value in raw_data.items()
            if key not in {"params", "inputs"}
        },
        outputs,
    )

    # 兼容 inputs 在顶层或在 data 内部的情况
    inputs = node_data.get("inputs")
    if not isinstance(inputs, dict):
        inputs = raw_data.get("inputs", {})
        if not isinstance(inputs, dict):
            inputs = {}

    resolved_inputs = {
        key: resolve_input_value(value, outputs) for key, value in inputs.items()
    }

    normalized_data = {
        **resolved_raw_data,
        **resolved_params,
        **{key: value for key, value in resolved_inputs.items() if value is not None},
    }

    node_type = (
        normalized_data.get("nodeType")
        or node_data.get("type")
        or node_data.get("nodeType")
    )

    return {
        "id": node_data.get("id") or "unknown",
        "type": node_type,
        "data": normalized_data,
        "raw_data": raw_data,
        "params": resolved_params,
        "inputs": inputs,
        "resolved_inputs": resolved_inputs,
        "outputType": raw_data.get("outputType"),
        "raw": node_data,
    }
