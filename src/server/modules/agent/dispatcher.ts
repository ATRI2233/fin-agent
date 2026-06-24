import { ValidationError, AgentTimeoutError, AgentHttp5xxError } from "../../infra/errors.js";
import { settings, getOpencodeServeUrl } from "../../infra/settings.js";
import { createLogger } from "../../infra/logging.js";

const log = createLogger("agent-dispatcher");

/** AgentDispatcher — HTTP client to opencode serve (port 4096).
 *
 * Replaces the old Python serve_backend.py subprocess model.
 * All agent calls go through the opencode HTTP API, keeping the
 * same runtime environment as before.
 */
export class AgentDispatcher {
  private baseUrl: string;

  constructor(baseUrl?: string) {
    this.baseUrl = baseUrl ?? getOpencodeServeUrl(settings);
  }

  /** POST /v1/messages to the opencode serve backend. */
  async dispatch(agentName: string, input: unknown, traceId: string): Promise<unknown> {
    const url = `${this.baseUrl}/v1/messages`;
    const body = {
      message: JSON.stringify(input),
      agent: agentName,
    };

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          [settings.TRACE_ID_HEADER]: traceId,
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        log.error({ status: response.status, agent: agentName, traceId }, "Agent HTTP error");
        if (response.status >= 500) {
          throw new AgentHttp5xxError(`Agent '${agentName}' returned HTTP ${response.status}`);
        }
        throw new ValidationError(`Agent '${agentName}' returned HTTP ${response.status}: ${text.slice(0, 300)}`);
      }

      return await response.json();
    } catch (e) {
      if (e instanceof AgentHttp5xxError || e instanceof ValidationError) throw e;
      // fetch-level error (connection refused, timeout, etc.)
      throw new AgentTimeoutError(`Agent '${agentName}' unreachable at ${this.baseUrl}`);
    }
  }

  /** Parallel dispatch — Promise.all over multiple agents. */
  async dispatchParallel(
    agents: string[],
    input: unknown,
    traceId: string
  ): Promise<unknown[]> {
    return Promise.all(
      agents.map((name) => this.dispatch(name, input, traceId))
    );
  }
}

/** Factory — creates a dispatcher using the current settings. */
export function createAgentDispatcher(): AgentDispatcher {
  return new AgentDispatcher();
}
