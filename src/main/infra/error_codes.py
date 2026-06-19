"""错误码枚举。

数字分段含义:
    1xxx — BizError (业务规则违反,调用方可修正后重试,HTTP 4xx)
    2xxx — SystemError (内部 bug,HTTP 5xx + 报警)
    3xxx — InfraError (上游/下游故障,HTTP 5xx/502/503/504)
"""

from enum import IntEnum


class ErrorCode(IntEnum):
    """全项目统一的错误码枚举。"""

    # ── 通用 ──
    SUCCESS = 0

    # ── 1xxx: BizError ──
    WORKFLOW_NOT_FOUND = 1001
    EXECUTION_NOT_FOUND = 1002
    NODE_NOT_FOUND = 1003
    AGENT_NOT_DEFINED = 1004
    AGENT_NOT_SPECIFIED = 1005
    VALIDATION_FAILED = 1100

    # ── 2xxx: SystemError ──
    INVALID_STATE_TRANSITION = 2001
    CONFIG_INCONSISTENT = 2002
    PROTOCOL_VIOLATION = 2003

    # ── 3xxx: InfraError ──
    DATABASE_FAILURE = 3001
    AGENT_TIMEOUT = 3002
    AGENT_UPSTREAM_5XX = 3003
    OPENCODE_UNAVAILABLE = 3004
    MCP_SERVER_FAILURE = 3005
    TRACE_LOST = 3006
