import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "fs";
import { OpenClawAdapter } from "../../../../src/agents/adapter/OpenClawAdapter.js";
import { AgentTimeoutError, AgentHttp5xxError, ValidationError } from "../../../../src/server/infra/errors.js";

// ---------------------------------------------------------------------------
// Module-level mocks (vi.mock is hoisted above imports)
// ---------------------------------------------------------------------------

vi.mock("fs", () => ({
  readFileSync: vi.fn(),
}));

vi.mock("../../../../src/server/infra/settings.js", () => ({
  settings: {
    OPENCLAW_API_BASE: "https://api.openclaw.ai/v1",
    OPENCLAW_API_KEY: "test-key",
    OPENCLAW_MODEL: "test-model",
    TRACE_ID_HEADER: "X-Trace-Id",
  },
}));

vi.mock("../../../../src/server/infra/logging.js", () => ({
  createLogger: () => ({
    info: () => {},
    error: () => {},
    warn: () => {},
    debug: () => {},
  }),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal Response-shaped object representing a 200 OK.
 * When `content` is explicitly passed as `null`, the JSON body will carry
 * `content: null` so the adapter's null-check is exercised.
 * When omitted, a default string is used.
 */
function mockOkResponse(
  content?: string | null,
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number },
): Response {
  const resolvedContent = arguments.length >= 1 ? content : "test response";
  const resolvedUsage = usage ?? { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 };
  return {
    ok: true,
    status: 200,
    json: () =>
      Promise.resolve({
        choices: [{ message: { content: resolvedContent, role: "assistant" }, finish_reason: "stop" }],
        usage: resolvedUsage,
      }),
    text: () => Promise.resolve(""),
  } as Response;
}

function mockErrorResponse(status: number, body?: string): Response {
  return {
    ok: false,
    status,
    text: () => Promise.resolve(body ?? "error"),
  } as Response;
}

const defaultInput = {
  agentName: "test-agent",
  payload: "hello",
  traceId: "tr-1",
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("OpenClawAdapter", () => {
  let originalFetch: typeof globalThis.fetch;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    originalFetch = globalThis.fetch;
    mockFetch = vi.fn();
    globalThis.fetch = mockFetch as unknown as typeof globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // ── constructor ──

  describe("constructor", () => {
    it("should use provided baseUrl and apiKey when given", async () => {
      mockFetch.mockResolvedValueOnce(mockOkResponse());
      const adapter = new OpenClawAdapter("http://custom-url", "custom-key");

      await adapter.invoke(defaultInput);

      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toBe("http://custom-url/chat/completions");
      expect(init.headers["Authorization"]).toBe("Bearer custom-key");
    });

    it("should fall back to settings defaults when no arguments provided", async () => {
      mockFetch.mockResolvedValueOnce(mockOkResponse());
      const adapter = new OpenClawAdapter();

      await adapter.invoke(defaultInput);

      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toBe("https://api.openclaw.ai/v1/chat/completions");
      expect(init.headers["Authorization"]).toBe("Bearer test-key");
    });
  });

  // ── invoke — success paths ──

  describe("invoke — success paths", () => {
    it("should send a POST request to the correct URL with correct headers", async () => {
      mockFetch.mockResolvedValueOnce(mockOkResponse());
      const adapter = new OpenClawAdapter("http://base", "key");

      await adapter.invoke(defaultInput);

      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toBe("http://base/chat/completions");
      expect(init.method).toBe("POST");
      expect(init.headers).toMatchObject({
        "Content-Type": "application/json",
        "X-Trace-Id": "tr-1",
      });
    });

    it("should include system prompt in messages when agent file exists", async () => {
      vi.mocked(readFileSync).mockReturnValueOnce(
        "---\nname: test-agent\n---\n\nYou are a financial analyst.",
      );
      mockFetch.mockResolvedValueOnce(mockOkResponse());
      const adapter = new OpenClawAdapter("http://base", "key");

      await adapter.invoke(defaultInput);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.messages).toEqual([
        { role: "system", content: "You are a financial analyst." },
        { role: "user", content: "hello" },
      ]);
    });

    it("should stringify object payload to JSON", async () => {
      mockFetch.mockResolvedValueOnce(mockOkResponse());
      const adapter = new OpenClawAdapter("http://base", "key");
      const payload = { symbol: "AAPL", query: "price" };

      await adapter.invoke({ ...defaultInput, payload });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.messages[0]).toEqual({
        role: "user",
        content: JSON.stringify(payload),
      });
    });

    it("should pass string payload directly", async () => {
      mockFetch.mockResolvedValueOnce(mockOkResponse());
      const adapter = new OpenClawAdapter("http://base", "key");

      await adapter.invoke(defaultInput);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.messages[0]).toEqual({ role: "user", content: "hello" });
    });

    it("should include optional maxTokens and temperature in request body", async () => {
      mockFetch.mockResolvedValueOnce(mockOkResponse());
      const adapter = new OpenClawAdapter("http://base", "key");

      await adapter.invoke({
        ...defaultInput,
        options: { maxTokens: 500, temperature: 0.7 },
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.max_tokens).toBe(500);
      expect(body.temperature).toBe(0.7);
    });

    it("should return AgentOutput with content and raw fields", async () => {
      mockFetch.mockResolvedValueOnce(mockOkResponse("analysis result"));
      const adapter = new OpenClawAdapter("http://base", "key");

      const result = await adapter.invoke(defaultInput);

      expect(result).toMatchObject({
        content: "analysis result",
        raw: "analysis result",
      });
    });

    it("should include TokenUsage when response has usage data", async () => {
      mockFetch.mockResolvedValueOnce(
        mockOkResponse("response", { prompt_tokens: 5, completion_tokens: 15, total_tokens: 20 }),
      );
      const adapter = new OpenClawAdapter("http://base", "key");

      const result = await adapter.invoke(defaultInput);

      expect(result.usage).toEqual({
        promptTokens: 5,
        completionTokens: 15,
        totalTokens: 20,
      });
    });

    it("should include Authorization header when apiKey is set", async () => {
      mockFetch.mockResolvedValueOnce(mockOkResponse());
      const adapter = new OpenClawAdapter("http://base", "my-secret-key");

      await adapter.invoke(defaultInput);

      expect(mockFetch.mock.calls[0][1].headers["Authorization"]).toBe(
        "Bearer my-secret-key",
      );
    });
  });

  // ── invoke — error handling ──

  describe("invoke — error handling", () => {
    it("should throw AgentHttp5xxError on 5xx response", async () => {
      mockFetch.mockResolvedValueOnce(mockErrorResponse(502));
      const adapter = new OpenClawAdapter("http://base", "key");

      await expect(adapter.invoke(defaultInput)).rejects.toThrow(
        AgentHttp5xxError,
      );
    });

    it("should throw ValidationError on 4xx response", async () => {
      mockFetch.mockResolvedValueOnce(mockErrorResponse(422, "Bad request"));
      const adapter = new OpenClawAdapter("http://base", "key");

      await expect(adapter.invoke(defaultInput)).rejects.toThrow(
        ValidationError,
      );
    });

    it("should throw ValidationError when response content is null or undefined", async () => {
      mockFetch.mockResolvedValueOnce(mockOkResponse(null));
      const adapter = new OpenClawAdapter("http://base", "key");

      await expect(adapter.invoke(defaultInput)).rejects.toThrow(
        ValidationError,
      );
    });

    it("should throw AgentHttp5xxError when fetch fails with TypeError (network error)", async () => {
      mockFetch.mockRejectedValueOnce(new TypeError("fetch failed"));
      const adapter = new OpenClawAdapter("http://base", "key");

      await expect(adapter.invoke(defaultInput)).rejects.toThrow(
        AgentHttp5xxError,
      );
    });

    it("should throw AgentTimeoutError when fetch fails with AbortError (timeout)", async () => {
      mockFetch.mockRejectedValueOnce(
        new DOMException("The operation was aborted", "AbortError"),
      );
      const adapter = new OpenClawAdapter("http://base", "key");

      await expect(adapter.invoke(defaultInput)).rejects.toThrow(
        AgentTimeoutError,
      );
    });
  });
});
