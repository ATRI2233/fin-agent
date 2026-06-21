"""API v1 providers router — 暴露 9876 Express 同款 providers 接口到 8000 FastAPI。

对齐 ``src/webui/server/providers.ts`` 的字段形状，使前端 provider 管理
可以无差别地走 8000 端口。
"""

from __future__ import annotations

import asyncio
import threading
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from src.main.api.v1.config import (
    _read_json_or_jsonc,
    _resolve_file_path,
    _resolve_project_root,
    _write_json,
)
from src.main.infra.api_envelope import ApiResponse
from src.main.infra.tracing import current_trace_id

router = APIRouter(prefix="/api/v1/providers", tags=["providers"])


# ── File lock for RMW safety ──
# Per-path locks serialise provider RMW so concurrent deletes/upserts
# cannot write a "wild" provider name into the active slot (Bug 10).
_providers_locks: dict[str, threading.Lock] = {}
_providers_locks_guard = threading.Lock()


def _get_providers_lock(path: Path) -> threading.Lock:
    """Return a per-path lock for opencode.json providers section."""
    key = str(path.resolve())
    with _providers_locks_guard:
        lock = _providers_locks.get(key)
        if lock is None:
            lock = threading.Lock()
            _providers_locks[key] = lock
        return lock


# ── Pydantic schemas ──


class ProviderModelConfig(BaseModel):
    name: str


class ProviderConfig(BaseModel):
    model_config = {"extra": "allow"}
    name: str
    npm: str
    options: dict[str, Any] | None = None
    models: dict[str, ProviderModelConfig] | None = None


class ActiveProviderUpdate(BaseModel):
    provider: str
    model: str


class UpsertProviderResult(BaseModel):
    success: bool
    name: str
    config: ProviderConfig


class DeleteProviderResult(BaseModel):
    success: bool
    deleted: str


class SetActiveResult(BaseModel):
    success: bool
    provider: str
    model: str


# ── Helpers ──


def _get_opencode_path(request: Request) -> Path:
    """解析 opencode.json 的自动发现路径（global → project）。"""
    settings = request.app.state.settings
    project_root = _resolve_project_root(settings)
    target_path, _source = _resolve_file_path("opencode", None, project_root)
    return target_path


def _get_provider_data(path: Path) -> dict[str, Any]:
    """读取 opencode.json 并返回顶层对象，不存在时返回 {}。"""
    return _read_json_or_jsonc(path)


def _get_provider_section(data: dict[str, Any]) -> dict[str, Any]:
    """提取 data['provider'] 对象，不存在或格式异常时返回 {}。"""
    provider = data.get("provider")
    if provider and isinstance(provider, dict) and not isinstance(provider, list):
        return provider
    return {}


def _get_active_from_data(data: dict[str, Any]) -> dict[str, str]:
    """提取 active 配置 {provider, model}。"""
    provider = data.get("provider")
    if provider and isinstance(provider, dict):
        active = provider.get("active")
        if active and isinstance(active, dict):
            return {
                "provider": str(active.get("provider", "")),
                "model": str(active.get("model", "")),
            }
    return {"provider": "", "model": ""}


# ── Endpoints ──

# ⚠️ 路由顺序：/active 必须在 /{key} 之前，否则 "active" 会被路径参数吞掉。


@router.get("")
async def get_providers(request: Request) -> dict:
    """GET /api/v1/providers - list providers + active"""
    path = _get_opencode_path(request)
    data = await asyncio.to_thread(_get_provider_data, path)
    providers = _get_provider_section(data)
    active = _get_active_from_data(data)
    return ApiResponse.success(
        {"providers": providers, "active": active},
        current_trace_id(),
    ).to_dict()


@router.get("/active")
async def get_active_provider(request: Request) -> dict:
    """GET /api/v1/providers/active"""
    path = _get_opencode_path(request)
    data = await asyncio.to_thread(_get_provider_data, path)
    active = _get_active_from_data(data)
    return ApiResponse.success(active, current_trace_id()).to_dict()


@router.put("/active")
async def set_active_provider(body: ActiveProviderUpdate, request: Request) -> dict:
    """PUT /api/v1/providers/active"""
    if not body.provider or not body.provider.strip():
        raise HTTPException(status_code=422, detail="provider is required")

    path = _get_opencode_path(request)
    lock = _get_providers_lock(path)
    with lock:
        # Re-read inside lock so a concurrent DELETE of ``body.provider``
        # cannot race with us writing the active pointer (Bug 10).
        data = await asyncio.to_thread(_get_provider_data, path)
        providers = _get_provider_section(data)

        if body.provider not in providers:
            raise HTTPException(
                status_code=404,
                detail=f"Provider '{body.provider}' not found",
            )

        if "provider" not in data or not isinstance(data["provider"], dict):
            data["provider"] = {}
        data["provider"]["active"] = {"provider": body.provider, "model": body.model or ""}

        await asyncio.to_thread(_write_json, path, data)

    return ApiResponse.success(
        SetActiveResult(
            success=True,
            provider=body.provider,
            model=body.model or "",
        ).model_dump(),
        current_trace_id(),
    ).to_dict()


@router.put("/{key}")
async def upsert_provider(key: str, body: ProviderConfig, request: Request) -> dict:
    """PUT /api/v1/providers/:name - upsert provider"""
    if not key or not key.strip():
        raise HTTPException(status_code=422, detail="Provider name is required")

    path = _get_opencode_path(request)
    data = await asyncio.to_thread(_get_provider_data, path)

    if "provider" not in data or not isinstance(data["provider"], dict):
        data["provider"] = {}

    data["provider"][key] = body.model_dump()

    await asyncio.to_thread(_write_json, path, data)

    return ApiResponse.success(
        UpsertProviderResult(
            success=True,
            name=key,
            config=body,
        ).model_dump(),
        current_trace_id(),
    ).to_dict()


@router.delete("/{name}")
async def delete_provider(name: str, request: Request) -> dict:
    """DELETE /api/v1/providers/:name"""
    if not name or not name.strip():
        raise HTTPException(status_code=422, detail="Provider name is required")

    path = _get_opencode_path(request)
    data = await asyncio.to_thread(_get_provider_data, path)
    providers = _get_provider_section(data)

    if name not in providers:
        raise HTTPException(
            status_code=404,
            detail=f"Provider '{name}' not found",
        )

    del data["provider"][name]
    await asyncio.to_thread(_write_json, path, data)

    return ApiResponse.success(
        DeleteProviderResult(success=True, deleted=name).model_dump(),
        current_trace_id(),
    ).to_dict()
