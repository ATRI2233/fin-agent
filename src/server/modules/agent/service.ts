import type { AgentPort, AgentOutput } from "../../../agents/adapter/AgentPort.js";
import { FinAgentError, ErrorCode } from "../../infra/errors.js";

export interface IAgentService {
  getAgent(name: string): { name: string };
  dispatchAgent(name: string, input: Record<string, unknown>, traceId: string): Promise<unknown>;
}

export class AgentService implements IAgentService {
  constructor(private agentPort: AgentPort) {}

  getAgent(name: string): { name: string } {
    return { name };
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
