"""API v1 config router — 暴露 9876 Express 同款 config 接口到 8000 FastAPI。

对齐 ``src/webui/server/config.ts`` 的字段形状,使前端 ``ConfigRawEditor``
可以无差别地走 8000 端口(或切换到 9876,数据一致)。

端点:
    - GET  /api/v1/config/{file}?scope=global|project
        file ∈ {'opencode', 'oh-my-openagent'}
        返回 ``{ ...data, _meta: { source } }`` (与 9876 一致)
    - PUT  /api/v1/config/{file}?scope=global|project
        body: 任意 JSON object。写回 ``source`` 路径(global → ~/.config/opencode/;
        project → ``.opencode/{filename}``)
    - GET  /api/v1/config/scope
        返回 scope preferences dict (``.opencode/.scope_prefs.json``),
        文件缺失时返回 ``{}``
    - PUT  /api/v1/config/scope
        body: prefs dict,merge 写回 ``.opencode/.scope_prefs.json``

约定:
- ``trace_id`` 取自 ``current_trace_id()``。
- 不在 API 层 catch 通用 Exception;文件读写异常由全局异常包装。
- 项目根目录: 使用 ``settings.OPENCODE_MCP_CONFIG.parent.parent`` 反推
  (``.opencode/opencode.json`` → ``.opencode`` → project root),也兼容
  ``FIN_AGENT_HOME`` 环境变量(与 9876 端 ``resolveProjectRoot`` 对齐)。
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
from functools import partial
from pathlib import Path
from typing import Any, Literal

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel

from src.main.infra.api_envelope import ApiResponse
from src.main.infra.settings import Settings
from src.main.infra.tracing import current_trace_id

router = APIRouter(prefix="/api/v1/config", tags=["config"])

_log = logging.getLogger(__name__)

ConfigFile = Literal["opencode", "oh-my-openagent"]
ConfigScope = Literal["global", "project"]

_FILENAME_MAP: dict[str, str] = {
    "opencode": "opencode.json",
    "oh-my-openagent": "oh-my-openagent.jsonc",
}


# ── Pydantic schemas ──


class ScopePrefsUpdate(BaseModel):
    """scope preferences 写入请求体 (任意键值对,merge 写回)。"""

    model_config = {"extra": "allow"}


class WriteResult(BaseModel):
    success: bool
    path: str
    source: str | None = None


# ── Helpers ──


def _resolve_project_root(settings: Settings) -> Path:
    """解析项目根目录。

    优先级:
        1. ``FIN_AGENT_HOME`` 环境变量 (部署模式,与 9876 对齐)
        2. ``settings.OPENCODE_MCP_CONFIG`` (默认 ``.opencode/opencode.json``) 反推
    """
    env_home = os.environ.get("FIN_AGENT_HOME")
    if env_home:
        return Path(env_home)
    # OPENCODE_MCP_CONFIG 默认 .opencode/opencode.json → 上两级是 project root
    cfg_path = Path(settings.OPENCODE_MCP_CONFIG)
    if cfg_path.parent.name == ".opencode":
        return cfg_path.parent.parent
    # 兜底: cwd
    return Path.cwd()


def _global_config_dir() -> Path:
    """全局 opencode 配置目录 (~/.config/opencode/)。"""
    override = os.environ.get("OPENCODE_CONFIG_DIR")
    if override:
        return Path(override)
    home = Path(os.environ.get("USERPROFILE") or os.environ.get("HOME") or str(Path.home()))
    return home / ".config" / "opencode"


def _strip_jsonc_comments(content: str) -> str:
    """轻量 JSONC 注释剥离 (支持 // 与 /* */,字符串内的 // 不剥离)。"""
    result: list[str] = []
    i = 0
    n = len(content)
    in_string = False
    while i < n:
        ch = content[i]
        if in_string:
            result.append(ch)
            if ch == "\\" and i + 1 < n:
                result.append(content[i + 1])
                i += 2
                continue
            if ch == '"':
                in_string = False
            i += 1
            continue
        if ch == '"':
            in_string = True
            result.append(ch)
            i += 1
            continue
        # 行注释
        if ch == "/" and i + 1 < n and content[i + 1] == "/":
            while i < n and content[i] != "\n":
                i += 1
            continue
        # 块注释
        if ch == "/" and i + 1 < n and content[i + 1] == "*":
            i += 2
            while i + 1 < n and not (content[i] == "*" and content[i + 1] == "/"):
                i += 1
            # 正常闭合时 i 指向 '*'，+1 指向 '/'；未闭合时 i 已被推到 n-1
            if i + 1 < n:
                i += 2
            else:
                i = n  # 未闭合的块注释：吞掉到文件末尾
            continue
        result.append(ch)
        i += 1
    return "".join(result)


def _read_json_or_jsonc(path: Path) -> dict[str, Any]:
    """读取 JSON/JSONC;文件不存在返回 ``{}``。"""
    if not path.exists():
        return {}
    raw = path.read_text(encoding="utf-8")
    if path.suffix == ".jsonc":
        raw = _strip_jsonc_comments(raw)
    parsed = json.loads(raw) if raw.strip() else {}
    if not isinstance(parsed, dict):
        return {}
    return parsed


def _write_json(path: Path, data: dict[str, Any]) -> None:
    """原子写 JSON,确保父目录存在。"""
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(data, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )


def _resolve_file_path(
    file: ConfigFile,
    scope: ConfigScope | None,
    project_root: Path,
    *,
    require_scope: bool = False,
) -> tuple[Path, str]:
    """根据 file + scope 决定最终读写路径。

    ``scope='project'`` → ``{project_root}/.opencode/{filename}``
    ``scope='global'``  → ``{global_config_dir}/{filename}``

    Args:
        file: config 文件类型。
        scope: 显式 scope;为 None 时按 global → project 顺序发现。
        project_root: 项目根目录。
        require_scope: 写入语义(PUT)必须为 True,要求调用方显式提供
            scope,避免 global 不存在时静默漂移到 project 路径。

    Returns:
        (absolute_path, source)

    Raises:
        HTTPException: 400 if ``require_scope`` is True and ``scope`` is None.
    """
    if require_scope and scope is None:
        _log.warning(
            "config.scope_ambiguous",
            extra={"file": file, "method": "PUT"},
        )
        raise HTTPException(
            status_code=400,
            detail="scope is required for PUT; specify 'global' or 'project'",
        )

    filename = _FILENAME_MAP[file]

    if scope == "project":
        return project_root / ".opencode" / filename, "project"

    if scope == "global":
        return _global_config_dir() / filename, "global"

    # scope is None: GET auto-discover, global first then project
    global_path = _global_config_dir() / filename
    if global_path.exists():
        return global_path, "global"
    project_path = project_root / ".opencode" / filename
    if project_path.exists():
        return project_path, "project"
    # 都不存在 → 默认 project 路径(便于首次写入,仅 GET 路径到达)
    return project_path, "project"


def _get_settings(request: Request) -> Settings:
    """从 FastAPI app state 取 Settings。"""
    return request.app.state.settings


# ── Endpoints ──


@router.get("/scope")
async def get_scope_prefs(request: Request) -> dict:
    """读取 scope preferences (``.opencode/.scope_prefs.json``)。

    Returns:
        ``ApiResponse`` 信封,``data`` 为 prefs dict (文件不存在时为 ``{}``)。
    """
    settings = _get_settings(request)
    project_root = _resolve_project_root(settings)
    prefs_path = project_root / ".opencode" / ".scope_prefs.json"
    data = await asyncio.to_thread(_read_json_or_jsonc, prefs_path)
    return ApiResponse.success(data, current_trace_id()).to_dict()


@router.put("/scope")
async def put_scope_prefs(body: ScopePrefsUpdate, request: Request) -> dict:
    """merge 写入 scope preferences。

    Args:
        body: 任意键值对,与现有 prefs 浅 merge。

    Returns:
        ``ApiResponse`` 信封,``data`` 为 ``{"success": True, "path": ...}``。
    """
    settings = _get_settings(request)
    project_root = _resolve_project_root(settings)
    prefs_path = project_root / ".opencode" / ".scope_prefs.json"
    existing = await asyncio.to_thread(_read_json_or_jsonc, prefs_path)
    merged = {**existing, **body.model_dump()}
    await asyncio.to_thread(_write_json, prefs_path, merged)
    return ApiResponse.success(
        WriteResult(success=True, path=str(prefs_path)).model_dump(),
        current_trace_id(),
    ).to_dict()


@router.get("/{file}")
async def get_config(
    file: ConfigFile,
    request: Request,
    scope: ConfigScope | None = Query(default=None, description="global | project;省略时自动发现"),
) -> dict:
    """读取 config 原始内容。

    Args:
        file: ``opencode`` 或 ``oh-my-openagent``。
        scope: 显式 scope。

    Returns:
        ``ApiResponse`` 信封,``data`` 为 ``{...config, _meta: {source: ...}}``。
    """
    settings = _get_settings(request)
    project_root = _resolve_project_root(settings)
    target_path, source = await asyncio.to_thread(_resolve_file_path, file, scope, project_root)
    data = await asyncio.to_thread(_read_json_or_jsonc, target_path)
    payload = {**data, "_meta": {"source": source, "path": str(target_path)}}
    return ApiResponse.success(payload, current_trace_id()).to_dict()


@router.put("/{file}")
async def put_config(
    file: ConfigFile,
    body: dict[str, Any],
    request: Request,
    scope: ConfigScope | None = Query(default=None, description="global | project;省略时写回原 source"),
) -> dict:
    """写入 config。

    Args:
        file: ``opencode`` 或 ``oh-my-openagent``。
        body: 任意 JSON object (dict)。
        scope: 显式 scope;省略时按 ``_resolve_file_path`` 自动发现。

    Returns:
        ``ApiResponse`` 信封,``data`` 为 ``{success, path, source}``。

    Raises:
        HTTPException: 400 if body 不是 dict。
    """
    if not isinstance(body, dict):
        raise HTTPException(status_code=422, detail="Config body must be a JSON object")

    settings = _get_settings(request)
    project_root = _resolve_project_root(settings)
    target_path, source = await asyncio.to_thread(
        partial(_resolve_file_path, file, scope, project_root, require_scope=True)
    )
    await asyncio.to_thread(_write_json, target_path, body)
    return ApiResponse.success(
        WriteResult(success=True, path=str(target_path), source=source).model_dump(),
        current_trace_id(),
    ).to_dict()
