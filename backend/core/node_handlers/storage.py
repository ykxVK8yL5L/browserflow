from __future__ import annotations

from datetime import datetime
from typing import Any


async def handle_cookie_node(
    ctx, data: dict, normalized_node: dict, result, __: Any
) -> None:
    node_id = normalized_node["id"]
    action = data.get("action", "get")
    url = data.get("url") or None
    name = data.get("name")
    value = data.get("value", "")
    path = data.get("path", "/") or "/"
    domain = data.get("domain") or None
    expires = data.get("expires")
    secure = data.get("secure")
    http_only = data.get("httpOnly")
    same_site = data.get("sameSite") or None

    if action == "get":
        cookies = await ctx.page.context.cookies(url)
        if name:
            cookie = next((c for c in cookies if c["name"] == name), None)
            if cookie:
                result.message = f"获取到 Cookie: {name} \n 结果为:{cookie}"
                result.data = {"cookie": cookie}
            else:
                result.message = f"未找到 Cookie: {name}"
                result.data = {"cookie": None}
        else:
            result.message = f"获取到 {len(cookies)} 个 Cookie"
            result.data = {"cookies": cookies}
        ctx.outputs[node_id] = result.data
    elif action == "set":
        cookie_params = {"name": name, "value": value, "path": path}
        if url:
            cookie_params["url"] = url
        if domain:
            cookie_params["domain"] = domain
        if expires:
            cookie_params["expires"] = datetime.utcnow().timestamp() + int(expires)
        if secure:
            cookie_params["secure"] = secure == "true"
        if http_only:
            cookie_params["httpOnly"] = http_only == "true"
        if same_site:
            cookie_params["sameSite"] = same_site

        await ctx.page.context.add_cookies([cookie_params])
        result.message = f"设置 Cookie: {name}={value}"
        result.data = {"cookie": cookie_params}
        ctx.outputs[node_id] = result.data
    elif action == "clear":
        if name:
            cookies = await ctx.page.context.cookies(url)
            cookies_to_delete = [c for c in cookies if c["name"] == name]
            if cookies_to_delete:
                await ctx.page.context.clear_cookies()
                await ctx.page.context.add_cookies(
                    [c for c in cookies if c["name"] != name]
                )
                result.message = f"清除 Cookie: {name}"
            else:
                result.message = f"未找到 Cookie: {name}"
        else:
            await ctx.page.context.clear_cookies()
            result.message = "已清除所有 Cookie"
        result.data = {"cleared": True}
        ctx.outputs[node_id] = result.data
    else:
        result.status = "skipped"
        result.message = f"未知操作: {action}"


async def handle_localstorage_node(
    ctx, data: dict, normalized_node: dict, result, __: Any
) -> None:
    action = data.get("action", "get")
    key = data.get("key")
    value = data.get("value", "")
    node_id = normalized_node["id"]

    if action == "get":
        if key:
            storage_value = await ctx.page.evaluate(
                """([storageKey]) => window.localStorage.getItem(storageKey)""",
                [key],
            )
            if storage_value is None:
                result.message = f"未找到 localStorage: {key}"
            else:
                result.message = f"获取到 localStorage: {key}\n 结果为: {storage_value}"
            result.data = {"key": key, "value": storage_value}
        else:
            entries = await ctx.page.evaluate(
                """
                () => {
                    const result = {};
                    for (let i = 0; i < window.localStorage.length; i += 1) {
                        const storageKey = window.localStorage.key(i);
                        if (storageKey !== null) {
                            result[storageKey] = window.localStorage.getItem(storageKey);
                        }
                    }
                    return result;
                }
                """
            )
            result.message = f"获取到 {len(entries)} 个 localStorage 项"
            result.data = {"entries": entries}
        ctx.outputs[node_id] = result.data
    elif action == "set":
        if not key:
            result.status = "skipped"
            result.message = "缺少 localStorage key"
        else:
            await ctx.page.evaluate(
                """([storageKey, storageValue]) => window.localStorage.setItem(storageKey, storageValue)""",
                [key, str(value)],
            )
            result.message = f"设置 localStorage: {key}"
            result.data = {"key": key, "value": str(value)}
            ctx.outputs[node_id] = result.data
    elif action == "clear":
        if key:
            existed = await ctx.page.evaluate(
                """([storageKey]) => window.localStorage.getItem(storageKey) !== null""",
                [key],
            )
            await ctx.page.evaluate(
                """([storageKey]) => window.localStorage.removeItem(storageKey)""",
                [key],
            )
            result.message = (
                f"清除 localStorage: {key}"
                if existed
                else f"未找到 localStorage: {key}"
            )
            result.data = {"cleared": bool(existed), "key": key}
            ctx.outputs[node_id] = result.data
        else:
            await ctx.page.evaluate("""() => window.localStorage.clear()""")
            result.message = "已清空所有 localStorage"
            result.data = {"cleared": True, "all": True}
            ctx.outputs[node_id] = result.data
    else:
        result.status = "skipped"
        result.message = f"未知操作: {action}"
