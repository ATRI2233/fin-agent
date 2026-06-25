import type { AgentPort, AgentOutput } from "../../../agents/adapter/AgentPort.js";
import { FinAgentError, ErrorCode } from "../../infra/errors.js";
import { readdirSync } from "fs";
import { resolve } from "path";

export interface IAgentService {
  getAgent(name: string): { name: string } | null;
  listAgents(): { name: string }[];
  dispatchAgent(name: string, input: Record<string, unknown>, traceId: string): Promise<unknown>;
}

export class AgentService implements IAgentService {
  constructor(private agentPort: AgentPort) {}

  getAgent(name: string): { name: string } | null {
    try {
      const agentsDir = resolve(process.cwd(), "config/agents");
      const files = readdirSync(agentsDir);
      if (!files.includes(`${name}.md`)) {
        return null;
      }
      return { name };
    } catch {
      return null;
    }
  }

  listAgents(): { name: string }[] {
    try {
      const agentsDir = resolve(process.cwd(), "config/agents");
      const files = readdirSync(agentsDir);
      return files
        .filter(f => f.endsWith(".md"))
        .map(f => ({ name: f.replace(/\.md$/, "") }));
    } catch {
      return [];
    }
  }

  async dispatchAgent(name: string, input: Record<string, unknown>, traceId: string): Promise<unknown> {
    try {
      const result: AgentOutput = await this.agentPort.invoke({
        agentName: name,
        payload: input,
        traceId,
      });
      return result.content;
    } catch (e) {
      if (e instanceof FinAgentError) throw e;
      throw new FinAgentError(
        `Agent '${name}' dispatch failed`,
        ErrorCode.INTERNAL_FAILURE,
        500,
        { agent: name, cause: String(e) }
      );
    }
  }
}
