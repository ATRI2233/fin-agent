/** 全项目统一的错误层级。 */

export const ErrorCode = {
  SUCCESS: 0,

  // 1xxx: BizError
  WORKFLOW_NOT_FOUND: 1001,
  EXECUTION_NOT_FOUND: 1002,
  CONVERSATION_NOT_FOUND: 1006,
  VALIDATION_FAILED: 1100,
  UNAUTHORIZED: 1101,

  // 2xxx: SystemError
  INVALID_STATE_TRANSITION: 2001,
  CONFIG_INCONSISTENT: 2002,
  PROTOCOL_VIOLATION: 2003,

  // 3xxx: InfraError
  DATABASE_FAILURE: 3001,
  AGENT_TIMEOUT: 3002,
  AGENT_UPSTREAM_5XX: 3003,
  MCP_SERVER_FAILURE: 3005,
  TRACE_LOST: 3006,
  INTERNAL_FAILURE: 3999,
} as const;

type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode];

interface ErrorDetails {
  [key: string]: unknown;
}

export class FinAgentError extends Error {
  readonly code: ErrorCodeValue;
  readonly httpStatus: number;
  readonly details: ErrorDetails;
  readonly cause?: Error;

  constructor(
    message: string,
    code: ErrorCodeValue = 0,
    httpStatus: number = 500,
    details: ErrorDetails = {},
    cause?: Error
  ) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.httpStatus = httpStatus;
    this.details = details;
    this.cause = cause;
  }

  toEnvelope(traceId: string): {
    code: number;
    message: string;
    data: ErrorDetails | null;
    trace_id: string;
  } {
    return {
      code: this.code,
      message: this.message,
      data: Object.keys(this.details).length > 0 ? this.details : null,
      trace_id: traceId,
    };
  }
}

/** 领域错误分类 — 用于标注错误的语义归属，在日志/监控/告警中区分责任域。 */
export type ErrorCategory = "biz" | "system" | "infra";

// ── DomainError (带分类的中间层) ──

/**
 * 带语义分类的领域错误。
 *
 * - `biz`    = 业务逻辑违规（状态异常、未找到、校验失败），通常对应 4xx
 * - `system` = 系统级故障（配置错误、非法状态跃迁），通常对应 5xx
 * - `infra`  = 外部基础设施故障（数据库、Agent 超时、MCP 不可用），通常对应 502/503/504
 *
 * 叶子子类（如 WorkflowNotFoundError）应通过构造函数固定 category，
 * 调用方无需感知此分层，通过 error.code / error.category 区分即可。
 */
export class DomainError extends FinAgentError {
  readonly category: ErrorCategory;

  constructor(
    message: string,
    code: ErrorCodeValue,
    category: ErrorCategory,
    httpStatus: number = 500,
    details: ErrorDetails = {},
    cause?: Error
  ) {
    super(message, code, httpStatus, details, cause);
    this.category = category;
  }
}

// ── BizError (4xx) ──

export class BizError extends DomainError {
  constructor(
    message: string,
    code: ErrorCodeValue,
    httpStatus: number = 400,
    details: ErrorDetails = {},
    cause?: Error
  ) {
    super(message, code, "biz", httpStatus, details, cause);
  }
}

export class WorkflowNotFoundError extends BizError {
  constructor(message = "Workflow not found", details: ErrorDetails = {}, cause?: Error) {
    super(message, ErrorCode.WORKFLOW_NOT_FOUND, 404, details, cause);
  }
}

export class ConversationNotFoundError extends BizError {
  constructor(message = "Conversation not found", details: ErrorDetails = {}, cause?: Error) {
    super(message, ErrorCode.CONVERSATION_NOT_FOUND, 404, details, cause);
  }
}

export class ExecutionNotFoundError extends BizError {
  constructor(message = "Execution not found", details: ErrorDetails = {}, cause?: Error) {
    super(message, ErrorCode.EXECUTION_NOT_FOUND, 404, details, cause);
  }
}

export class ValidationError extends BizError {
  constructor(message = "Validation failed", details: ErrorDetails = {}, cause?: Error) {
    super(message, ErrorCode.VALIDATION_FAILED, 422, details, cause);
  }
}

export class UnauthorizedError extends BizError {
  constructor(message = "Unauthorized", details: ErrorDetails = {}, cause?: Error) {
    super(message, ErrorCode.UNAUTHORIZED, 401, details, cause);
  }
}

// ── SystemError (5xx) ──

export class SystemError extends DomainError {
  constructor(
    message: string,
    code: ErrorCodeValue,
    httpStatus: number = 500,
    details: ErrorDetails = {},
    cause?: Error
  ) {
    super(message, code, "system", httpStatus, details, cause);
  }
}

export class InvalidStateTransitionError extends SystemError {
  constructor(
    message = "Invalid state transition",
    details: ErrorDetails = {},
    cause?: Error
  ) {
    super(message, ErrorCode.INVALID_STATE_TRANSITION, 500, details, cause);
  }
}

export class ConfigError extends SystemError {
  constructor(message = "Configuration inconsistent", details: ErrorDetails = {}, cause?: Error) {
    super(message, ErrorCode.CONFIG_INCONSISTENT, 500, details, cause);
  }
}

// ── InfraError (5xx/502/503/504) ──

export class InfraError extends DomainError {
  constructor(
    message: string,
    code: ErrorCodeValue,
    httpStatus: number = 500,
    details: ErrorDetails = {},
    cause?: Error
  ) {
    super(message, code, "infra", httpStatus, details, cause);
  }
}

export class DatabaseError extends InfraError {
  constructor(message = "Database failure", details: ErrorDetails = {}, cause?: Error) {
    super(message, ErrorCode.DATABASE_FAILURE, 500, details, cause);
  }
}

export class AgentTimeoutError extends InfraError {
  constructor(message = "Agent timeout", details: ErrorDetails = {}, cause?: Error) {
    super(message, ErrorCode.AGENT_TIMEOUT, 504, details, cause);
  }
}

export class AgentHttp5xxError extends InfraError {
  constructor(message = "Agent upstream 5xx", details: ErrorDetails = {}, cause?: Error) {
    super(message, ErrorCode.AGENT_UPSTREAM_5XX, 502, details, cause);
  }
}
