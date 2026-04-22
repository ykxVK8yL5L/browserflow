from __future__ import annotations

from typing import Any
import base64
import json
import os
from urllib.parse import urljoin


from .common import create_locator_descriptor, resolve_locator_target
from core.screenshot_storage import build_screenshot_dir

try:
    import ddddocr
except ImportError:
    ddddocr = None


_DDDDOCR_CACHE: dict[tuple[str, bool], Any] = {}


def _to_bool(value: Any, default: bool = False) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


def _get_ddddocr_instance(mode: str, *, beta: bool = False):
    if ddddocr is None:
        raise RuntimeError("ddddocr 未安装，无法执行验证码相关节点")

    cache_key = (mode, beta)
    if cache_key in _DDDDOCR_CACHE:
        return _DDDDOCR_CACHE[cache_key]

    if mode == "ocr":
        instance = ddddocr.DdddOcr(beta=beta, show_ad=False)
    elif mode == "det":
        instance = ddddocr.DdddOcr(det=True, ocr=False, show_ad=False)
    elif mode == "slide":
        instance = ddddocr.DdddOcr(det=False, ocr=False, show_ad=False)
    else:
        raise ValueError(f"不支持的 ddddocr 模式: {mode}")

    _DDDDOCR_CACHE[cache_key] = instance
    return instance


def _normalize_base64_payload(value: str) -> str:
    payload = str(value or "").strip()
    if "," in payload:
        payload = payload.split(",", 1)[1]
    return payload


async def _capture_element_screenshot(
    ctx,
    selector: str,
    *,
    timeout: int = 5000,
) -> tuple[bytes, dict[str, float], Any]:
    locator = ctx.page.locator(selector).first
    await locator.wait_for(state="visible", timeout=timeout)
    image_bytes = await locator.screenshot()
    box = await locator.bounding_box()
    if box is None:
        raise ValueError(f"无法获取元素位置: {selector}")
    return image_bytes, box, locator


def _normalize_match_result(match_result: Any) -> dict[str, Any]:
    if isinstance(match_result, dict):
        target = match_result.get("target") or [0, 0]
    elif isinstance(match_result, (list, tuple)) and len(match_result) >= 2:
        target = match_result
        match_result = {"target": list(match_result)}
    else:
        target = [0, 0]
        match_result = {"target": target}

    x = float(target[0] or 0)
    y = float(target[1] or 0)
    width = float(target[2] or 0) if len(target) > 2 else 0.0
    height = float(target[3] or 0) if len(target) > 3 else 0.0
    center_x = x + (width / 2 if width else 0)
    center_y = y + (height / 2 if height else 0)

    return {
        "raw": match_result,
        "x": x,
        "y": y,
        "width": width,
        "height": height,
        "centerX": center_x,
        "centerY": center_y,
    }


def _is_crop_order_error(exc: Exception) -> bool:
    return "Coordinate 'right' is less than 'left'" in str(exc)


def _run_slide_match(
    slide_ocr: Any,
    target_bytes: bytes,
    background_bytes: bytes,
    *,
    use_comparison: bool,
    simple_target: bool,
) -> Any:
    if use_comparison:
        return slide_ocr.slide_comparison(target_bytes, background_bytes)

    try:
        return slide_ocr.slide_match(
            target_bytes,
            background_bytes,
            simple_target=simple_target,
        )
    except ValueError as exc:
        if not simple_target and _is_crop_order_error(exc):
            return slide_ocr.slide_match(
                target_bytes,
                background_bytes,
                simple_target=True,
            )
        raise


def _sort_match_items(
    items: list[dict[str, Any]], sort_mode: str
) -> list[dict[str, Any]]:
    if sort_mode == "left-to-right":
        items.sort(key=lambda item: (item.get("x", 0), item.get("y", 0)))
    elif sort_mode == "top-to-bottom":
        items.sort(key=lambda item: (item.get("y", 0), item.get("x", 0)))
    elif sort_mode == "confidence":
        items.sort(key=lambda item: item.get("confidence", 0), reverse=True)
    return items


def _normalize_text_for_match(value: Any) -> str:
    text = str(value or "")
    return "".join(text.split()).lower()


def _union_match_box(items: list[dict[str, Any]]) -> dict[str, int] | None:
    if not items:
        return None

    x1 = min(int(item["x1"]) for item in items)
    y1 = min(int(item["y1"]) for item in items)
    x2 = max(int(item["x2"]) for item in items)
    y2 = max(int(item["y2"]) for item in items)
    return {
        "x1": x1,
        "y1": y1,
        "x2": x2,
        "y2": y2,
        "width": x2 - x1,
        "height": y2 - y1,
    }


def _find_text_sequence_match(
    candidates: list[dict[str, Any]],
    target_text: str,
) -> list[dict[str, Any]]:
    normalized_target = _normalize_text_for_match(target_text)
    if not normalized_target:
        return []

    exact_matches = [
        item
        for item in candidates
        if _normalize_text_for_match(item.get("text")) == normalized_target
    ]
    if exact_matches:
        return [exact_matches[0]]

    count = len(candidates)
    for start in range(count):
        merged = ""
        matched_items: list[dict[str, Any]] = []
        for index in range(start, count):
            current_text = _normalize_text_for_match(candidates[index].get("text"))
            if not current_text:
                continue
            merged += current_text
            matched_items.append(candidates[index])

            if merged == normalized_target:
                return matched_items
            if not normalized_target.startswith(merged):
                break

    partial_matches = [
        item
        for item in candidates
        if normalized_target in _normalize_text_for_match(item.get("text"))
        or _normalize_text_for_match(item.get("text")) in normalized_target
    ]
    return [partial_matches[0]] if partial_matches else []


def _build_click_point_from_box(
    box: dict[str, float],
    click_position: str,
    offset_x: float,
    offset_y: float,
) -> tuple[float, float]:
    if click_position == "top-left":
        return box["x1"] + offset_x, box["y1"] + offset_y
    if click_position == "top-right":
        return box["x2"] + offset_x, box["y1"] + offset_y
    if click_position == "bottom-left":
        return box["x1"] + offset_x, box["y2"] + offset_y
    if click_position == "bottom-right":
        return box["x2"] + offset_x, box["y2"] + offset_y

    return (
        box["x1"] + box["width"] / 2 + offset_x,
        box["y1"] + box["height"] / 2 + offset_y,
    )


def _normalize_detection_boxes(boxes: list[Any]) -> list[dict[str, int]]:
    return [
        {
            "x1": int(box[0]),
            "y1": int(box[1]),
            "x2": int(box[2]),
            "y2": int(box[3]),
            "width": int(box[2]) - int(box[0]),
            "height": int(box[3]) - int(box[1]),
        }
        for box in boxes
        if isinstance(box, (list, tuple)) and len(box) >= 4
    ]


async def _dispatch_dom_click_at_point(
    ctx,
    x: float,
    y: float,
    *,
    button: str,
    click_count: int,
) -> dict[str, Any]:
    return await ctx.page.evaluate(
        """({ x, y, button, clickCount }) => {
            const target = document.elementFromPoint(x, y);
            if (!target) {
                return { clicked: false, reason: 'no-element' };
            }

            const buttons = { left: 0, middle: 1, right: 2 };
            const buttonCode = buttons[button] ?? 0;
            const eventInit = {
                bubbles: true,
                cancelable: true,
                clientX: x,
                clientY: y,
                button: buttonCode,
                buttons: buttonCode === 0 ? 1 : 0,
                detail: clickCount,
                view: window,
            };

            target.dispatchEvent(new MouseEvent('pointerdown', eventInit));
            target.dispatchEvent(new MouseEvent('mousedown', eventInit));
            target.dispatchEvent(new MouseEvent('pointerup', eventInit));
            target.dispatchEvent(new MouseEvent('mouseup', eventInit));
            target.dispatchEvent(new MouseEvent('click', eventInit));

            return {
                clicked: true,
                tagName: target.tagName,
                text: (target.textContent || '').trim().slice(0, 100),
            };
        }""",
        {
            "x": x,
            "y": y,
            "button": button,
            "clickCount": click_count,
        },
    )


async def _read_image_bytes_from_source(
    ctx,
    *,
    selector: str | None = None,
    image_base64: str | None = None,
) -> bytes:
    if image_base64:
        return base64.b64decode(_normalize_base64_payload(image_base64))

    selector = str(selector or "").strip()
    if not selector:
        raise ValueError("缺少图片来源，请提供 imageSelector 或 imageBase64")

    locator = ctx.page.locator(selector).first
    src = await locator.get_attribute("src")
    if src:
        src = str(src).strip()
        if src.startswith("data:"):
            return base64.b64decode(_normalize_base64_payload(src))
        if src.startswith(("http://", "https://", "//", "/", "./", "../")):
            image_url = src if not src.startswith("//") else f"https:{src}"
            image_url = urljoin(ctx.page.url, image_url)
            response = await ctx.page.context.request.get(image_url)
            if response.ok:
                return await response.body()

    return await locator.screenshot()


def _apply_ocr_range(ocr: Any, range_mode: str, custom_charset: str) -> None:
    custom_charset = str(custom_charset or "").strip()
    range_mode = str(range_mode or "none").strip().lower()
    range_mapping: dict[str, Any] = {
        "digits": 0,
        "lower": 1,
        "upper": 2,
        "letters": 3,
        "lower_digits": 4,
        "upper_digits": 5,
        "alnum": 6,
        "special": 7,
    }

    if range_mode == "custom" and custom_charset:
        ocr.set_ranges(custom_charset)
    elif range_mode in range_mapping:
        ocr.set_ranges(range_mapping[range_mode])


def _parse_colors(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    return [item.strip() for item in str(value).split(",") if item.strip()]


def _probability_to_text(probability_result: dict[str, Any]) -> str:
    charsets = probability_result.get("charsets") or []
    probability = probability_result.get("probability") or []
    result = []
    for row in probability:
        if not row:
            continue
        max_index = max(range(len(row)), key=lambda idx: row[idx])
        if 0 <= max_index < len(charsets):
            result.append(str(charsets[max_index]))
    return "".join(result)


def _build_indexed_locator_descriptors(
    data: dict, count: int, node_id: str
) -> list[dict]:
    descriptors = []
    for index in range(count):
        descriptor_params = {
            key: value
            for key, value in data.items()
            if key
            in {
                "selector",
                "selectorType",
                "role",
                "name",
                "testId",
                "label",
                "placeholder",
                "xpath",
                "hasText",
            }
        }
        descriptor_params["index"] = index
        descriptors.append(
            create_locator_descriptor(descriptor_params, node_id=node_id)
        )
    return descriptors


async def _read_locator_value(locator: Any, read_type: str, data: dict) -> Any:
    if read_type == "textContent":
        return await locator.text_content()
    if read_type == "innerText":
        return await locator.inner_text()
    if read_type == "inputValue":
        return await locator.input_value()
    if read_type == "isVisible":
        return await locator.is_visible()
    if read_type == "isEnabled":
        return await locator.is_enabled()
    if read_type == "isChecked":
        return await locator.is_checked()
    if read_type == "getAttribute":
        attr_name = data.get("attribute") or data.get("name")
        return await locator.get_attribute(attr_name)
    raise ValueError(f"Unsupported read type: {read_type}")


async def handle_locator_node(
    ctx, data: dict, normalized_node: dict, result, __: Any
) -> None:
    effective_data = dict(data)
    if (
        effective_data.get("first") is None
        and effective_data.get("last") is None
        and effective_data.get("index") is None
    ):
        effective_data["first"] = True

    locator = resolve_locator_target(ctx, effective_data, normalized_node)
    if locator is None:
        result.status = "skipped"
        result.message = "No selector or target provided"
        return

    if effective_data.get("timeout") is not None:
        await locator.wait_for(
            timeout=int(effective_data.get("timeout")), state="attached"
        )

    node_id = normalized_node["id"]
    ctx.values[node_id] = locator

    result.data = create_locator_descriptor(effective_data, node_id=node_id)
    ctx.outputs[node_id] = result.data
    if (
        data.get("first") is None
        and data.get("last") is None
        and data.get("index") is None
    ):
        result.message = "Locator resolved (defaulted to first match)"
    else:
        result.message = "Locator resolved"


async def handle_count_node(
    ctx, data: dict, normalized_node: dict, result, __: Any
) -> None:
    locator = resolve_locator_target(ctx, data, normalized_node)
    if locator is None:
        result.status = "skipped"
        result.message = "No selector or target provided"
        return

    count = await locator.count()
    node_id = normalized_node["id"]
    result.data = {"result": count, "count": count}
    ctx.outputs[node_id] = result.data
    result.message = f"Counted {count} matched elements"


async def handle_all_node(
    ctx, data: dict, normalized_node: dict, result, __: Any
) -> None:
    locator = resolve_locator_target(ctx, data, normalized_node)
    if locator is None:
        result.status = "skipped"
        result.message = "No selector or target provided"
        return

    count = await locator.count()
    node_id = normalized_node["id"]
    items = _build_indexed_locator_descriptors(data, count, node_id=node_id)
    result.data = {"result": items, "items": items, "count": count}
    ctx.outputs[node_id] = result.data
    result.message = f"Collected {count} locator items"


async def handle_first_node(
    ctx, data: dict, normalized_node: dict, result, __: Any
) -> None:
    target_data = dict(data)
    target_data.pop("first", None)
    target_data.pop("last", None)
    target_data.pop("index", None)

    locator = resolve_locator_target(ctx, target_data, normalized_node)

    if locator is None:
        result.status = "skipped"
        result.message = "No selector or target provided"
        return

    if isinstance(locator, list):
        if not locator:
            result.status = "skipped"
            result.message = "No locator items available"
            return
        first_locator = locator[0]
    else:
        first_locator = locator.first

    node_id = normalized_node["id"]
    ctx.values[node_id] = first_locator

    base_params = dict(data)
    base_params.pop("last", None)
    base_params.pop("index", None)
    base_params["first"] = True
    result.data = create_locator_descriptor(base_params, node_id=node_id)
    ctx.outputs[node_id] = result.data
    result.message = "Selected first locator"


async def handle_last_node(
    ctx, data: dict, normalized_node: dict, result, __: Any
) -> None:
    target_data = dict(data)
    target_data.pop("first", None)
    target_data.pop("last", None)
    target_data.pop("index", None)

    locator = resolve_locator_target(ctx, target_data, normalized_node)
    if locator is None:
        result.status = "skipped"
        result.message = "No selector or target provided"
        return

    if isinstance(locator, list):
        if not locator:
            result.status = "skipped"
            result.message = "No locator items available"
            return
        last_locator = locator[-1]
    else:
        last_locator = locator.last

    node_id = normalized_node["id"]
    ctx.values[node_id] = last_locator

    base_params = dict(data)
    base_params.pop("first", None)
    base_params.pop("index", None)
    base_params["last"] = True
    result.data = create_locator_descriptor(base_params, node_id=node_id)
    ctx.outputs[node_id] = result.data
    result.message = "Selected last locator"


async def handle_nth_node(
    ctx, data: dict, normalized_node: dict, result, __: Any
) -> None:
    target_data = dict(data)
    target_data.pop("index", None)
    target_data.pop("first", None)
    target_data.pop("last", None)

    locator = resolve_locator_target(ctx, target_data, normalized_node)
    if locator is None:
        result.status = "skipped"
        result.message = "No selector or target provided"
        return

    index = data.get("index")
    if index is None:
        index = (normalized_node.get("resolved_inputs", {}) or {}).get("index")
    if index is None:
        result.status = "skipped"
        result.message = "No index provided"
        return

    index = int(index)
    if isinstance(locator, list):
        if index < 0 or index >= len(locator):
            raise IndexError(f"Locator index out of range: {index}")
        nth_locator = locator[index]
    else:
        nth_locator = locator.nth(index)

    node_id = normalized_node["id"]
    ctx.values[node_id] = nth_locator

    base_params = dict(data)
    base_params.pop("first", None)
    base_params.pop("last", None)
    base_params["index"] = index
    result.data = create_locator_descriptor(base_params, node_id=node_id)
    ctx.outputs[node_id] = result.data
    result.message = f"Selected locator at index {index}"


async def handle_text_content_node(
    ctx, data: dict, normalized_node: dict, result, __: Any
) -> None:
    locator = resolve_locator_target(ctx, data, normalized_node)
    if locator is None:
        result.status = "skipped"
        result.message = "No selector or target provided"
        return

    value = await _read_locator_value(locator, "textContent", data)
    node_id = normalized_node["id"]
    result.data = {"result": value, "textContent": value}
    ctx.outputs[node_id] = result.data
    result.message = f"Read textContent: {value}"


async def handle_inner_text_node(
    ctx, data: dict, normalized_node: dict, result, __: Any
) -> None:
    locator = resolve_locator_target(ctx, data, normalized_node)
    if locator is None:
        result.status = "skipped"
        result.message = "No selector or target provided"
        return

    value = await _read_locator_value(locator, "innerText", data)
    node_id = normalized_node["id"]
    result.data = {"result": value, "innerText": value}
    ctx.outputs[node_id] = result.data
    result.message = "Read innerText"


async def handle_input_value_node(
    ctx, data: dict, normalized_node: dict, result, __: Any
) -> None:
    locator = resolve_locator_target(ctx, data, normalized_node)
    if locator is None:
        result.status = "skipped"
        result.message = "No selector or target provided"
        return

    value = await _read_locator_value(locator, "inputValue", data)
    node_id = normalized_node["id"]
    result.data = {"result": value, "inputValue": value}
    ctx.outputs[node_id] = result.data
    result.message = "Read inputValue"


async def handle_get_attribute_node(
    ctx, data: dict, normalized_node: dict, result, __: Any
) -> None:
    locator = resolve_locator_target(ctx, data, normalized_node)
    if locator is None:
        result.status = "skipped"
        result.message = "No selector or target provided"
        return

    attr_name = data.get("attribute") or data.get("name")
    if not attr_name:
        result.status = "skipped"
        result.message = "No attribute name provided"
        return

    value = await _read_locator_value(locator, "getAttribute", data)
    node_id = normalized_node["id"]
    result.data = {"result": value, "attribute": attr_name, "value": value}
    ctx.outputs[node_id] = result.data
    result.message = f"Read attribute {attr_name}:{value}"


async def handle_is_visible_node(
    ctx, data: dict, normalized_node: dict, result, __: Any
) -> None:
    locator = resolve_locator_target(ctx, data, normalized_node)
    if locator is None:
        result.status = "skipped"
        result.message = "No selector or target provided"
        return

    value = await _read_locator_value(locator, "isVisible", data)
    node_id = normalized_node["id"]
    result.data = {"result": value, "isVisible": value}
    ctx.outputs[node_id] = result.data
    result.message = f"Visibility: {value}"


async def handle_is_enabled_node(
    ctx, data: dict, normalized_node: dict, result, __: Any
) -> None:
    locator = resolve_locator_target(ctx, data, normalized_node)
    if locator is None:
        result.status = "skipped"
        result.message = "No selector or target provided"
        return

    value = await _read_locator_value(locator, "isEnabled", data)
    node_id = normalized_node["id"]
    result.data = {"result": value, "isEnabled": value}
    ctx.outputs[node_id] = result.data
    result.message = f"Enabled: {value}"


async def handle_is_checked_node(
    ctx, data: dict, normalized_node: dict, result, __: Any
) -> None:
    locator = resolve_locator_target(ctx, data, normalized_node)
    if locator is None:
        result.status = "skipped"
        result.message = "No selector or target provided"
        return

    value = await _read_locator_value(locator, "isChecked", data)
    node_id = normalized_node["id"]
    result.data = {"result": value, "isChecked": value}
    ctx.outputs[node_id] = result.data
    result.message = f"Checked: {value}"


async def handle_document_node(
    ctx, data: dict, normalized_node: dict, result, __: Any
) -> None:
    node_id = normalized_node["id"]
    result.message = "获取页面 document 对象"
    result.data = {"__type__": "document_ref"}
    ctx.outputs[node_id] = result.data


async def handle_title_node(
    ctx, data: dict, normalized_node: dict, result, __: Any
) -> None:
    value = await ctx.page.title()
    node_id = normalized_node["id"]
    result.data = {"result": value, "title": value}
    ctx.outputs[node_id] = result.data
    result.message = f"Read page title:{value}"


async def handle_url_node(
    ctx, data: dict, normalized_node: dict, result, __: Any
) -> None:
    value = ctx.page.url
    node_id = normalized_node["id"]
    result.data = {"result": value, "url": value}
    ctx.outputs[node_id] = result.data
    result.message = "Read page URL"


async def handle_content_node(
    ctx, data: dict, normalized_node: dict, result, __: Any
) -> None:
    value = await ctx.page.content()
    node_id = normalized_node["id"]
    result.data = {"result": value, "content": value}
    ctx.outputs[node_id] = result.data
    result.message = "Read page content"


async def handle_viewport_node(
    ctx, data: dict, normalized_node: dict, result, __: Any
) -> None:
    viewport = ctx.page.viewport_size
    node_id = normalized_node["id"]
    result.data = {"result": viewport, "viewport": viewport}
    ctx.outputs[node_id] = result.data
    result.message = "Read viewport size"


async def handle_navigate_node(
    ctx, data: dict, normalized_node: dict, result, __: Any
) -> None:
    url = data.get("url")
    if url:
        wait_until = (data.get("waitUntil") or "load").strip()
        timeout = data.get("timeout")
        goto_kwargs = {"wait_until": wait_until}
        if timeout is not None:
            goto_kwargs["timeout"] = int(timeout)

        await ctx.page.goto(url, **goto_kwargs)
        node_id = normalized_node["id"]
        result.data = {"result": ctx.page.url, "url": ctx.page.url}
        ctx.outputs[node_id] = result.data
        result.message = f"Navigated to {url}"
    else:
        result.status = "skipped"
        result.message = "No URL provided"


async def handle_click_node(
    ctx, data: dict, normalized_node: dict, result, __: Any
) -> None:
    locator = resolve_locator_target(ctx, data, normalized_node)
    selector = data.get("selector")
    if locator is not None:
        click_kwargs = {}
        if data.get("button") is not None:
            click_kwargs["button"] = data.get("button")
        if data.get("clickCount") is not None:
            click_kwargs["click_count"] = int(data.get("clickCount"))
        if data.get("timeout") is not None:
            click_kwargs["timeout"] = int(data.get("timeout"))
        if data.get("delay") is not None:
            click_kwargs["delay"] = int(data.get("delay"))
        if data.get("force") is not None:
            click_kwargs["force"] = bool(data.get("force"))
        if data.get("modifiers") is not None:
            click_kwargs["modifiers"] = data.get("modifiers")

        await locator.click(**click_kwargs)
        result.message = f"Clicked {selector or 'target locator'}"
    else:
        result.status = "skipped"
        result.message = "No selector or target provided"


async def handle_fill_node(
    ctx, data: dict, normalized_node: dict, result, __: Any
) -> None:
    locator = resolve_locator_target(ctx, data, normalized_node)
    selector = data.get("selector")
    text = data.get("text")
    if text is None:
        text = (normalized_node.get("resolved_inputs", {}) or {}).get("text", "")

    if locator is not None:
        input_timeout = data.get("timeout")
        if input_timeout is not None:
            await locator.fill(str(text or ""), timeout=int(input_timeout))
        else:
            await locator.fill(str(text or ""))
        result.message = f"Filled {selector or 'target locator'}"
    else:
        result.status = "skipped"
        result.message = "No selector or target provided"


async def handle_type_node(
    ctx, data: dict, normalized_node: dict, result, __: Any
) -> None:
    locator = resolve_locator_target(ctx, data, normalized_node)
    selector = data.get("selector")
    text = data.get("text")
    if text is None:
        text = (normalized_node.get("resolved_inputs", {}) or {}).get("text", "")

    if locator is None:
        result.status = "skipped"
        result.message = "No selector or target provided"
        return

    type_kwargs = {}
    if data.get("delay") is not None:
        type_kwargs["delay"] = int(data.get("delay"))
    if data.get("timeout") is not None:
        type_kwargs["timeout"] = int(data.get("timeout"))

    await locator.type(str(text or ""), **type_kwargs)
    result.message = f"Typed into {selector or 'target locator'}"


async def handle_press_node(
    ctx, data: dict, normalized_node: dict, result, __: Any
) -> None:
    locator = resolve_locator_target(ctx, data, normalized_node)
    selector = data.get("selector")
    key = data.get("key") or (normalized_node.get("resolved_inputs", {}) or {}).get(
        "key"
    )

    if not key:
        result.status = "skipped"
        result.message = "No key provided"
        return

    press_kwargs = {}
    if data.get("delay") is not None:
        press_kwargs["delay"] = int(data.get("delay"))
    if data.get("timeout") is not None:
        press_kwargs["timeout"] = int(data.get("timeout"))

    if locator is not None:
        await locator.press(str(key), **press_kwargs)
        result.message = f"Pressed {key} on {selector or 'target locator'}"
        return

    page_press_kwargs = {}
    if data.get("delay") is not None:
        page_press_kwargs["delay"] = int(data.get("delay"))

    await ctx.page.keyboard.press(str(key), **page_press_kwargs)
    result.message = f"Pressed {key} on page"


async def handle_hover_node(
    ctx, data: dict, normalized_node: dict, result, __: Any
) -> None:
    locator = resolve_locator_target(ctx, data, normalized_node)
    selector = data.get("selector")

    if locator is None:
        result.status = "skipped"
        result.message = "No selector or target provided"
        return

    hover_kwargs = {}
    if data.get("timeout") is not None:
        hover_kwargs["timeout"] = int(data.get("timeout"))
    if data.get("force") is not None:
        hover_kwargs["force"] = bool(data.get("force"))

    await locator.hover(**hover_kwargs)
    result.message = f"Hovered {selector or 'target locator'}"


def _captcha_base64_to_bytes(value: str) -> bytes:
    value = str(value or "").strip()
    if not value:
        return b""
    if "," in value:
        value = value.split(",", 1)[1]
    return base64.b64decode(value)


def _validate_captcha_image_bytes(image_bytes: bytes, image_name: str) -> bytes:
    if not image_bytes:
        raise ValueError(f"{image_name} 为空，无法进行滑块识别")
    return image_bytes


async def _captcha_get_distance(ctx, data: dict) -> int:
    bg_selector = str(data.get("backgroundSelector") or "").strip()
    piece_selector = str(data.get("sliderImageSelector") or "").strip()
    offset = int(data.get("offset") or 0)

    if not bg_selector or not piece_selector:
        raise ValueError("缺少背景图或滑块图选择器")

    try:
        bg_bytes = await _read_image_bytes_from_source(ctx, selector=bg_selector)
    except Exception as exc:
        raise ValueError(f"读取滑块背景图失败: {exc}") from exc

    try:
        piece_bytes = await _read_image_bytes_from_source(ctx, selector=piece_selector)
    except Exception as exc:
        raise ValueError(f"读取滑块拼图失败: {exc}") from exc

    bg_bytes = _validate_captcha_image_bytes(bg_bytes, "滑块背景图")
    piece_bytes = _validate_captcha_image_bytes(piece_bytes, "滑块拼图")

    ocr = _get_ddddocr_instance("slide")
    try:
        match_result = ocr.slide_match(piece_bytes, bg_bytes)
    except Exception as exc:
        raise ValueError(
            f"滑块识别失败，请检查背景图/拼图选择器是否正确: {exc}"
        ) from exc
    target = match_result.get("target") or [0, 0]

    return int(target[0]) + offset


async def handle_ocr_captcha_node(
    ctx, data: dict, normalized_node: dict, result, __: Any
) -> None:
    image_selector = str(data.get("imageSelector") or "").strip()
    image_base64 = str(data.get("imageBase64") or "").strip()
    probability = _to_bool(data.get("probability"), False)
    png_fix = _to_bool(data.get("pngFix"), False)
    beta = _to_bool(data.get("beta"), False)
    custom_charset = str(data.get("customCharset") or "").strip()
    range_mode = str(data.get("rangeMode") or "none").strip().lower()
    colors = _parse_colors(data.get("colors"))
    custom_color_ranges_raw = str(data.get("customColorRanges") or "").strip()
    node_id = normalized_node["id"]

    image_bytes = await _read_image_bytes_from_source(
        ctx,
        selector=image_selector,
        image_base64=image_base64,
    )

    ocr = _get_ddddocr_instance("ocr", beta=beta)
    _apply_ocr_range(ocr, range_mode, custom_charset)

    classify_kwargs: dict[str, Any] = {
        "probability": probability,
        "png_fix": png_fix,
    }
    if colors:
        classify_kwargs["colors"] = colors
    if custom_color_ranges_raw:
        classify_kwargs["custom_color_ranges"] = json.loads(custom_color_ranges_raw)

    ocr_result = ocr.classification(image_bytes, **classify_kwargs)
    text = (
        ocr_result if isinstance(ocr_result, str) else _probability_to_text(ocr_result)
    )

    result.data = {
        "result": ocr_result,
        "text": text,
        "probability": ocr_result if isinstance(ocr_result, dict) else None,
        "source": "base64" if image_base64 else "selector",
        "rangeMode": range_mode,
        "colors": colors,
    }
    ctx.outputs[node_id] = result.data
    result.message = f"OCR 识别完成: {text}"


async def _captcha_resolve_drag_handle(ctx, data: dict, normalized_node: dict):
    handle = resolve_locator_target(
        ctx,
        {
            "selector": data.get("handleSelector"),
            "selectorType": data.get("handleSelectorType") or "native",
            "target": data.get("target"),
        },
        normalized_node,
    )
    return handle


async def _captcha_drag(ctx, locator: Any, distance: float, data: dict) -> dict:
    box = await locator.bounding_box()
    if box is None:
        raise ValueError("无法获取滑块位置")

    start_x = box["x"] + box["width"] / 2
    start_y = box["y"] + box["height"] / 2
    overshoot = float(data.get("overshoot") or 8)
    backtrack = float(data.get("backtrack") or 2)
    min_step = max(1, int(data.get("minStep") or 5))
    max_step = max(min_step, int(data.get("maxStep") or 12))
    move_delay = max(0, int(data.get("moveDelayMs") or 20))
    steps_used = 0
    current = 0.0

    await ctx.page.mouse.move(start_x, start_y)
    await ctx.page.mouse.down()

    while current < distance:
        step = min(
            max_step,
            max(
                min_step,
                (
                    max_step
                    if distance - current > max_step
                    else int(distance - current) or min_step
                ),
            ),
        )
        current += step
        steps_used += 1
        await ctx.page.mouse.move(start_x + current, start_y)
        if move_delay:
            await ctx.page.wait_for_timeout(move_delay)

    if overshoot > 0:
        await ctx.page.mouse.move(start_x + distance + overshoot, start_y)
        if move_delay:
            await ctx.page.wait_for_timeout(move_delay)
    if backtrack > 0:
        await ctx.page.mouse.move(start_x + distance - backtrack, start_y)
        if move_delay:
            await ctx.page.wait_for_timeout(move_delay)

    hold_after = max(0, int(data.get("holdBeforeReleaseMs") or 100))
    if hold_after:
        await ctx.page.wait_for_timeout(hold_after)
    await ctx.page.mouse.up()

    return {
        "startX": start_x,
        "startY": start_y,
        "distance": distance,
        "stepsUsed": steps_used,
    }


async def _captcha_try_click_selector(
    ctx, selector: str, timeout: int, *, label: str
) -> bool:
    selector = str(selector or "").strip()
    if not selector:
        return False

    candidates = [item.strip() for item in selector.split("||") if item.strip()]
    for candidate in candidates:
        try:
            await ctx.page.locator(candidate).first.click(timeout=timeout)
            return True
        except Exception:
            continue

    return False


async def _captcha_prepare_next_attempt(ctx, data: dict) -> dict:
    refresh_timeout = max(0, int(data.get("refreshTimeout") or 5000))
    refresh_wait_ms = max(0, int(data.get("refreshWaitMs") or 1500))
    retry_trigger_selector = str(data.get("retryTriggerSelector") or "").strip()
    refresh_selector = str(data.get("refreshSelector") or "").strip()

    retry_clicked = await _captcha_try_click_selector(
        ctx,
        retry_trigger_selector,
        refresh_timeout,
        label="retry trigger",
    )
    refresh_clicked = await _captcha_try_click_selector(
        ctx,
        refresh_selector,
        refresh_timeout,
        label="refresh",
    )

    if (retry_clicked or refresh_clicked) and refresh_wait_ms:
        await ctx.page.wait_for_timeout(refresh_wait_ms)

    return {
        "retryTriggered": retry_clicked,
        "refreshed": refresh_clicked,
    }


async def _captcha_selector_hidden(ctx, selector: str) -> bool:
    selector = str(selector or "").strip()
    if not selector:
        return False

    try:
        locator = ctx.page.locator(selector).first
        count = await ctx.page.locator(selector).count()
        if count == 0:
            return True
        return not await locator.is_visible(timeout=300)
    except Exception:
        return True


async def handle_slider_captcha_node(
    ctx, data: dict, normalized_node: dict, result, __: Any
) -> None:
    max_retry = max(1, int(data.get("maxRetry") or 3))
    wait_after_drag = max(0, int(data.get("waitAfterDragMs") or 3000))
    success_selector = str(data.get("successSelector") or "").strip()
    success_text = str(data.get("successText") or "").strip()
    bg_selector = str(data.get("backgroundSelector") or "").strip()
    piece_selector = str(data.get("sliderImageSelector") or "").strip()
    node_id = normalized_node["id"]

    if not success_selector and not success_text:
        result.status = "skipped"
        result.message = "缺少成功判定条件"
        return

    handle_locator = await _captcha_resolve_drag_handle(ctx, data, normalized_node)
    if handle_locator is None:
        result.status = "skipped"
        result.message = "No handle selector or target provided"
        return

    last_distance = None
    last_error = None
    last_prepare_info = {"retryTriggered": False, "refreshed": False}

    async def success_check() -> bool:
        try:
            if success_selector:
                visible = await ctx.page.locator(success_selector).first.is_visible(
                    timeout=int(data.get("successTimeout") or 5000)
                )
                if visible:
                    return True
        except Exception:
            pass

        if success_text:
            try:
                return await ctx.page.get_by_text(success_text).first.is_visible(
                    timeout=int(data.get("successTimeout") or 5000)
                )
            except Exception:
                return False
        return False

    for attempt in range(1, max_retry + 1):
        try:
            print(f"开始第{attempt}次尝试")
            distance = await _captcha_get_distance(ctx, data)
            last_distance = distance

            drag_info = await _captcha_drag(ctx, handle_locator, float(distance), data)

            if wait_after_drag:
                await ctx.page.wait_for_timeout(wait_after_drag)

            if await success_check():
                result.data = {
                    "result": True,
                    "success": True,
                    "attempt": attempt,
                    "distance": distance,
                    **last_prepare_info,
                    **drag_info,
                }
                ctx.outputs[node_id] = result.data
                result.message = f"Slider captcha solved on attempt {attempt}"
                return

            bg_hidden = await _captcha_selector_hidden(ctx, bg_selector)
            piece_hidden = await _captcha_selector_hidden(ctx, piece_selector)
            if bg_hidden or piece_hidden:
                result.data = {
                    "result": True,
                    "success": True,
                    "attempt": attempt,
                    "distance": distance,
                    "completedBy": "captcha-hidden",
                    **last_prepare_info,
                    **drag_info,
                }
                ctx.outputs[node_id] = result.data
                result.message = f"Slider captcha solved on attempt {attempt}"
                return

            last_prepare_info = await _captcha_prepare_next_attempt(ctx, data)
        except Exception as exc:
            last_error = str(exc)
            last_prepare_info = await _captcha_prepare_next_attempt(ctx, data)

    result.status = "failed"
    result.error = last_error or "滑块验证失败"
    result.message = f"Slider captcha failed after {max_retry} attempts"
    result.data = {
        "result": False,
        "success": False,
        "attempts": max_retry,
        "distance": last_distance,
        **last_prepare_info,
    }
    ctx.outputs[node_id] = result.data


async def handle_mouse_node(
    ctx, data: dict, normalized_node: dict, result, __: Any
) -> None:
    action = str(data.get("action", "click") or "click").lower()
    locator = resolve_locator_target(ctx, data, normalized_node)
    selector = data.get("selector")
    node_id = normalized_node["id"]

    x = data.get("x")
    y = data.get("y")
    button = str(data.get("button", "left") or "left")
    click_count = int(data.get("clickCount", 2 if action == "dblclick" else 1) or 1)
    delay = data.get("delay")
    timeout = data.get("timeout")
    steps = int(data.get("steps", 1) or 1)

    async def resolve_point() -> tuple[float, float]:
        if x not in (None, "") and y not in (None, ""):
            return float(x), float(y)

        if locator is not None:
            box = await locator.bounding_box()
            if box is None:
                raise ValueError("无法获取目标元素位置")
            return box["x"] + box["width"] / 2, box["y"] + box["height"] / 2

        raise ValueError("未提供可用的坐标或目标元素")

    if action == "click":
        if locator is not None:
            click_kwargs = {"button": button, "click_count": click_count}
            if delay not in (None, ""):
                click_kwargs["delay"] = int(delay)
            if timeout not in (None, ""):
                click_kwargs["timeout"] = int(timeout)
            await locator.click(**click_kwargs)
            result.message = f"Mouse clicked {selector or 'target locator'}"
        else:
            target_x, target_y = await resolve_point()
            page_click_kwargs = {"button": button, "click_count": click_count}
            if delay not in (None, ""):
                page_click_kwargs["delay"] = int(delay)
            await ctx.page.mouse.click(target_x, target_y, **page_click_kwargs)
            result.message = f"Mouse clicked at ({target_x}, {target_y})"
        result.data = {"result": action, "action": action, "button": button}
        ctx.outputs[node_id] = result.data
        return

    if action == "dblclick":
        if locator is not None:
            click_kwargs = {"button": button, "click_count": 2}
            if delay not in (None, ""):
                click_kwargs["delay"] = int(delay)
            if timeout not in (None, ""):
                click_kwargs["timeout"] = int(timeout)
            await locator.click(**click_kwargs)
            result.message = f"Mouse double-clicked {selector or 'target locator'}"
        else:
            target_x, target_y = await resolve_point()
            page_click_kwargs = {"button": button, "click_count": 2}
            if delay not in (None, ""):
                page_click_kwargs["delay"] = int(delay)
            await ctx.page.mouse.click(target_x, target_y, **page_click_kwargs)
            result.message = f"Mouse double-clicked at ({target_x}, {target_y})"
        result.data = {"result": action, "action": action, "button": button}
        ctx.outputs[node_id] = result.data
        return

    if action == "move":
        target_x, target_y = await resolve_point()
        await ctx.page.mouse.move(target_x, target_y, steps=steps)
        result.message = f"Mouse moved to ({target_x}, {target_y})"
        result.data = {
            "result": action,
            "action": action,
            "x": target_x,
            "y": target_y,
            "steps": steps,
        }
        ctx.outputs[node_id] = result.data
        return

    if action == "down":
        if locator is not None or (x not in (None, "") and y not in (None, "")):
            target_x, target_y = await resolve_point()
            await ctx.page.mouse.move(target_x, target_y, steps=steps)
        await ctx.page.mouse.down(button=button)
        result.message = f"Mouse button down: {button}"
        result.data = {"result": action, "action": action, "button": button}
        ctx.outputs[node_id] = result.data
        return

    if action == "up":
        if locator is not None or (x not in (None, "") and y not in (None, "")):
            target_x, target_y = await resolve_point()
            await ctx.page.mouse.move(target_x, target_y, steps=steps)
        await ctx.page.mouse.up(button=button)
        result.message = f"Mouse button up: {button}"
        result.data = {"result": action, "action": action, "button": button}
        ctx.outputs[node_id] = result.data
        return

    result.status = "skipped"
    result.message = f"Unsupported mouse action: {action}"


async def handle_check_node(
    ctx, data: dict, normalized_node: dict, result, __: Any
) -> None:
    locator = resolve_locator_target(ctx, data, normalized_node)
    selector = data.get("selector")

    if locator is None:
        result.status = "skipped"
        result.message = "No selector or target provided"
        return

    check_kwargs = {}
    if data.get("timeout") is not None:
        check_kwargs["timeout"] = int(data.get("timeout"))
    if data.get("force") is not None:
        check_kwargs["force"] = bool(data.get("force"))

    await locator.check(**check_kwargs)
    result.message = f"Checked {selector or 'target locator'}"


async def handle_uncheck_node(
    ctx, data: dict, normalized_node: dict, result, __: Any
) -> None:
    locator = resolve_locator_target(ctx, data, normalized_node)
    selector = data.get("selector")

    if locator is None:
        result.status = "skipped"
        result.message = "No selector or target provided"
        return

    uncheck_kwargs = {}
    if data.get("timeout") is not None:
        uncheck_kwargs["timeout"] = int(data.get("timeout"))
    if data.get("force") is not None:
        uncheck_kwargs["force"] = bool(data.get("force"))

    await locator.uncheck(**uncheck_kwargs)
    result.message = f"Unchecked {selector or 'target locator'}"


async def handle_select_option_node(
    ctx, data: dict, normalized_node: dict, result, __: Any
) -> None:
    locator = resolve_locator_target(ctx, data, normalized_node)
    selector = data.get("selector")
    option_value = data.get("value")
    if option_value is None:
        option_value = (normalized_node.get("resolved_inputs", {}) or {}).get("value")

    if locator is None:
        result.status = "skipped"
        result.message = "No selector or target provided"
        return
    if option_value is None:
        result.status = "skipped"
        result.message = "No option value provided"
        return

    select_kwargs = {}
    if data.get("timeout") is not None:
        select_kwargs["timeout"] = int(data.get("timeout"))

    selected = await locator.select_option(option_value, **select_kwargs)
    node_id = normalized_node["id"]
    result.data = {"result": selected, "selected": selected}
    ctx.outputs[node_id] = result.data
    result.message = f"Selected option on {selector or 'target locator'}"


async def handle_screenshot_node(
    ctx, data: dict, normalized_node: dict, result, __: Any
) -> None:
    node_id = normalized_node.get("id") or "unknown"
    execution_id = ctx.item.execution_id
    screenshot_dir = build_screenshot_dir(ctx.item.user_id, execution_id, node_id)
    os.makedirs(screenshot_dir, exist_ok=True)

    filename = data.get("path", "screenshot.png")
    path = (
        os.path.join(screenshot_dir, filename)
        if not os.path.isabs(filename)
        else filename
    )
    await ctx.page.screenshot(path=path)
    result.message = f"Screenshot saved to {path}"
    result.data = {
        "path": path,
        "filename": os.path.basename(path),
        "execution_id": execution_id,
        "node_id": node_id,
        "has_screenshot": True,
    }
    ctx.outputs[node_id] = result.data


async def handle_scroll_node(
    ctx, data: dict, normalized_node: dict, result, __: Any
) -> None:
    node_id = normalized_node["id"]
    action = str(data.get("action", "by") or "by").lower()
    locator = resolve_locator_target(ctx, data, normalized_node)
    selector = data.get("selector")

    x = data.get("x")
    y = data.get("y")
    delta_x = data.get("deltaX")
    delta_y = data.get("deltaY")
    behavior = str(data.get("behavior", "auto") or "auto").lower()

    def _to_float(value: Any, default: float = 0) -> float:
        if value in (None, ""):
            return default
        return float(value)

    if action == "element":
        if locator is None:
            result.status = "skipped"
            result.message = "No selector or target provided"
            return

        scroll_options = {}
        if behavior in {"auto", "smooth"}:
            scroll_options["behavior"] = behavior

        await locator.scroll_into_view_if_needed()
        if scroll_options:
            await locator.evaluate(
                """(element, options) => element.scrollIntoView(options)""",
                scroll_options,
            )

        result.data = {
            "result": action,
            "action": action,
            "selector": selector,
            "behavior": behavior,
        }
        ctx.outputs[node_id] = result.data
        result.message = f"Scrolled to element {selector or 'target locator'}"
        return

    if action == "to":
        target_x = _to_float(x, 0)
        target_y = _to_float(y, 0)
        await ctx.page.evaluate(
            """([scrollX, scrollY, scrollBehavior]) => {
                window.scrollTo({ left: scrollX, top: scrollY, behavior: scrollBehavior });
                return { x: window.scrollX, y: window.scrollY };
            }""",
            [
                target_x,
                target_y,
                behavior if behavior in {"auto", "smooth"} else "auto",
            ],
        )
        result.data = {
            "result": action,
            "action": action,
            "x": target_x,
            "y": target_y,
            "behavior": behavior,
        }
        ctx.outputs[node_id] = result.data
        result.message = f"Scrolled to ({target_x}, {target_y})"
        return

    if action == "top":
        await ctx.page.evaluate(
            """(scrollBehavior) => {
                window.scrollTo({ left: 0, top: 0, behavior: scrollBehavior });
                return { x: window.scrollX, y: window.scrollY };
            }""",
            behavior if behavior in {"auto", "smooth"} else "auto",
        )
        result.data = {
            "result": action,
            "action": action,
            "x": 0,
            "y": 0,
            "behavior": behavior,
        }
        ctx.outputs[node_id] = result.data
        result.message = "Scrolled to top"
        return

    if action == "bottom":
        await ctx.page.evaluate(
            """(scrollBehavior) => {
                window.scrollTo({
                    left: 0,
                    top: Math.max(document.body.scrollHeight, document.documentElement.scrollHeight),
                    behavior: scrollBehavior,
                });
                return { x: window.scrollX, y: window.scrollY };
            }""",
            behavior if behavior in {"auto", "smooth"} else "auto",
        )
        result.data = {
            "result": action,
            "action": action,
            "behavior": behavior,
        }
        ctx.outputs[node_id] = result.data
        result.message = "Scrolled to bottom"
        return

    scroll_dx = _to_float(delta_x, 0)
    scroll_dy = _to_float(delta_y, _to_float(y, 500))
    await ctx.page.mouse.wheel(scroll_dx, scroll_dy)
    result.data = {
        "result": "by",
        "action": "by",
        "deltaX": scroll_dx,
        "deltaY": scroll_dy,
    }
    ctx.outputs[node_id] = result.data
    result.message = f"Scrolled by ({scroll_dx}, {scroll_dy})"


async def handle_wait_node(
    ctx, data: dict, normalized_node: dict, result, __: Any
) -> None:
    locator = resolve_locator_target(ctx, data, normalized_node)
    selector = data.get("selector")
    duration = data.get("duration", 30000)
    if locator is not None and (
        selector
        or (normalized_node.get("resolved_inputs", {}) or {}).get("target") is not None
    ):
        await locator.wait_for(timeout=duration)
        result.status = "success"
        result.message = f"Waited for {selector or 'target locator'}"
    else:
        await ctx.page.wait_for_timeout(duration)
        result.status = "success"
        result.message = f"Waited {duration}ms"


async def handle_wait_for_node(
    ctx, data: dict, normalized_node: dict, result, __: Any
) -> None:
    locator = resolve_locator_target(ctx, data, normalized_node)
    duration = data.get("duration", 30000)
    state = data.get("state")

    if locator is None:
        result.status = "skipped"
        result.message = "No selector or target provided"
        return

    wait_kwargs = {"timeout": duration}
    if state:
        wait_kwargs["state"] = state

    await locator.wait_for(**wait_kwargs)
    result.message = f"Waited for locator with state {state or 'visible'}"


async def handle_wait_for_url_node(
    ctx, data: dict, normalized_node: dict, result, __: Any
) -> None:
    url = data.get("url")
    duration = data.get("duration", 30000)
    wait_until = data.get("waitUntil")

    if not url:
        result.status = "skipped"
        result.message = "No URL provided"
        return

    wait_kwargs = {"timeout": duration}
    if wait_until:
        wait_kwargs["wait_until"] = wait_until

    await ctx.page.wait_for_url(url, **wait_kwargs)
    node_id = normalized_node["id"]
    result.data = {"result": ctx.page.url, "url": ctx.page.url}
    ctx.outputs[node_id] = result.data
    result.message = f"Waited for URL {url}"


async def handle_wait_for_load_state_node(
    ctx, data: dict, normalized_node: dict, result, __: Any
) -> None:
    duration = data.get("duration", 30000)
    state = data.get("state") or data.get("loadState") or "load"

    await ctx.page.wait_for_load_state(state=state, timeout=duration)
    node_id = normalized_node["id"]
    result.data = {"result": state, "state": state, "url": ctx.page.url}
    ctx.outputs[node_id] = result.data
    result.message = f"Waited for load state {state}"


async def handle_script_node(
    ctx, data: dict, normalized_node: dict, result, __: Any
) -> None:
    script = data.get("script")
    if script:
        script_result = await ctx.page.evaluate(script)
        node_id = normalized_node["id"]
        result.message = "Script executed"
        result.data = {"result": script_result}
        ctx.outputs[node_id] = result.data
    else:
        result.status = "skipped"
        result.message = "No script provided"


async def handle_new_page_node(
    ctx, data: dict, normalized_node: dict, result, __: Any
) -> None:
    node_id = normalized_node["id"]
    name = data.get("name", f"page_{len(ctx.pages)}")
    page = await ctx.sandbox.create_page(name)
    result.data = {
        "result": name,
        "name": name,
        "url": page.url,
        "pages": list(ctx.pages.keys()),
        "currentPage": getattr(ctx.sandbox, "current_page", "main"),
    }
    ctx.outputs[node_id] = result.data
    result.message = f"Created page: {name}"


async def handle_switch_page_node(
    ctx, data: dict, normalized_node: dict, result, __: Any
) -> None:
    node_id = normalized_node["id"]
    name = data.get("name", "main")
    if await ctx.sandbox.switch_page(name):
        current_page = ctx.sandbox.get_current_page()
        result.data = {
            "result": name,
            "name": name,
            "url": current_page.url if current_page else None,
            "pages": list(ctx.pages.keys()),
            "currentPage": getattr(ctx.sandbox, "current_page", name),
        }
        ctx.outputs[node_id] = result.data
        result.message = f"Switched to page: {name}"
    else:
        result.status = "failed"
        result.error = f"Page not found: {name}"


async def handle_close_page_node(
    ctx, data: dict, normalized_node: dict, result, __: Any
) -> None:
    node_id = normalized_node["id"]
    name = data.get("name")
    if name and await ctx.sandbox.close_page(name):
        current_name = getattr(ctx.sandbox, "current_page", "main")
        current_page = ctx.sandbox.get_current_page()
        result.data = {
            "result": name,
            "closed": name,
            "pages": list(ctx.pages.keys()),
            "currentPage": current_name,
            "url": current_page.url if current_page else None,
        }
        ctx.outputs[node_id] = result.data
        result.message = f"Closed page: {name}"
    else:
        result.status = "skipped"
        result.message = "Cannot close main page or page not found"


async def handle_current_page_node(
    ctx, data: dict, normalized_node: dict, result, __: Any
) -> None:
    node_id = normalized_node["id"]
    current_name = getattr(ctx.sandbox, "current_page", "main")
    current_page = ctx.sandbox.get_current_page()
    result.data = {
        "result": current_name,
        "name": current_name,
        "url": current_page.url if current_page else None,
        "pages": list(ctx.pages.keys()),
    }
    ctx.outputs[node_id] = result.data
    result.message = f"Current page: {current_name}"


async def handle_check_existence_node(
    ctx, data: dict, normalized_node: dict, result, __: Any
) -> None:
    locator = resolve_locator_target(ctx, data, normalized_node)
    selector = data.get("selector")
    if locator is not None:
        try:
            timeout = data.get("timeout")
            count = None
            if timeout is not None:
                try:
                    await locator.first.wait_for(
                        timeout=int(timeout),
                        state="attached",
                    )
                    exists = True
                except Exception:
                    exists = False
            else:
                count = await locator.count()
                exists = count > 0
            node_id = normalized_node["id"]
            result.data = {
                "result": exists,
                "exists": exists,
                "count": count,
                "timeout": timeout,
            }
            ctx.outputs[node_id] = result.data
            result.message = (
                f"元素 {selector or 'target locator'} {'存在' if exists else '不存在'}"
            )
        except Exception as e:
            result.status = "failed"
            result.error = str(e)
            result.message = f"检查元素失败: {selector or 'target locator'}"
    else:
        result.status = "skipped"
        result.message = "未提供选择器或 target"
