/**
 * Lightweight typed fetch wrapper for the Fin-Agent REST API.
 *
 * Every resource module in `webui/src/api/` builds on top of these helpers so
 * we get a single place to:
 *   - inject `X-Request-ID` for distributed tracing,
 *   - normalise non-2xx responses into {@link ApiError} carrying an RFC 7807
 *     {@link ProblemDetail} body,
 *   - forward an optional `AbortSignal` for cancelable requests.
 *
 * Callers usually compose a path with {@link buildUrl} using one of the
 * base URLs from `../config/env` (e.g. `API_V1_BASE`).
 *
 * @see ../types/api-error.ts for the error contract.
 * @see ../config/env.ts for the configurable base URLs.
 */

import { ApiError, type ProblemDetail } from "../types/api-error";
import { API_V1_BASE } from "../config/env";

/** Content-Type used for both requests and the JSON problem responses. */
const JSON_CONTENT_TYPE = "application/json";

/** Header used to propagate request identifiers across hops. */
const REQUEST_ID_HEADER = "X-Request-ID";

/** HTTP status code that indicates an empty body (RFC 7231 §6.3.5). */
const HTTP_NO_CONTENT = 204;

/**
 * Join a base URL with a relative path, normalising duplicate or trailing
 * slashes so we never emit `//` segments or drop a meaningful leading slash.
 *
 * @param base - Origin or prefix such as `/api/v1`. Trailing slashes are
 *   stripped.
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
 * Read the response body, parse it as JSON when possible, and fall back to a
 * synthetic {@link ProblemDetail} for non-JSON or unparseable payloads.
 */
async function readProblem(response: Response, fallbackStatus: number): Promise<ProblemDetail> {
  const text = await response.text();
  if (text.length === 0) {
    return {
      type: "about:blank",
      title: response.statusText || "Request failed",
      status: fallbackStatus,
    };
  }
  try {
    const parsed = JSON.parse(text) as Partial<ProblemDetail>;
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof parsed.type === "string" &&
      typeof parsed.title === "string" &&
      typeof parsed.status === "number"
    ) {
      return parsed as ProblemDetail;
    }
  } catch {
    // Fall through to synthetic problem below.
  }
  return {
    type: "about:blank",
    title: response.statusText || "Request failed",
    status: fallbackStatus,
    detail: text.slice(0, 500),
  };
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
    "X-Request-ID": generateRequestId(),
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
  const requestId = response.headers.get(REQUEST_ID_HEADER) ?? undefined;

  if (!response.ok) {
    const problem = await readProblem(response, response.status);
    throw new ApiError(problem, requestId);
  }

  if (response.status === HTTP_NO_CONTENT) {
    return undefined as T;
  }

  // 2xx with a body — parse and return.
  return (await response.json()) as T;
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
 *   empty body.
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
 *   empty body.
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

/** Re-export the canonical error class so consumers only need this module. */
export { ApiError };

/** Default base URL exposed for callers that want the project default. */
export { API_V1_BASE };
