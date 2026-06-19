"""全项目统一的异常层级。

所有自定义异常必须继承 FinAgentError,禁止字符串匹配异常文本。
"""

from __future__ import annotations

from typing import Any, ClassVar

from src.main.infra.error_codes import ErrorCode

# TraceId 为前向引用,实际 import 待 TASK-002(infra/domain.py)合并后补全。
# 当前以字符串注解形式出现。


class FinAgentError(Exception):
    """根异常。所有 raise 必须落在这棵树上。"""

    code: ClassVar[ErrorCode]
    http_status: ClassVar[int]

    def __init__(
        self,
        message: str,
        *,
        details: dict | None = None,
        cause: Exception | None = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.details = details or {}
        self.__cause__ = cause

    def to_envelope(self, trace_id: "TraceId") -> dict:
        return {
            "code": int(self.code),
            "message": self.message,
            "data": self.details or None,
            "trace_id": str(trace_id),
        }


class BizError(FinAgentError):
    """业务规则违反。调用方可修正后重试。HTTP 4xx。"""


class SystemError(FinAgentError):
    """内部 bug。HTTP 5xx + 报警。"""


class InfraError(FinAgentError):
    """上游/下游故障（DB/网络/subprocess/超时）。HTTP 5xx 或 504。"""


# ── 1xxx: BizError ──


class WorkflowNotFoundError(BizError):
    code = ErrorCode.WORKFLOW_NOT_FOUND
    http_status = 404


class ExecutionNotFoundError(BizError):
    code = ErrorCode.EXECUTION_NOT_FOUND
    http_status = 404


class NodeNotFoundError(BizError):
    code = ErrorCode.NODE_NOT_FOUND
    http_status = 404


class AgentNotFoundError(BizError):
    code = ErrorCode.AGENT_NOT_DEFINED
    http_status = 422


class ValidationError(BizError):
    code = ErrorCode.VALIDATION_FAILED
    http_status = 422


# ── 2xxx: SystemError ──


class InvalidStateTransitionError(SystemError):
    code = ErrorCode.INVALID_STATE_TRANSITION
    http_status = 500


class ConfigError(SystemError):
    code = ErrorCode.CONFIG_INCONSISTENT
    http_status = 500


# ── 3xxx: InfraError ──


class DatabaseError(InfraError):
    code = ErrorCode.DATABASE_FAILURE
    http_status = 500


class AgentTimeoutError(InfraError):
    code = ErrorCode.AGENT_TIMEOUT
    http_status = 504


class AgentHttp5xxError(InfraError):
    code = ErrorCode.AGENT_UPSTREAM_5XX
    http_status = 502


class OpencodeUnavailableError(InfraError):
    code = ErrorCode.OPENCODE_UNAVAILABLE
    http_status = 503


class McpServerError(InfraError):
    code = ErrorCode.MCP_SERVER_FAILURE
    http_status = 502


class TraceLostError(InfraError):
    code = ErrorCode.TRACE_LOST
    http_status = 500


class RegistryError(FinAgentError):
    """DI 注册/解析错误。"""
    code = ErrorCode.PROTOCOL_VIOLATION
    http_status = 500
