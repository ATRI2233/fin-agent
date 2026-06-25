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
import { settings } from "../settings.js";
import { createLogger } from "../logging.js";
import { ValidationError, AgentTimeoutError, AgentHttp5xxError } from "../errors.js";

const log = createLogger("openclaw-adapter");

/** Load system prompt from OpenCode agent definition file */
function loadAgentSystemPrompt(agentName: string): string | undefined {
  try {
    const path = resolve(process.cwd(), `config/agents/${agentName}.md`);
    const content = readFileSync(path, "utf-8");
    // Extract content after YAML frontmatter (--- ... ---)
    const match = content.match(/^---\s*\n[\s\S]*?\n---\s*\n([\s\S]*)$/);
    return match ? match[1].trim() : content.trim();
  } catch {
    return undefined;
  }
}

export class OpenClawAdapter implements AgentPort {
  private baseUrl: string;
  private apiKey: string;

  constructor(baseUrl?: string, apiKey?: string) {
    this.baseUrl = baseUrl ?? settings.OPENCLAW_API_BASE;
    this.apiKey = apiKey ?? settings.OPENCLAW_API_KEY;
  }

  async invoke(input: AgentInput): Promise<AgentOutput> {
    const { agentName, payload, traceId, options } = input;
    const url = `${this.baseUrl}/chat/completions`;

    const systemPrompt = loadAgentSystemPrompt(agentName);
    const messages: Array<{ role: string; content: string }> = [];
    if (systemPrompt) {
      messages.push({ role: "system", content: systemPrompt });
    }
    messages.push({
      role: "user",
      content: typeof payload === "string" ? payload : JSON.stringify(payload),
    });

    const body: Record<string, unknown> = {
      model: "deepseek-v4-flash",
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

    try {
      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
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
      throw new AgentTimeoutError(`Agent '${agentName}' unreachable at ${this.baseUrl}`);
    }
  }
}
