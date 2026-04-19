from __future__ import annotations

import json
from typing import Any

import httpx


def _parse_json_object(raw_value: Any, field_name: str) -> dict[str, Any]:
    if raw_value in (None, ""):
        return {}
    if isinstance(raw_value, dict):
        return raw_value
    if not isinstance(raw_value, str):
        raise ValueError(f"{field_name} must be a JSON object")

    parsed = json.loads(raw_value)
    if not isinstance(parsed, dict):
        raise ValueError(f"{field_name} must be a JSON object")
    return parsed


def _build_request_content(body_type: str, body: Any) -> tuple[Any, str | None]:
    if body in (None, ""):
        return None, None

    if body_type == "none":
        if isinstance(body, (dict, list)):
            return json.dumps(body, ensure_ascii=False), "application/json"
        if isinstance(body, str):
            stripped = body.strip()
            if not stripped:
                return None, None
            if stripped.startswith("{") or stripped.startswith("["):
                parsed = json.loads(stripped)
                return json.dumps(parsed, ensure_ascii=False), "application/json"
            return str(body), "text/plain"
        return str(body), "text/plain"

    if body_type == "json":
        if isinstance(body, (dict, list)):
            return json.dumps(body, ensure_ascii=False), "application/json"
        if isinstance(body, str):
            parsed = json.loads(body)
            return json.dumps(parsed, ensure_ascii=False), "application/json"
        raise ValueError("JSON body must be valid JSON")

    if body_type == "form":
        return _parse_json_object(body, "Body"), None

    return str(body), "text/plain"


async def handle_http_request_node(
    ctx, data: dict, normalized_node: dict, result, __: Any
) -> None:
    method = str(data.get("method") or "GET").upper()
    url = data.get("url") or (normalized_node.get("resolved_inputs", {}) or {}).get(
        "url"
    )
    if not url:
        result.status = "skipped"
        result.message = "No URL provided"
        return

    headers = _parse_json_object(data.get("headers"), "Headers")
    params = _parse_json_object(data.get("query"), "Query")
    body_type = str(data.get("bodyType") or "none").lower()
    timeout_ms = int(data.get("timeout") or 30000)
    response_type = str(data.get("responseType") or "auto").lower()
    follow_redirects = str(data.get("followRedirects") or "true").lower() == "true"

    request_body, inferred_content_type = _build_request_content(
        body_type, data.get("body")
    )

    if inferred_content_type is not None and "content-type" not in {
        str(key).lower() for key in headers.keys()
    }:
        headers["Content-Type"] = inferred_content_type

    timeout = httpx.Timeout(timeout_ms / 1000)
    async with httpx.AsyncClient(
        timeout=timeout, follow_redirects=follow_redirects
    ) as client:
        request_kwargs = {
            "method": method,
            "url": str(url),
            "headers": headers or None,
            "params": params or None,
        }
        if body_type == "form" and isinstance(request_body, dict):
            request_kwargs["data"] = request_body
        elif request_body is not None:
            request_kwargs["content"] = request_body

        response = await client.request(
            **request_kwargs,
        )

    content_type = response.headers.get("content-type", "")
    parsed_body: Any
    if response_type == "json" or (
        response_type == "auto" and "application/json" in content_type.lower()
    ):
        try:
            parsed_body = response.json()
        except Exception:
            parsed_body = response.text
    else:
        parsed_body = response.text

    node_id = normalized_node["id"]
    result.data = {
        "result": parsed_body,
        "status": response.status_code,
        "ok": response.is_success,
        "url": str(response.url),
        "method": method,
        "headers": dict(response.headers),
        "body": parsed_body,
        "contentType": content_type,
    }
    ctx.outputs[node_id] = result.data

    if response.is_success:
        result.message = f"HTTP {method} {response.status_code}"
    else:
        result.status = "failed"
        result.message = f"HTTP {method} {response.status_code}"
        result.error = response.text[:1000]
