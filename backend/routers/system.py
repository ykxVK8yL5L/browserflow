"""系统备份与还原。"""

from __future__ import annotations

import base64
import io
import json
import os
import shutil
import zipfile
from datetime import datetime
from typing import Any, Dict, List, Literal, Set

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from fastapi.responses import Response
from sqlalchemy import DateTime
from sqlalchemy.orm import Session

from core.scheduler import shutdown_scheduler, start_scheduler
from models.database import Base, SessionLocal, get_db, init_db
from models.db_models import UserModel
from routers.auth import get_current_user

router = APIRouter(prefix="/api/system", tags=["system"])


def ensure_admin(user: UserModel) -> UserModel:
    if user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin privileges required",
        )
    return user


BACKUP_VERSION = 3
SUPPORTED_BACKUP_VERSIONS = {1, 2, 3}
DEFAULT_BACKUP_SCOPE = "current_user"
BACKUP_DIRS = [
    "data/identities",
    "data/files",
    "data/screenshots",
    "data/credentials",
]
SYSTEM_BACKUP_DIRS = ["data"]
PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
USER_SCOPED_TABLES = {
    "flows",
    "credentials",
    "identities",
    "user_agents",
    "executions",
    "node_executions",
    "schedules",
}
PUBLIC_SECTION_TABLE_MAP = {
    "flows": "flows",
    "credentials": "credentials",
    "identities": "identities",
    "user_agents": "userAgents",
    "executions": "executions",
    "node_executions": "nodeExecutions",
    "schedules": "schedules",
}
PUBLIC_FILE_ROOT_MAP = {
    "data/identities": "identities",
    "data/files": "files",
    "data/screenshots": "screenshots",
    "data/credentials": "credentialsFiles",
}
PUBLIC_FILE_ROOT_MAP_REVERSED = {
    public_name: root for root, public_name in PUBLIC_FILE_ROOT_MAP.items()
}


def _json_default(value: Any):
    if isinstance(value, datetime):
        return value.isoformat()
    raise TypeError(f"Object of type {type(value).__name__} is not JSON serializable")


def _abs_path(relative_path: str) -> str:
    return os.path.join(PROJECT_ROOT, relative_path)


def _resolve_backup_scope(scope: str) -> Literal["current_user", "system"]:
    if scope == "current_user":
        return "current_user"
    if scope == "system":
        return "system"
    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail=f"Unsupported backup scope: {scope}",
    )


def _get_backup_dirs(scope: Literal["current_user", "system"]) -> List[str]:
    return SYSTEM_BACKUP_DIRS if scope == "system" else BACKUP_DIRS


def _get_user_backup_context(user: UserModel, db: Session) -> Dict[str, Set[str]]:
    flow_ids = {
        row[0]
        for row in db.query(Base.metadata.tables["flows"].c.id)
        .filter(Base.metadata.tables["flows"].c.user_id == user.id)
        .all()
    }
    identity_ids = {
        row[0]
        for row in db.query(Base.metadata.tables["identities"].c.id)
        .filter(Base.metadata.tables["identities"].c.user_id == user.id)
        .all()
    }
    execution_ids = {
        row[0]
        for row in db.query(Base.metadata.tables["executions"].c.id)
        .filter(Base.metadata.tables["executions"].c.user_id == user.id)
        .all()
    }
    return {
        "flow_ids": flow_ids,
        "identity_ids": identity_ids,
        "execution_ids": execution_ids,
    }


def _select_rows_for_user(
    table_name: str,
    rows: List[Dict[str, Any]],
    user: UserModel,
    context: Dict[str, Set[str]],
) -> List[Dict[str, Any]]:
    if table_name not in USER_SCOPED_TABLES:
        return []

    if table_name == "node_executions":
        execution_ids = context["execution_ids"]
        return [row for row in rows if row.get("execution_id") in execution_ids]

    return [row for row in rows if row.get("user_id") == user.id]


def _serialize_table_rows(
    db: Session,
    scope: Literal["current_user", "system"],
    user: UserModel,
) -> Dict[str, List[Dict[str, Any]]]:
    payload: Dict[str, List[Dict[str, Any]]] = {}
    user_context = _get_user_backup_context(user, db)
    for table in Base.metadata.sorted_tables:
        rows = db.execute(table.select()).mappings().all()
        dict_rows = [dict(row) for row in rows]
        if scope == "current_user":
            payload[table.name] = _select_rows_for_user(
                table.name, dict_rows, user, user_context
            )
        else:
            payload[table.name] = dict_rows
    return payload


def _should_include_file_for_user(
    root: str,
    relative_path: str,
    user: UserModel,
    context: Dict[str, Set[str]],
) -> bool:
    if root == "data/screenshots":
        parts = relative_path.split(os.sep, 2)
        if len(parts) >= 2 and parts[0] == user.id:
            return parts[1] in context["execution_ids"]
        top_level = relative_path.split(os.sep, 1)[0]
        return top_level in context["execution_ids"]
    top_level = relative_path.split(os.sep, 1)[0]
    return top_level == user.id


def _export_relative_file_path(
    root: str,
    relative_path: str,
    scope: Literal["current_user", "system"],
) -> str:
    if scope != "current_user":
        return relative_path
    if root == "data/screenshots":
        parts = relative_path.split(os.sep, 1)
        if len(parts) == 2 and parts[0]:
            return parts[1]
        return relative_path
    parts = relative_path.split(os.sep, 1)
    return parts[1] if len(parts) == 2 else os.path.basename(relative_path)


def _restore_relative_file_path(
    root: str,
    relative_path: str,
    scope: Literal["current_user", "system"],
    current_user: UserModel,
) -> str:
    if scope != "current_user":
        return relative_path
    if root == "data/screenshots":
        parts = relative_path.split(os.sep, 1)
        if len(parts) == 2 and parts[0] == current_user.id:
            return parts[1]
        return relative_path
    return os.path.join(current_user.id, relative_path)


def _load_file_backup_context(
    scope: Literal["current_user", "system"], user: UserModel
) -> Dict[str, Set[str]] | None:
    if scope != "current_user":
        return None
    temp_db = SessionLocal()
    try:
        return _get_user_backup_context(user, temp_db)
    finally:
        temp_db.close()


def _serialize_files(
    scope: Literal["current_user", "system"], user: UserModel
) -> List[Dict[str, Any]]:
    items: List[Dict[str, Any]] = []
    user_context = _load_file_backup_context(scope, user)
    for relative_dir in _get_backup_dirs(scope):
        abs_dir = _abs_path(relative_dir)
        files: List[Dict[str, str]] = []
        if os.path.isdir(abs_dir):
            for root, _, filenames in os.walk(abs_dir):
                for filename in filenames:
                    file_path = os.path.join(root, filename)
                    relative_path = os.path.relpath(file_path, abs_dir)
                    if scope == "current_user" and user_context is not None:
                        if not _should_include_file_for_user(
                            relative_dir, relative_path, user, user_context
                        ):
                            continue
                    files.append(
                        {
                            "path": _export_relative_file_path(
                                relative_dir, relative_path, scope
                            ),
                            "source_path": relative_path,
                        }
                    )
        items.append({"root": relative_dir, "files": files})
    return items


def _serialize_files_with_content(
    scope: Literal["current_user", "system"], user: UserModel
) -> List[Dict[str, Any]]:
    items: List[Dict[str, Any]] = []
    user_context = _load_file_backup_context(scope, user)
    for relative_dir in _get_backup_dirs(scope):
        abs_dir = _abs_path(relative_dir)
        files: List[Dict[str, str]] = []
        if os.path.isdir(abs_dir):
            for root, _, filenames in os.walk(abs_dir):
                for filename in filenames:
                    file_path = os.path.join(root, filename)
                    relative_path = os.path.relpath(file_path, abs_dir)
                    if scope == "current_user" and user_context is not None:
                        if not _should_include_file_for_user(
                            relative_dir, relative_path, user, user_context
                        ):
                            continue
                    export_path = _export_relative_file_path(
                        relative_dir, relative_path, scope
                    )
                    with open(file_path, "rb") as handle:
                        content_base64 = base64.b64encode(handle.read()).decode("ascii")
                    files.append(
                        {
                            "path": export_path,
                            "content_base64": content_base64,
                        }
                    )
        items.append(
            {
                "category": PUBLIC_FILE_ROOT_MAP.get(relative_dir, relative_dir),
                "files": files,
            }
        )
    return items


def _build_backup_payload(
    db: Session,
    scope: Literal["current_user", "system"],
    user: UserModel,
) -> Dict[str, Any]:
    return {
        "version": BACKUP_VERSION,
        "format": "zip",
        "scope": scope,
        "exported_at": datetime.utcnow().isoformat(),
        "exported_by": {"id": user.id, "username": user.username},
        "tables": _serialize_table_rows(db, scope, user),
        "files": _serialize_files(scope, user),
    }


def _build_member_backup_payload(db: Session, user: UserModel) -> Dict[str, Any]:
    tables = _serialize_table_rows(db, "current_user", user)
    data = {
        public_name: tables.get(table_name, [])
        for table_name, public_name in PUBLIC_SECTION_TABLE_MAP.items()
    }
    return {
        "version": BACKUP_VERSION,
        "format": "member_json",
        "scope": "current_user",
        "exported_at": datetime.utcnow().isoformat(),
        "exported_by": {"id": user.id, "username": user.username},
        "data": data,
        "files": _serialize_files_with_content("current_user", user),
    }


def _write_backup_zip(payload: Dict[str, Any], user: UserModel) -> bytes:
    buffer = io.BytesIO()

    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        manifest = {
            "version": payload["version"],
            "format": payload.get("format", "zip"),
            "scope": payload["scope"],
            "exported_at": payload["exported_at"],
            "exported_by": payload["exported_by"],
            "table_names": sorted(payload.get("tables", {}).keys()),
            "file_roots": [entry.get("root") for entry in payload.get("files", [])],
        }
        archive.writestr(
            "manifest.json",
            json.dumps(manifest, ensure_ascii=False, default=_json_default, indent=2),
        )

        for table_name, rows in payload.get("tables", {}).items():
            archive.writestr(
                f"tables/{table_name}.json",
                json.dumps(rows, ensure_ascii=False, default=_json_default),
            )

        for entry in payload.get("files", []):
            root = entry.get("root")
            if root not in _get_backup_dirs(payload["scope"]):
                continue
            abs_dir = _abs_path(root)
            for item in entry.get("files", []):
                rel_path = item.get("path")
                source_rel_path = item.get("source_path", rel_path)
                if not isinstance(rel_path, str) or not isinstance(
                    source_rel_path, str
                ):
                    continue
                source = os.path.abspath(os.path.join(abs_dir, source_rel_path))
                if not source.startswith(os.path.abspath(abs_dir) + os.sep):
                    continue
                if not os.path.isfile(source):
                    continue

                archive.write(source, arcname=f"files/{root}/{rel_path}")

    return buffer.getvalue()


def _parse_table_rows(raw_tables: Dict[str, Any]) -> Dict[str, List[Dict[str, Any]]]:
    parsed: Dict[str, List[Dict[str, Any]]] = {}
    table_map = Base.metadata.tables

    for table_name, rows in raw_tables.items():
        if table_name not in table_map:
            continue
        if not isinstance(rows, list):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid table payload: {table_name}",
            )

        table = table_map[table_name]
        normalized_rows: List[Dict[str, Any]] = []
        for row in rows:
            if not isinstance(row, dict):
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Invalid row payload in table: {table_name}",
                )

            normalized: Dict[str, Any] = {}
            for column in table.columns:
                if column.name not in row:
                    continue
                value = row[column.name]
                if value is not None and isinstance(column.type, DateTime):
                    try:
                        value = datetime.fromisoformat(value)
                    except Exception as exc:
                        raise HTTPException(
                            status_code=status.HTTP_400_BAD_REQUEST,
                            detail=f"Invalid datetime in {table_name}.{column.name}",
                        ) from exc
                normalized[column.name] = value
            normalized_rows.append(normalized)
        parsed[table_name] = normalized_rows

    return parsed


def _rewrite_rows_for_current_user(
    tables: Dict[str, List[Dict[str, Any]]], current_user: UserModel
) -> Dict[str, List[Dict[str, Any]]]:
    rewritten: Dict[str, List[Dict[str, Any]]] = {}
    source_user_id: str | None = None

    for table_name, rows in tables.items():
        rewritten_rows: List[Dict[str, Any]] = []
        for row in rows:
            updated = dict(row)
            if source_user_id is None and "user_id" in updated and updated["user_id"]:
                source_user_id = updated["user_id"]
            if "user_id" in updated:
                updated["user_id"] = current_user.id
            rewritten_rows.append(updated)
        rewritten[table_name] = rewritten_rows

    if source_user_id:
        for table_name, rows in rewritten.items():
            if table_name == "node_executions":
                continue
            for row in rows:
                for key in ("storage_path",):
                    value = row.get(key)
                    if isinstance(value, str):
                        row[key] = value.replace(source_user_id, current_user.id)

    return rewritten


def _delete_current_user_rows(db: Session, current_user: UserModel) -> None:
    for table in reversed(Base.metadata.sorted_tables):
        if table.name == "node_executions":
            execution_ids = (
                db.execute(
                    Base.metadata.tables["executions"]
                    .select()
                    .with_only_columns(Base.metadata.tables["executions"].c.id)
                    .where(
                        Base.metadata.tables["executions"].c.user_id == current_user.id
                    )
                )
                .scalars()
                .all()
            )
            if execution_ids:
                db.execute(
                    table.delete().where(table.c.execution_id.in_(execution_ids))
                )
            continue

        if "user_id" in table.c and table.name in USER_SCOPED_TABLES:
            db.execute(table.delete().where(table.c.user_id == current_user.id))


def _restore_tables(
    db: Session,
    tables: Dict[str, List[Dict[str, Any]]],
    scope: Literal["current_user", "system"],
    current_user: UserModel,
) -> None:
    if scope == "current_user":
        rewritten = _rewrite_rows_for_current_user(tables, current_user)
        _delete_current_user_rows(db, current_user)
        for table in Base.metadata.sorted_tables:
            rows = rewritten.get(table.name, [])
            if rows:
                db.execute(table.insert(), rows)
        db.commit()
        return

    for table in reversed(Base.metadata.sorted_tables):
        db.execute(table.delete())

    for table in Base.metadata.sorted_tables:
        rows = tables.get(table.name, [])
        if rows:
            db.execute(table.insert(), rows)

    db.commit()


def _clear_backup_dirs(
    scope: Literal["current_user", "system"], current_user: UserModel
) -> None:
    for relative_dir in _get_backup_dirs(scope):
        abs_dir = _abs_path(relative_dir)
        if os.path.isdir(abs_dir):
            if scope == "current_user":
                user_dir = os.path.join(abs_dir, current_user.id)
                if os.path.isdir(user_dir):
                    shutil.rmtree(user_dir)
            else:
                shutil.rmtree(abs_dir)
        os.makedirs(abs_dir, exist_ok=True)


def _restore_files(
    raw_files: Any,
    archive: zipfile.ZipFile | None,
    scope: Literal["current_user", "system"],
    current_user: UserModel,
) -> None:
    if not isinstance(raw_files, list):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid files payload",
        )

    _clear_backup_dirs(scope, current_user)
    allowed_roots = set(_get_backup_dirs(scope))

    for entry in raw_files:
        if not isinstance(entry, dict):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid file entry",
            )

        root = entry.get("root")
        files = entry.get("files", [])
        if root not in allowed_roots or not isinstance(files, list):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid backup file root",
            )

        root_dir = _abs_path(root)
        os.makedirs(root_dir, exist_ok=True)
        for item in files:
            if not isinstance(item, dict):
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Invalid backup file item",
                )
            rel_path = item.get("path")
            if not isinstance(rel_path, str):
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Invalid backup file content",
                )

            rel_path = _restore_relative_file_path(root, rel_path, scope, current_user)

            destination = os.path.abspath(os.path.join(root_dir, rel_path))
            if not destination.startswith(
                os.path.abspath(root_dir) + os.sep
            ) and destination != os.path.abspath(root_dir):
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Invalid backup file path",
                )
            os.makedirs(os.path.dirname(destination), exist_ok=True)
            if archive is None:
                content_base64 = item.get("content_base64")
                if not isinstance(content_base64, str):
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail="Invalid backup file content",
                    )
                import base64

                with open(destination, "wb") as handle:
                    handle.write(base64.b64decode(content_base64))
                continue

            archive_member = item.get("archive_path")
            if not isinstance(archive_member, str):
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Invalid backup file content",
                )
            try:
                data = archive.read(archive_member)
            except KeyError as exc:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Missing backup file: {archive_member}",
                ) from exc

            with open(destination, "wb") as handle:
                handle.write(data)


def _parse_zip_backup(file_bytes: bytes) -> Dict[str, Any]:
    try:
        archive = zipfile.ZipFile(io.BytesIO(file_bytes), "r")
    except zipfile.BadZipFile as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Backup file is not a valid ZIP archive",
        ) from exc

    try:
        try:
            manifest = json.loads(archive.read("manifest.json").decode("utf-8"))
        except KeyError as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Backup manifest.json is missing",
            ) from exc

        if not isinstance(manifest, dict):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid backup manifest",
            )

        tables: Dict[str, Any] = {}
        for name in archive.namelist():
            if not name.startswith("tables/") or not name.endswith(".json"):
                continue
            table_name = name[len("tables/") : -len(".json")]
            try:
                tables[table_name] = json.loads(archive.read(name).decode("utf-8"))
            except Exception as exc:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Invalid table JSON: {table_name}",
                ) from exc

        scope = manifest.get("scope", DEFAULT_BACKUP_SCOPE)
        backup_dirs = _get_backup_dirs(_resolve_backup_scope(scope))

        files: List[Dict[str, Any]] = []
        for root in backup_dirs:
            prefix = f"files/{root}/"
            root_files: List[Dict[str, str]] = []
            for name in archive.namelist():
                if not name.startswith(prefix) or name.endswith("/"):
                    continue
                rel_path = name[len(prefix) :]
                if not rel_path:
                    continue
                root_files.append({"path": rel_path, "archive_path": name})
            files.append({"root": root, "files": root_files})

        return {
            "payload": {
                "version": manifest.get("version"),
                "scope": scope,
                "tables": tables,
                "files": files,
            },
            "archive": archive,
        }
    except Exception:
        archive.close()
        raise


def _parse_legacy_json_backup(file_bytes: bytes) -> Dict[str, Any]:
    try:
        payload = json.loads(file_bytes.decode("utf-8"))
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Backup file is not valid JSON",
        ) from exc

    return {
        "payload": payload,
        "archive": None,
    }


def _parse_member_backup_sections(raw_sections: Any) -> Dict[str, List[Dict[str, Any]]]:
    if not isinstance(raw_sections, dict):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid member backup data payload",
        )

    table_payload: Dict[str, Any] = {}
    for table_name, public_name in PUBLIC_SECTION_TABLE_MAP.items():
        if public_name in raw_sections:
            table_payload[table_name] = raw_sections[public_name]
    return _parse_table_rows(table_payload)


def _normalize_member_backup_files(raw_files: Any) -> List[Dict[str, Any]]:
    if not isinstance(raw_files, list):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid member backup files payload",
        )

    normalized: List[Dict[str, Any]] = []
    for entry in raw_files:
        if not isinstance(entry, dict):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid member backup file entry",
            )
        category = entry.get("category")
        root = PUBLIC_FILE_ROOT_MAP_REVERSED.get(category)
        files = entry.get("files", [])
        if root is None or not isinstance(files, list):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid member backup file category",
            )
        normalized.append({"root": root, "files": files})
    return normalized


@router.get("/backup")
async def export_system_backup(
    scope: str = DEFAULT_BACKUP_SCOPE,
    user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    resolved_scope = _resolve_backup_scope(scope)
    if resolved_scope != "current_user":
        ensure_admin(user)

    if user.role != "admin":
        if resolved_scope != "current_user":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Non-admin users can only export their own account data",
            )
        payload = _build_member_backup_payload(db, user)
        filename = f"browserflow-personal-backup-{datetime.utcnow().strftime('%Y%m%d-%H%M%S')}.json"
        return Response(
            content=json.dumps(
                payload, ensure_ascii=False, default=_json_default, indent=2
            ),
            media_type="application/json",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )

    backup = _build_backup_payload(db, resolved_scope, user)
    filename = f"browserflow-{resolved_scope}-backup-{datetime.utcnow().strftime('%Y%m%d-%H%M%S')}.zip"
    return Response(
        content=_write_backup_zip(backup, user),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/restore")
async def restore_system_backup(
    file: UploadFile = File(...),
    user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not file.filename or not (
        file.filename.endswith(".zip") or file.filename.endswith(".json")
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only ZIP or legacy JSON backup files are supported",
        )

    file_bytes = await file.read()
    parsed = (
        _parse_zip_backup(file_bytes)
        if file.filename.endswith(".zip")
        else _parse_legacy_json_backup(file_bytes)
    )
    payload = parsed["payload"]
    archive = parsed["archive"]

    if not isinstance(payload, dict):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid backup payload",
        )

    if payload.get("version") not in SUPPORTED_BACKUP_VERSIONS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Unsupported backup version",
        )

    backup_scope = _resolve_backup_scope(payload.get("scope", DEFAULT_BACKUP_SCOPE))
    backup_format = payload.get("format")

    if user.role != "admin":
        if backup_scope != "current_user" or backup_format != "member_json":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Non-admin users can only restore personal JSON backups",
            )

    tables: Dict[str, List[Dict[str, Any]]]
    files: Any
    if backup_format == "member_json":
        tables = _parse_member_backup_sections(payload.get("data", {}))
        files = _normalize_member_backup_files(payload.get("files", []))
    else:
        if backup_scope != "current_user":
            ensure_admin(user)
        tables = _parse_table_rows(payload.get("tables", {}))
        files = payload.get("files", [])

    shutdown_scheduler()
    try:
        init_db()
        _restore_tables(db, tables, backup_scope, user)
        _restore_files(files, archive, backup_scope, user)
    except HTTPException:
        db.rollback()
        start_scheduler()
        if archive is not None:
            archive.close()
        raise
    except Exception as exc:
        db.rollback()
        start_scheduler()
        if archive is not None:
            archive.close()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Restore failed: {exc}",
        ) from exc

    start_scheduler()
    if archive is not None:
        archive.close()
    return {
        "message": "Backup restored successfully",
        "restored_by": user.username,
        "scope": backup_scope,
        "table_count": len(tables),
        "file_root_count": len(_get_backup_dirs(backup_scope)),
    }
