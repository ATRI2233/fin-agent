"""API v1 rules router — 暴露 9876 Express 同款 rules 接口到 8000 FastAPI。

对齐 ``src/webui/server/rules.ts`` 的字段形状，使前端 ``useOpencodeRules`` / ``useUpdateOpencodeRules``
可以无差别地走 8000 端口（或切换到 9876，数据一致）。

端点:
    - GET  /api/v1/rules
        返回 ``{ content: string }``（``AGENTS.md`` 完整文本，不存在则为 ``""``）
    - PUT  /api/v1/rules
        body: ``{ content: string }``。写回 ``PROJECT_ROOT/AGENTS.md``
        返回 ``{ success: boolean, path: string }``

约定:
- ``trace_id`` 取自 ``current_trace_id()``。
- 文件读写异常由全局异常包装，不在 API 层 catch 通用 Exception。
- 项目根目录: 使用 ``settings.OPENCODE_MCP_CONFIG.parent.parent`` 反推
  (``.opencode/opencode.json`` → ``.opencode`` → project root)，也兼容
  ``FIN_AGENT_HOME`` 环境变量（与 9876 端 ``resolveProjectRoot`` 对齐）。
"""

from __future__ import annotations

import asyncio
import os
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from src.main.infra.api_envelope import ApiResponse
from src.main.infra.logging import get_logger
from src.main.infra.settings import Settings
from src.main.infra.tracing import current_trace_id

router = APIRouter(prefix="/api/v1/rules", tags=["rules"])

_log = get_logger(__name__)


# ── Pydantic schemas ──


class RulesUpdate(BaseModel):
    """Rules 写入请求体。"""

    content: str


class RulesContent(BaseModel):
    """Rules 读取响应 data。"""

    content: str


class RulesWriteResult(BaseModel):
    """Rules 写入响应 data。"""

    success: bool
    path: str


# ── Helpers ──


def _resolve_project_root(settings: Settings) -> Path:
    """解析项目根目录。

    优先级:
        1. ``FIN_AGENT_HOME`` 环境变量（部署模式，与 9876 对齐）
        2. ``settings.OPENCODE_MCP_CONFIG``（默认 ``.opencode/opencode.json``）反推
    """
    env_home = os.environ.get("FIN_AGENT_HOME")
    if env_home:
        return Path(env_home)
    cfg_path = Path(settings.OPENCODE_MCP_CONFIG)
    if cfg_path.parent.name == ".opencode":
        return cfg_path.parent.parent
    # 兜底: cwd
    return Path.cwd()


def _get_settings(request: Request) -> Settings:
    """从 FastAPI app state 取 Settings。"""
    return request.app.state.settings


# ── Endpoints ──


@router.get("")
async def get_rules(request: Request) -> dict:
    """GET /api/v1/rules - 读 AGENTS.md。

    Returns:
        ``ApiResponse`` 信封，``data`` 为 ``{content: string}``（文件不存在时 ``content`` 为 ``""``）。
    """
    settings = _get_settings(request)
    project_root = _resolve_project_root(settings)
    rules_path = project_root / "AGENTS.md"

    if not await asyncio.to_thread(rules_path.exists):
        return ApiResponse.success(
            RulesContent(content="").model_dump(),
            current_trace_id(),
        ).to_dict()

    try:
        content = await asyncio.to_thread(rules_path.read_text, encoding="utf-8")
    except FileNotFoundError:
        return ApiResponse.success(
            RulesContent(content="").model_dump(),
            current_trace_id(),
        ).to_dict()
    except (PermissionError, OSError) as e:
        _log.error("rules_read_failed", path=str(rules_path), error=str(e))
        raise HTTPException(
            status_code=503,
            detail=f"Storage unavailable: {e}",
        ) from e

    return ApiResponse.success(
        RulesContent(content=content).model_dump(),
        current_trace_id(),
    ).to_dict()


@router.put("")
async def update_rules(body: RulesUpdate, request: Request) -> dict:
    """PUT /api/v1/rules - 写 AGENTS.md。

    Args:
        body: ``{ content: string }``。

    Returns:
        ``ApiResponse`` 信封，``data`` 为 ``{success: boolean, path: string}``。
    """
    settings = _get_settings(request)
    project_root = _resolve_project_root(settings)
    rules_path = project_root / "AGENTS.md"

    # 原子写：先写临时文件再 rename，避免中途崩溃导致文件损坏
    tmp_path = rules_path.with_suffix(rules_path.suffix + ".tmp")
    try:
        await asyncio.to_thread(lambda: tmp_path.write_text(body.content, encoding="utf-8"))
        await asyncio.to_thread(tmp_path.replace, rules_path)
    except (PermissionError, OSError) as e:
        _log.error("rules_write_failed", path=str(rules_path), error=str(e))
        # 清理可能残留的 tmp 文件
        if await asyncio.to_thread(tmp_path.exists):
            try:
                await asyncio.to_thread(tmp_path.unlink)
            except OSError:
                pass
        raise HTTPException(
            status_code=503,
            detail=f"Storage unavailable: {e}",
        ) from e

    return ApiResponse.success(
        RulesWriteResult(success=True, path=str(rules_path)).model_dump(),
        current_trace_id(),
    ).to_dict()
