import { ValidationError } from "../../infra/errors.js";
import { Node } from "./domain/dag.js";

export interface NodeContext {
  node: Node;
  executionId: string;
  predecessorIds: string[];
  params: Record<string, unknown>;
  results: Record<string, NodeResult>;
  edges: Array<{ source: string; target: string }>;
  traceId: string;
  chainSessions: Record<string, string>;
  failedNodes: Set<string>;
}

export interface NodeResult {
  output: unknown;
  sessionId: string | null;
  extraData: Record<string, unknown>;
}

export interface NodeExecutor {
  execute(ctx: NodeContext): Promise<NodeResult>;
}

export class InputExecutor implements NodeExecutor {
  async execute(ctx: NodeContext): Promise<NodeResult> {
    return {
      output: ctx.params,
      sessionId: null,
      extraData: {},
    };
  }
}

export class OutputExecutor implements NodeExecutor {
  async execute(ctx: NodeContext): Promise<NodeResult> {
    const inputs: unknown[] = [];
    for (const pid of ctx.predecessorIds) {
      if (pid in ctx.results) {
        inputs.push(ctx.results[pid].output);
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
