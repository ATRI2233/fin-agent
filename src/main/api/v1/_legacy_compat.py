"""webui envelope 兼容层 — legacy 响应形状降级中间件。

当请求 header ``X-Api-Version: legacy`` 时,把统一 :class:`ApiResponse` 形状
降级为旧 FastAPI ``{detail, ...}`` 形状,避免 webui 在 1 个 sprint 内被迫
同步切换前端 axios 拦截器。

.. deprecated::
    本模块仅作 1 sprint 缓冲使用,由 **TASK-501** 收尾时删除。
    不要在任何 router 内重复实现 legacy 转换逻辑 — 全部走本中间件。

修订 T-8 强约束: 禁止将 legacy 兼容逻辑散落到各 router 内。
"""

from __future__ import annotations

import json
import warnings
from typing import Any

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from src.main.infra.api_envelope import ApiResponse

# ── 常量 ──

LEGACY_HEADER: str = "X-Api-Version"
"""触发 legacy 降级的请求头名。"""

LEGACY_VALUE: str = "legacy"
"""触发 legacy 降级的请求头值。"""

# ── 弃用警告 ──

warnings.warn(
    "src.main.api.v1._legacy_compat is deprecated and will be removed in "
    "1 sprint (see TASK-501). Webui should migrate to the unified ApiResponse "
    "envelope and stop sending X-Api-Version: legacy.",
    DeprecationWarning,
    stacklevel=2,
)


# ── 响应转换工具 ──


def _new_to_legacy(payload: dict) -> dict:
    """把新信封 ``{code, message, data, trace_id}`` 降级为 legacy 形状。

    成功 (``code == 0``)::
        {"status": "ok", "code": 0, "data": <original>, "trace_id": <id>}

    失败 (``code != 0``)::
        {"detail": <message>, "code": <int>, "trace_id": <id>, "data": <orig>}

    Args:
        payload: 新信封序列化后的字典,通常来自
            :meth:`ApiResponse.to_dict`。

    Returns:
        legacy 形状的字典,供 JSON 编码。
    """
    code: int = int(payload.get("code", 0))
    message: str = payload.get("message", "")
    data: Any = payload.get("data")
    trace_id: Any = payload.get("trace_id")

    if code == 0:
        # 成功:data 放 detail 是反直觉,改用 status 字段
        return {
            "status": "ok",
            "code": code,
            "data": data,
            "trace_id": trace_id,
        }
    return {
        "detail": message,
        "code": code,
        "trace_id": trace_id,
        "data": data,
    }


# ── Middleware ──


class LegacyEnvelopeMiddleware(BaseHTTPMiddleware):
    """当 ``X-Api-Version: legacy`` 时,把 ApiResponse 形状降级为旧形状。

    仅在 webui 设置 ``VITE_API_VERSION=legacy`` 时生效,**1 sprint 后删除**
    (由 TASK-501 收尾)。

    行为契约:

    1. 非 legacy 请求 → 透传,不做任何修改。
    2. legacy 请求 + 非 JSON 响应 → 透传,不动 (修订 T-8: 不影响文件下载)。
    3. legacy 请求 + JSON 响应 → 解析 body,转 legacy,重建响应。

    注意 (Do Not #3): 解析失败时**透传原响应**,不吞掉也不 raise — 因为
    此时响应已生成,吞掉等于丢响应,raise 会把内部错误暴露给客户端。
    """

    async def dispatch(self, request: Request, call_next: Any) -> Response:
        is_legacy: bool = request.headers.get(LEGACY_HEADER) == LEGACY_VALUE
        response: Response = await call_next(request)

        if not is_legacy:
            return response

        # 仅处理 application/json;非 JSON(如文件下载)直接透传
        ctype: str = response.headers.get("content-type", "")
        if "application/json" not in ctype:
            return response

        # 读取并累积 body
        body: bytes = b""
        async for chunk in response.body_iterator:
            body += chunk if isinstance(chunk, bytes) else chunk.encode()

        # 解析失败透传,不让前端看到 500
        try:
            payload: dict = json.loads(body)
        except ValueError:
            return response

        # 不是字典也透传(理论上不会发生,防御性编程)
        if not isinstance(payload, dict):
            return response

        legacy: dict = _new_to_legacy(payload)
        # 过滤掉 content-length / content-type,让 JSONResponse 重新计算
        passthrough_headers: dict[str, str] = {
            k: v
            for k, v in response.headers.items()
            if k.lower() not in ("content-length", "content-type")
        }
        return JSONResponse(
            content=legacy,
            status_code=response.status_code,
            headers=passthrough_headers,
        )
