from __future__ import annotations

import re
from typing import Any, Dict, List, Union

from .registry import TemplateFunctionRegistry, TemplateFunctionError


def _require_str(value: Any, name: str) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    return str(value)


def register(registry: TemplateFunctionRegistry) -> None:
    # regex.match(text, pattern) -> dict | None
    # 返回第一个匹配结果，包含 groups 和 groupdict
    def match_fn(args: list[Any], _ctx: Dict[str, Any]) -> Union[Dict[str, Any], None]:
        if len(args) < 2:
            raise TemplateFunctionError("regex.match requires (text, pattern)")
        text = _require_str(args[0], "text")
        pattern = _require_str(args[1], "pattern")

        try:
            m = re.search(pattern, text)
            if not m:
                return None

            result = {
                "match": m.group(0),
                "groups": m.groups(),
                "groupdict": m.groupdict(),
                "start": m.start(),
                "end": m.end(),
            }
            # 添加编号组 (group_0, group_1, ...)
            for i, g in enumerate(m.groups()):
                result[f"group_{i+1}"] = g
            # 添加命名组
            for name, g in m.groupdict().items():
                result[name] = g
            return result
        except re.error as exc:
            raise TemplateFunctionError(f"Invalid regex pattern: {exc}") from exc

    registry.register(
        "regex",
        "match",
        match_fn,
        description="从文本中提取第一个匹配结果",
        signature="regex.match(text, pattern)",
    )

    # regex.findall(text, pattern) -> list
    # 返回所有匹配结果
    def findall_fn(args: list[Any], _ctx: Dict[str, Any]) -> List[Any]:
        if len(args) < 2:
            raise TemplateFunctionError("regex.findall requires (text, pattern)")
        text = _require_str(args[0], "text")
        pattern = _require_str(args[1], "pattern")

        try:
            matches = re.findall(pattern, text)
            return list(matches)
        except re.error as exc:
            raise TemplateFunctionError(f"Invalid regex pattern: {exc}") from exc

    registry.register(
        "regex",
        "findall",
        findall_fn,
        description="从文本中提取所有匹配结果",
        signature="regex.findall(text, pattern)",
    )

    # regex.findall_detail(text, pattern) -> list[dict]
    # 返回所有匹配结果的详细信息
    def findall_detail_fn(
        args: list[Any], _ctx: Dict[str, Any]
    ) -> List[Dict[str, Any]]:
        if len(args) < 2:
            raise TemplateFunctionError("regex.findall_detail requires (text, pattern)")
        text = _require_str(args[0], "text")
        pattern = _require_str(args[1], "pattern")

        try:
            results = []
            for m in re.finditer(pattern, text):
                item = {
                    "match": m.group(0),
                    "groups": m.groups(),
                    "groupdict": m.groupdict(),
                    "start": m.start(),
                    "end": m.end(),
                }
                for i, g in enumerate(m.groups()):
                    item[f"group_{i+1}"] = g
                for name, g in m.groupdict().items():
                    item[name] = g
                results.append(item)
            return results
        except re.error as exc:
            raise TemplateFunctionError(f"Invalid regex pattern: {exc}") from exc

    registry.register(
        "regex",
        "findall_detail",
        findall_detail_fn,
        description="从文本中提取所有匹配结果的详细信息",
        signature="regex.findall_detail(text, pattern)",
    )

    # regex.replace(text, pattern, replacement) -> str
    # 替换所有匹配项
    def replace_fn(args: list[Any], _ctx: Dict[str, Any]) -> str:
        if len(args) < 3:
            raise TemplateFunctionError(
                "regex.replace requires (text, pattern, replacement)"
            )
        text = _require_str(args[0], "text")
        pattern = _require_str(args[1], "pattern")
        replacement = _require_str(args[2], "replacement")

        try:
            return re.sub(pattern, replacement, text)
        except re.error as exc:
            raise TemplateFunctionError(f"Invalid regex pattern: {exc}") from exc

    registry.register(
        "regex",
        "replace",
        replace_fn,
        description="替换文本中所有匹配的内容",
        signature="regex.replace(text, pattern, replacement)",
    )

    # regex.split(text, pattern) -> list
    # 按正则分割文本
    def split_fn(args: list[Any], _ctx: Dict[str, Any]) -> List[str]:
        if len(args) < 2:
            raise TemplateFunctionError("regex.split requires (text, pattern)")
        text = _require_str(args[0], "text")
        pattern = _require_str(args[1], "pattern")

        try:
            return re.split(pattern, text)
        except re.error as exc:
            raise TemplateFunctionError(f"Invalid regex pattern: {exc}") from exc

    registry.register(
        "regex",
        "split",
        split_fn,
        description="按正则表达式分割文本",
        signature="regex.split(text, pattern)",
    )

    # regex.test(text, pattern) -> bool
    # 测试是否匹配
    def test_fn(args: list[Any], _ctx: Dict[str, Any]) -> bool:
        if len(args) < 2:
            raise TemplateFunctionError("regex.test requires (text, pattern)")
        text = _require_str(args[0], "text")
        pattern = _require_str(args[1], "pattern")

        try:
            return bool(re.search(pattern, text))
        except re.error as exc:
            raise TemplateFunctionError(f"Invalid regex pattern: {exc}") from exc

    registry.register(
        "regex",
        "test",
        test_fn,
        description="测试文本是否匹配正则表达式",
        signature="regex.test(text, pattern)",
    )
