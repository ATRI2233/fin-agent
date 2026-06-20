/**
 * 后端 ApiResponse 错误格式 — 对应 src/main/infra/api_envelope.py
 *
 * 后端统一错误信封字段，HTTP 层(axios/fetch 拦截器)解析后包装进 {@link ApiError}。
 */
export interface ApiErrorBody {
  /** 后端 ErrorCode 数值 (0=成功, 1xxx=业务, 2xxx=系统, 3xxx=基础设施) */
  code: number;
  /** 人类可读错误消息 */
  message: string;
  /** 额外错误详情 (可选，如 ValidationError 的字段列表) */
  data?: unknown;
  /** 请求追踪 ID — 可用于后端日志关联排查 */
  trace_id: string;
}

/**
 * Runtime error wrapping a {code, message, data, trace_id} response from the API.
 *
 * Throw this (or its subclasses) from fetch/Axios interceptors so call sites
 * can react to typed error bodies instead of raw HTTP statuses.
 */
export class ApiError extends Error {
  /** HTTP status code from the response. */
  public readonly status: number;
  /** Backend error code (0=success, 1xxx=biz, 2xxx=system, 3xxx=infra). */
  public readonly code: number;
  /** Trace ID for correlating with backend logs (from `X-Trace-Id` header or body.trace_id). */
  public readonly traceId: string;
  /** Full parsed error body. */
  public readonly body: ApiErrorBody;
  /** Convenience accessor for `body.data`. */
  public readonly data?: unknown;

  constructor(status: number, body: ApiErrorBody) {
    super(body.message);
    this.name = "ApiError";
    this.status = status;
    this.code = body.code;
    this.traceId = body.trace_id;
    this.body = body;
    this.data = body.data;
    // Restore prototype chain when targeting ES5 / transpiled output.
    Object.setPrototypeOf(this, ApiError.prototype);
  }

  /** Business error (1xxx range). */
  get isBizError(): boolean {
    return this.code >= 1000 && this.code < 2000;
  }

  /** System error (2xxx range and above). */
  get isSystemError(): boolean {
    return this.code >= 2000;
  }
}

/**
 * Type guard that narrows an unknown thrown value to {@link ApiError}.
 *
 * @param e - Value caught from a `try`/`catch` or rejection handler.
 * @returns `true` when `e` is an {@link ApiError} instance.
 */
export function isApiError(e: unknown): e is ApiError {
  return e instanceof ApiError;
}
