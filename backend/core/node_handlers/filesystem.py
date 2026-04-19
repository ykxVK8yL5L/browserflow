from __future__ import annotations

from pathlib import Path
from typing import Any
import json


BACKEND_DIR = Path(__file__).resolve().parents[2]
DATA_DIR = BACKEND_DIR / "data"


def _get_user_root(user_id: str | None) -> Path:
    if not user_id:
        raise ValueError("当前执行缺少 user_id，无法访问用户文件目录")
    return Path(DATA_DIR) / "files" / str(user_id)


def _resolve_user_file_path(user_root: Path, raw_path: str | None) -> Path:
    relative_path = (raw_path or "").strip()
    if not relative_path:
        raise ValueError("缺少文件路径")

    if Path(relative_path).is_absolute():
        raise ValueError("不允许使用绝对路径，请填写相对路径")

    target_path = (user_root / relative_path).resolve()
    resolved_root = user_root.resolve()

    if target_path != resolved_root and resolved_root not in target_path.parents:
        raise ValueError("文件路径越权，仅允许访问当前用户目录")

    return target_path


async def handle_file_node(
    ctx, data: dict, normalized_node: dict, result, __: Any
) -> None:
    node_id = normalized_node["id"]
    action = str(data.get("action", "read") or "read").lower()
    relative_path = data.get("path")
    encoding = str(data.get("encoding", "utf-8") or "utf-8")
    content = data.get("content", "")
    create_directories = str(data.get("createDirectories", "true")).lower() == "true"
    overwrite = str(data.get("overwrite", "true")).lower() == "true"

    user_root = _get_user_root(getattr(ctx.item, "user_id", None))
    user_root.mkdir(parents=True, exist_ok=True)
    target_path = _resolve_user_file_path(user_root, relative_path)

    if action == "read":
        if not target_path.exists():
            raise FileNotFoundError(f"文件不存在: {relative_path}")
        if not target_path.is_file():
            raise ValueError(f"目标不是文件: {relative_path}")

        file_content = target_path.read_text(encoding=encoding)
        relative_result_path = target_path.relative_to(user_root).as_posix()
        result.message = f"已读取文件: {relative_result_path}"
        result.data = {
            "action": action,
            "path": relative_result_path,
            "encoding": encoding,
            "size": target_path.stat().st_size,
            "content": file_content,
        }
        ctx.outputs[node_id] = result.data
        return

    if action == "write":
        if target_path.exists() and target_path.is_dir():
            raise ValueError(f"目标是目录，不能写入文件: {relative_path}")
        if target_path.exists() and not overwrite:
            raise FileExistsError(f"文件已存在且不允许覆盖: {relative_path}")

        if create_directories:
            target_path.parent.mkdir(parents=True, exist_ok=True)
        elif not target_path.parent.exists():
            raise FileNotFoundError(
                f"父目录不存在: {target_path.parent.relative_to(user_root).as_posix()}"
            )

        # If template resolution produced a Python object (dict/list), serialize as JSON.
        # This avoids Python repr output like {'a': 1} which uses single quotes.
        if content is None:
            text_content = ""
        elif isinstance(content, (dict, list)):
            text_content = json.dumps(content, ensure_ascii=False, indent=2)
        else:
            text_content = str(content)
        target_path.write_text(text_content, encoding=encoding)
        relative_result_path = target_path.relative_to(user_root).as_posix()
        result.message = f"已写入文件: {relative_result_path}"
        result.data = {
            "action": action,
            "path": relative_result_path,
            "encoding": encoding,
            "size": target_path.stat().st_size,
            "written": True,
        }
        ctx.outputs[node_id] = result.data
        return

    result.status = "skipped"
    result.message = f"未知操作: {action}"
