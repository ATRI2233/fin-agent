"""API 统一响应信封。

所有 HTTP 接口响应格式::

    {
        "code":     int,       # ErrorCode 数值
        "message":  str,       # 可读消息
        "data":     Any | None,# 业务载荷（异常时为 None 或 details dict）
        "trace_id": str,       # 请求追踪 ID
    }
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from src.main.infra.domain import TraceId
from src.main.infra.error_codes import ErrorCode
from src.main.infra.errors import FinAgentError


@dataclass(frozen=True)
class ApiResponse:
    """不可变的 API 响应信封。"""

    code: ErrorCode
    message: str
    data: Any | None
    trace_id: TraceId

    def to_dict(self) -> dict:
        """序列化为普通字典，供 JSON 编码。"""
        return {
            "code": int(self.code),
            "message": self.message,
            "data": self.data,
            "trace_id": str(self.trace_id),
        }

    @classmethod
    def from_exception(cls, error: FinAgentError, trace_id: TraceId) -> ApiResponse:
        """从异常构造错误响应。"""
        return cls(
            code=error.code,
            message=error.message,
            data=error.details or None,
            trace_id=trace_id,
        )

    @classmethod
    def success(
        cls,
        data: Any,
        trace_id: TraceId,
        message: str = "ok",
    ) -> ApiResponse:
        """构造成功响应。"""
        return cls(
            code=ErrorCode.SUCCESS,
            message=message,
            data=data,
            trace_id=trace_id,
        )
