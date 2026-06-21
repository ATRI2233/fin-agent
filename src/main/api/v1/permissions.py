"""Permissions router — 暴露 9876 Express 同款 permissions 接口到 8000 FastAPI。

对齐 ``src/webui/server/permissions.ts`` 的字段形状，使前端 ``useOpencodePermissions``
可以无差别地走 8000 端口。
"""

from __future__ import annotations

import logging
import threading
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, Request
from pydantic import BaseModel, ValidationError

from src.main.api.v1.config import (
    _read_json_or_jsonc,
    _resolve_file_path,
    _resolve_project_root,
    _write_json,
)
from src.main.infra.api_envelope import ApiResponse
from src.main.infra.tracing import current_trace_id

router = APIRouter(prefix="/api/v1/permissions", tags=["permissions"])


# ── Pydantic schemas ──


class PermissionRule(BaseModel):
    tool: str
    action: Literal["allow", "deny"]
    agents: list[str] | None = None
    description: str | None = None


class PermissionsConfig(BaseModel):
    rules: list[PermissionRule]
    defaultAction: Literal["allow", "deny"]


class UpdateResult(BaseModel):
    success: bool
    permissions: PermissionsConfig


# ── File lock for RMW safety ──

_permissions_locks: dict[str, threading.Lock] = {}
_permissions_locks_guard = threading.Lock()


def _get_permissions_lock(path: Path) -> threading.Lock:
    """Return a per-path lock for opencode.json permissions RMW."""
    key = str(path.resolve())
    with _permissions_locks_guard:
        lock = _permissions_locks.get(key)
        if lock is None:
            lock = threading.Lock()
            _permissions_locks[key] = lock
        return lock


# ── Helpers ──


def _get_permissions_config(project_root: Path) -> dict:
    """从 opencode.json 读取 permissions 字段；缺失或格式不符时返回默认值。"""
    target_path, _source = _resolve_file_path("opencode", None, project_root)
    data = _read_json_or_jsonc(target_path)
    permissions = data.get("permissions")
    if permissions and isinstance(permissions, dict) and not isinstance(permissions, list):
        try:
            return PermissionsConfig.model_validate(permissions).model_dump(
                exclude_none=True
            )
        except ValidationError as e:
            logging.warning(
                "Invalid permissions config at %s: %s", target_path, e
            )
            return {"rules": [], "defaultAction": "allow"}
    return {"rules": [], "defaultAction": "allow"}


def _save_permissions_config(project_root: Path, permissions: PermissionsConfig) -> None:
    """将 permissions 对象写回 opencode.json。

    Acquires a per-path lock so concurrent reads-modify-writes do not
    clobber the file (multi-worker deployments).
    """
    target_path, _source = _resolve_file_path("opencode", None, project_root)
    lock = _get_permissions_lock(target_path)
    with lock:
        data = _read_json_or_jsonc(target_path)
        data["permissions"] = permissions.model_dump(exclude_none=True)
        _write_json(target_path, data)


# ── Endpoints ──


@router.get("")
async def get_permissions(request: Request) -> dict:
    """GET /api/v1/permissions

    读取 opencode.json 的 permissions 字段。
    若不存在或格式不符，返回 ``{ rules: [], defaultAction: 'allow' }``。
    """
    settings = request.app.state.settings
    project_root = _resolve_project_root(settings)
    permissions = _get_permissions_config(project_root)
    return ApiResponse.success(permissions, current_trace_id()).to_dict()


@router.put("")
async def update_permissions(body: PermissionsConfig, request: Request) -> dict:
    """PUT /api/v1/permissions

    校验并写入 permissions 配置到 opencode.json。
    返回 ``{ success: true, permissions: PermissionsConfig }``。
    """
    settings = request.app.state.settings
    project_root = _resolve_project_root(settings)
    _save_permissions_config(project_root, body)
    result = UpdateResult(success=True, permissions=body)
    return ApiResponse.success(
        result.model_dump(exclude_none=True), current_trace_id()
    ).to_dict()
