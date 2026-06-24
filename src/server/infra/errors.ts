/** 全项目统一的错误层级。 */

export const ErrorCode = {
  SUCCESS: 0,

  // 1xxx: BizError
  WORKFLOW_NOT_FOUND: 1001,
  EXECUTION_NOT_FOUND: 1002,
  NODE_NOT_FOUND: 1003,
  AGENT_NOT_DEFINED: 1004,
  AGENT_NOT_SPECIFIED: 1005,
  VALIDATION_FAILED: 1100,

  // 2xxx: SystemError
  INVALID_STATE_TRANSITION: 2001,
  CONFIG_INCONSISTENT: 2002,
  PROTOCOL_VIOLATION: 2003,

  // 3xxx: InfraError
  DATABASE_FAILURE: 3001,
  AGENT_TIMEOUT: 3002,
  AGENT_UPSTREAM_5XX: 3003,
  OPENCODE_UNAVAILABLE: 3004,
  MCP_SERVER_FAILURE: 3005,
  TRACE_LOST: 3006,
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

// ── BizError (4xx) ──

export class BizError extends FinAgentError {
  constructor(
    message: string,
    code: ErrorCodeValue,
    httpStatus: number = 400,
    details: ErrorDetails = {}
  ) {
    super(message, code, httpStatus, details);
  }
}

export class WorkflowNotFoundError extends BizError {
  constructor(message = "Workflow not found", details: ErrorDetails = {}) {
    super(message, ErrorCode.WORKFLOW_NOT_FOUND, 404, details);
  }
}

export class ExecutionNotFoundError extends BizError {
  constructor(message = "Execution not found", details: ErrorDetails = {}) {
    super(message, ErrorCode.EXECUTION_NOT_FOUND, 404, details);
  }
}

export class NodeNotFoundError extends BizError {
  constructor(message = "Node not found", details: ErrorDetails = {}) {
    super(message, ErrorCode.NODE_NOT_FOUND, 404, details);
  }
}

export class AgentNotFoundError extends BizError {
  constructor(message = "Agent not defined", details: ErrorDetails = {}) {
    super(message, ErrorCode.AGENT_NOT_DEFINED, 422, details);
  }
}

export class ValidationError extends BizError {
  constructor(message = "Validation failed", details: ErrorDetails = {}) {
    super(message, ErrorCode.VALIDATION_FAILED, 422, details);
  }
}

// ── SystemError (5xx) ──

export class SystemError extends FinAgentError {
  constructor(
    message: string,
    code: ErrorCodeValue,
    httpStatus: number = 500,
    details: ErrorDetails = {}
  ) {
    super(message, code, httpStatus, details);
  }
}

export class InvalidStateTransitionError extends SystemError {
  constructor(
    message = "Invalid state transition",
    details: ErrorDetails = {}
  ) {
    super(message, ErrorCode.INVALID_STATE_TRANSITION, 500, details);
  }
}

export class ConfigError extends SystemError {
  constructor(message = "Configuration inconsistent", details: ErrorDetails = {}) {
    super(message, ErrorCode.CONFIG_INCONSISTENT, 500, details);
  }
}

// ── InfraError (5xx/502/503/504) ──

export class InfraError extends FinAgentError {
  constructor(
    message: string,
    code: ErrorCodeValue,
    httpStatus: number = 500,
    details: ErrorDetails = {}
  ) {
    super(message, code, httpStatus, details);
  }
}

export class DatabaseError extends InfraError {
  constructor(message = "Database failure", details: ErrorDetails = {}) {
    super(message, ErrorCode.DATABASE_FAILURE, 500, details);
  }
}

export class AgentTimeoutError extends InfraError {
  constructor(message = "Agent timeout", details: ErrorDetails = {}) {
    super(message, ErrorCode.AGENT_TIMEOUT, 504, details);
  }
}

export class AgentHttp5xxError extends InfraError {
  constructor(message = "Agent upstream 5xx", details: ErrorDetails = {}) {
    super(message, ErrorCode.AGENT_UPSTREAM_5XX, 502, details);
  }
}

export class OpencodeUnavailableError extends InfraError {
  constructor(message = "Opencode unavailable", details: ErrorDetails = {}) {
    super(message, ErrorCode.OPENCODE_UNAVAILABLE, 503, details);
  }
}

export class McpServerError extends InfraError {
  constructor(message = "MCP server failure", details: ErrorDetails = {}) {
    super(message, ErrorCode.MCP_SERVER_FAILURE, 502, details);
  }
}

export class TraceLostError extends InfraError {
  constructor(message = "Trace lost", details: ErrorDetails = {}) {
    super(message, ErrorCode.TRACE_LOST, 500, details);
  }
}

export class RegistryError extends SystemError {
  constructor(message = "Registry error", details: ErrorDetails = {}) {
    super(message, ErrorCode.PROTOCOL_VIOLATION, 500, details);
  }
}
