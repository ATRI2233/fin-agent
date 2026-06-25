import { ValidationError } from "../../infra/errors.js";
import type { AgentPort } from "../../../agents/adapter/AgentPort.js";
import type { Node } from "./domain/dag.js";

export interface NodeContext {
  node: Node;
  executionId: string;
  predecessorIds: string[];
  params: Record<string, unknown>;
  results: Record<string, NodeResult>;
  edges: Array<{ source: string; target: string }>;
  traceId: string;
  failedNodes: Set<string>;
}

export interface NodeResult {
  output: unknown;
  sessionId: string | null;
  extraData: Record<string, unknown>;
}

export interface NodeExecutor {
  execute(ctx: NodeContext): NodeResult | Promise<NodeResult>;
}

export interface IExecutorRegistry {
  create(nodeType: string): NodeExecutor;
}

export class InputExecutor implements NodeExecutor {
  execute(ctx: NodeContext): NodeResult {
    return {
      output: ctx.params,
      sessionId: null,
      extraData: {},
    };
  }
}

export class OutputExecutor implements NodeExecutor {
  execute(ctx: NodeContext): NodeResult {
    const inputs: unknown[] = [];
    for (const pid of ctx.predecessorIds) {
      if (pid in ctx.results) {
        inputs.push(ctx.results[pid]?.output);
      } else if (ctx.failedNodes.has(pid)) {
        continue;
      } else {
        throw new ValidationError(
          "output node encountered a predecessor that is neither completed nor failed",
          {
            missingPredecessor: pid,
            nodeId: ctx.node.id,
            executionId: ctx.executionId,
          }
        );
      }
    }
    return {
      output: { inputs },
      sessionId: null,
      extraData: {},
    };
  }
}

/** Agent node executor -- delegates to AgentPort. */
export class AgentExecutor implements NodeExecutor {
  constructor(private port: AgentPort) {}

  async execute(ctx: NodeContext): Promise<NodeResult> {
    const agentName = ctx.node.agent ?? "default";
    const output = await this.port.invoke({
      agentName,
      payload: ctx.params,
      traceId: ctx.traceId,
    });
    const extraData: Record<string, unknown> = {};
    if (output.usage) {
      extraData.tokenUsage = output.usage;
    }
    return {
      output: output.content,
      sessionId: null,
      extraData,
    };
  }
}
