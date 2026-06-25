/**
 * infra/agent/OpenClawAdapter.ts — OpenClaw 适配器（Adapter 模式中的 Adapter）
 *
 * 唯一知道 OpenClaw 存在的文件。实现 AgentPort 接口，
 * 封装所有 OpenClaw HTTP Chat Completions API 调用细节。
 * 如果未来需要替换 OpenClaw 为其他 Agent 后端，只需重写此文件。
 */

import { readFileSync } from "fs";
import { resolve } from "path";
import type { AgentPort, AgentInput, AgentOutput } from "./AgentPort.js";
import { settings } from "../../server/infra/settings.js";
import { createLogger } from "../../server/infra/logging.js";
import { ValidationError, AgentTimeoutError, AgentHttp5xxError } from "../../server/infra/errors.js";

const log = createLogger("openclaw-adapter");

const OPENCLAW_FETCH_TIMEOUT_MS = 30_000;

export class OpenClawAdapter implements AgentPort {
  private baseUrl: string;
  private apiKey: string;
  private systemPromptCache = new Map<string, string>();

  constructor(baseUrl?: string, apiKey?: string) {
    this.baseUrl = (baseUrl ?? settings.OPENCLAW_API_BASE).replace(/\/+$/, '');
    this.apiKey = apiKey ?? settings.OPENCLAW_API_KEY;
  }

  private loadAgentSystemPrompt(agentName: string): string | undefined {
    const cached = this.systemPromptCache.get(agentName);
    if (cached !== undefined) return cached;
    try {
      const path = resolve(process.cwd(), `config/agents/${agentName}.md`);
      const content = readFileSync(path, "utf-8");
      const match = content.match(/^---\s*\n[\s\S]*?\n---\s*\n([\s\S]*)$/);
      const result = match?.[1]?.trim() ?? content.trim();
      this.systemPromptCache.set(agentName, result);
      return result;
    } catch {
      return undefined;
    }
  }

  async invoke(input: AgentInput): Promise<AgentOutput> {
    const { agentName, payload, traceId, options } = input;
    const url = `${this.baseUrl}/chat/completions`;

    const systemPrompt = this.loadAgentSystemPrompt(agentName);
    const messages: Array<{ role: string; content: string }> = [];
    if (systemPrompt) {
      messages.push({ role: "system", content: systemPrompt });
    }
    messages.push({
      role: "user",
      content: typeof payload === "string" ? payload : JSON.stringify(payload),
    });

    const body: Record<string, unknown> = {
      model: settings.OPENCLAW_MODEL,
      messages,
      stream: false,
    };

    if (options?.maxTokens != null) {
      body.max_tokens = options.maxTokens;
    }
    if (options?.temperature != null) {
      body.temperature = options.temperature;
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      [settings.TRACE_ID_HEADER]: traceId,
    };

    if (this.apiKey) {
      headers["Authorization"] = `Bearer ${this.apiKey}`;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), OPENCLAW_FETCH_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        log.error({ status: response.status, agent: agentName, traceId }, "Agent HTTP error");
        if (response.status >= 500) {
          throw new AgentHttp5xxError(`Agent '${agentName}' returned HTTP ${response.status}`);
        }
        throw new ValidationError(
          `Agent '${agentName}' returned HTTP ${response.status}: ${text.slice(0, 300)}`
        );
      }

      const data = (await response.json()) as {
        id?: string;
        choices?: Array<{
          message?: { content?: string; role?: string };
          finish_reason?: string;
        }>;
        usage?: {
          prompt_tokens?: number;
          completion_tokens?: number;
          total_tokens?: number;
        };
      };

      const content = data?.choices?.[0]?.message?.content;
      if (content === undefined || content === null) {
        throw new ValidationError(`Agent '${agentName}' returned empty response`);
      }

      const usage = data.usage
        ? {
            promptTokens: data.usage.prompt_tokens,
            completionTokens: data.usage.completion_tokens,
            totalTokens: data.usage.total_tokens,
          }
        : undefined;

      return { content, raw: content, usage };
    } catch (e) {
      if (e instanceof AgentHttp5xxError || e instanceof ValidationError) throw e;

      // AbortError from AbortController = genuine timeout
      if (e instanceof DOMException && e.name === "AbortError") {
        throw new AgentTimeoutError(
          `Agent '${agentName}' timed out after ${OPENCLAW_FETCH_TIMEOUT_MS}ms`
        );
      }

      // TypeError from fetch = network-level failure (DNS, connection refused, etc.)
      if (e instanceof TypeError) {
        throw new AgentHttp5xxError(
          `Agent '${agentName}' unreachable at ${this.baseUrl}: ${e.message}`
        );
      }

      // Unknown error — re-throw rather than misclassify
      throw e;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
