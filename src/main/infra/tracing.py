"""trace_id 上下文传播 — 生成、传播、完整性校验。

提供模块级 ContextVar 管理 trace_id 的跨函数/跨 Task 生命周期。
参见架构文档 §7.1 ~ §7.2, §7.5 ~ §7.6。
"""

from __future__ import annotations

from contextvars import ContextVar, Token
from uuid import uuid4

from src.main.infra.domain import TraceId
from src.main.infra.errors import TraceLostError
from src.main.infra.logging import get_logger

logger = get_logger(__name__)

# ── 模块级上下文变量 ──

_trace_id_var: ContextVar[TraceId] = ContextVar(
    "trace_id", default=TraceId("tr-unbound")
)


# ── 公开 API ──


def new_trace_id() -> TraceId:
    """生成新的 trace_id, 格式 ``tr-{uuid4().hex[:16]}``。"""
    return TraceId(f"tr-{uuid4().hex[:16]}")


def current_trace_id() -> TraceId:
    """返回当前上下文中的 trace_id。"""
    return _trace_id_var.get()


def bind(tid: TraceId) -> Token:
    """将 trace_id 绑定到当前上下文, 返回 Token 供后续 reset。"""
    return _trace_id_var.set(tid)


def reset(token: Token) -> None:
    """恢复 ``bind`` 之前的上下文状态。"""
    _trace_id_var.reset(token)


def assert_trace_bound() -> None:
    """断言当前 trace_id 已绑定。

    Raises:
        TraceLostError: 当 trace_id 仍为默认值 ``"tr-unbound"`` 时。
    """
    if current_trace_id() == TraceId("tr-unbound"):
        raise TraceLostError("trace_id is unbound")


def format_trace_id(tid: TraceId) -> str:
    """格式化 trace_id 为字符串。"""
    return str(tid)


# ── ASGI TracingMiddleware ──


class TracingMiddleware:
    """ASGI 中间件, 从 ``X-Trace-Id`` 请求头读取或生成 trace_id,
    并将其绑定到当前上下文, 同时回写响应头。
    """

    def __init__(self, app, header_name: str = "X-Trace-Id") -> None:
        self._app = app
        self._header_name = header_name

    async def __call__(self, scope, receive, send) -> None:
        if scope["type"] != "http":
            await self._app(scope, receive, send)
            return

        raw_headers = scope.get("headers") or []
        # Check for duplicate X-Trace-Id headers before building the dict
        header_key = self._header_name.lower().encode()
        count = sum(1 for k, _ in raw_headers if k == header_key)
        if count > 1:
            logger.warning(
                "trace.duplicate_header",
                header=self._header_name,
                count=count,
                message=f"Found {count} duplicate {self._header_name} headers; "
                f"only the last value will be used",
            )
        headers = dict(raw_headers)
        tid_bytes = headers.get(header_key)
        if tid_bytes:
            tid = TraceId(tid_bytes.decode())
        else:
            tid = new_trace_id()

        token = bind(tid)
        try:
            original_send = send

            async def send_with_trace_id(message):
                if message["type"] == "http.response.start":
                    raw_headers = list(message.get("headers", []))
                    raw_headers.append(
                        (self._header_name.lower().encode(), str(tid).encode())
                    )
                    message["headers"] = raw_headers
                await original_send(message)

            await self._app(scope, receive, send_with_trace_id)
        finally:
            reset(token)
