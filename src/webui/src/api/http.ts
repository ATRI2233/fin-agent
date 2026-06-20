/**
 * Lightweight typed fetch wrapper for the Fin-Agent REST API.
 *
 * Every resource module in `webui/src/api/` builds on top of these helpers so
 * we get a single place to:
 * - inject `X-Trace-Id` for distributed tracing,
 * - normalise non-2xx responses into {@link ApiError} carrying an
 * {@link ApiErrorBody} body,
 * - forward an optional `AbortSignal` for cancelable requests.
 *
 * Callers usually compose a path with {@link buildUrl} using one of the
 * base URLs from `../config/env` (e.g. `API_V1_BASE`).
 *
 * @see ../types/api-error.ts for the error contract.
 * @see ../config/env.ts for the configurable base URLs.
 */

import { ApiError, type ApiErrorBody } from "../types/api-error";
import { API_V1_BASE } from "../config/env";

/** Content-Type used for both requests and the JSON problem responses. */
const JSON_CONTENT_TYPE = "application/json";

/** Header used to propagate request identifiers across hops. */
const TRACE_ID_HEADER = "X-Trace-Id";

/** HTTP status code that indicates an empty body (RFC 7231 §6.3.5). */
const HTTP_NO_CONTENT = 204;

/**
 * Join a base URL with a relative path, normalising duplicate or trailing
 * slashes so we never emit `//` segments or drop a meaningful leading slash.
 *
 * @param base - Origin or prefix such as `/api/v1`. Trailing slashes are
 * stripped.
 * @param path - Path such as `/agents/123`. A leading slash is enforced.
 * @returns A clean concatenation, e.g. `/api/v1/agents/123`.
 */
export function buildUrl(base: string, path: string): string {
  const trimmedBase = base.replace(/\/+$/, "");
  const trimmedPath = path.replace(/^\/+/, "");
  if (trimmedPath.length === 0) {
    return trimmedBase || "/";
  }
  return `${trimmedBase}/${trimmedPath}`;
}

/**
 * Generate a request identifier. Uses `crypto.randomUUID()` when available
 * (modern browsers + Node 19+) and falls back to a timestamp + random suffix
 * otherwise.
 */
function generateRequestId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Read the response body, parse it as JSON when possible, and extract a
 * {@link ApiErrorBody}. Falls back to a synthetic body when the payload is
 * empty, unparseable, or doesn't match the backend envelope shape.
 */
async function readApiError(response: Response): Promise<ApiErrorBody> {
  const text = await response.text();
  const fallback: ApiErrorBody = {
    code: -1,
    message: response.statusText || "Request failed",
    trace_id: "unknown",
  };
  if (text.length === 0) return fallback;
  try {
    const parsed = JSON.parse(text) as Partial<ApiErrorBody>;
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof parsed.code === "number" &&
      typeof parsed.message === "string"
    ) {
      return {
        code: parsed.code,
        message: parsed.message,
        data: parsed.data,
        trace_id: typeof parsed.trace_id === "string" ? parsed.trace_id : "unknown",
      };
    }
  } catch {
    // Fall through to fallback.
  }
  return fallback;
}

/**
 * Internal request driver shared by the public HTTP verb helpers. Handles
 * header construction, abort signal propagation, JSON parsing, and error
 * normalisation.
 */
async function request<T>(
  method: "GET" | "POST" | "PUT" | "DELETE",
  url: string,
  body: unknown | undefined,
  signal: AbortSignal | undefined,
): Promise<T> {
  const headers: Record<string, string> = {
    Accept: JSON_CONTENT_TYPE,
    "X-Trace-Id": generateRequestId(),
  };

  let payload: BodyInit | undefined;
  if (body !== undefined) {
    headers["Content-Type"] = JSON_CONTENT_TYPE;
    payload = JSON.stringify(body);
  }

  const init: RequestInit = { method, headers };
  if (payload !== undefined) {
    init.body = payload;
  }
  if (signal) {
    init.signal = signal;
  }

  const response = await fetch(url, init);
  const traceId = response.headers.get(TRACE_ID_HEADER) ?? undefined;

  if (!response.ok) {
    const body = await readApiError(response);
    throw new ApiError(response.status, body);
  }

  if (response.status === HTTP_NO_CONTENT) {
    return undefined as T;
  }

  // 2xx with a body — parse envelope and unwrap.
  const rawJson = (await response.json()) as unknown;
  // 信封格式: {code, data, trace_id} 或 {code, message, data, trace_id}
  if (
    rawJson &&
    typeof rawJson === "object" &&
    typeof (rawJson as Record<string, unknown>).code === "number" &&
    "data" in (rawJson as Record<string, unknown>)
  ) {
    const envelope = rawJson as {
      code: number;
      data?: unknown;
      message?: string;
      trace_id?: string;
    };
    if (envelope.code === 0) {
      return (envelope.data ?? undefined) as T;
    }
    // 业务/系统错误:抛 ApiError(协议层成功但业务失败)
    throw new ApiError(response.status, {
      code: envelope.code,
      message: envelope.message ?? "Request failed",
      data: envelope.data,
      trace_id: envelope.trace_id ?? "unknown",
    });
  }
  // 非信封格式(向后兼容):原样返回
  return rawJson as T;
}

/**
 * Issue a `GET` request and decode the JSON response as `T`.
 *
 * @param url - Absolute URL or a value built via {@link buildUrl}.
 * @param signal - Optional `AbortSignal` to cancel the request.
 */
export function apiGet<T>(url: string, signal?: AbortSignal): Promise<T> {
  return request<T>("GET", url, undefined, signal);
}

/**
 * Issue a `POST` request with an optional JSON-serialisable body and decode
 * the response as `T`.
 *
 * @param url - Absolute URL or a value built via {@link buildUrl}.
 * @param body - Plain object that will be `JSON.stringify`-ed. Omit for an
 * empty body.
 * @param signal - Optional `AbortSignal` to cancel the request.
 */
export function apiPost<T>(url: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  return request<T>("POST", url, body, signal);
}

/**
 * Issue a `PUT` request with an optional JSON-serialisable body and decode
 * the response as `T`.
 *
 * @param url - Absolute URL or a value built via {@link buildUrl}.
 * @param body - Plain object that will be `JSON.stringify`-ed. Omit for an
 * empty body.
 * @param signal - Optional `AbortSignal` to cancel the request.
 */
export function apiPut<T>(url: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  return request<T>("PUT", url, body, signal);
}

/**
 * Issue a `DELETE` request and decode the response as `T`.
 *
 * @param url - Absolute URL or a value built via {@link buildUrl}.
 * @param signal - Optional `AbortSignal` to cancel the request.
 */
export function apiDelete<T>(url: string, signal?: AbortSignal): Promise<T> {
  return request<T>("DELETE", url, undefined, signal);
}

/**
 * Issue a `GET` and return the raw response body as `string` (not JSON).
 * Useful for endpoints that return `text/plain` (e.g. agent markdown content).
 */
export async function apiGetText(url: string, signal?: AbortSignal): Promise<string> {
  const headers: Record<string, string> = {
    Accept: "text/plain",
    "X-Trace-Id": generateRequestId(),
  };
  const init: RequestInit = { method: "GET", headers };
  if (signal) init.signal = signal;

  const response = await fetch(url, init);
  if (!response.ok) {
    const body = await readApiError(response);
    throw new ApiError(response.status, body);
  }
  return response.text();
}

/**
 * Issue a `PUT` with a plain-text body (Content-Type: text/plain).
 * Useful for endpoints that accept raw text (e.g. agent/skill content).
 */
export async function apiPutText(url: string, body: string, signal?: AbortSignal): Promise<void> {
  const headers: Record<string, string> = {
    "Content-Type": "text/plain",
    "X-Trace-Id": generateRequestId(),
  };
  const init: RequestInit = { method: "PUT", headers, body };
  if (signal) init.signal = signal;

  const response = await fetch(url, init);
  if (!response.ok) {
    const body = await readApiError(response);
    throw new ApiError(response.status, body);
  }
}

/** Re-export the canonical error class so consumers only need this module. */
export { ApiError };

/** Default base URL exposed for callers that want the project default. */
export { API_V1_BASE };
