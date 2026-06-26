import { gatewayClient } from "../../infra/gateway-client.js";

export interface WorkflowDefinition {
  id: string;
  name: string;
  nodes?: Array<{ id: string; agent?: string; label?: string; type?: string }>;
}

export interface NodeStatus {
  nodeId: string;
  agent: string;
  status: string; // "pending" | "running" | "completed" | "failed" | "skipped"
  output?: string;
  error?: string;
}

export interface ExecutionSummary {
  executionId: string;
  workflowId: string;
  status: string; // "completed" | "failed" | "cancelled"
  results: Record<string, unknown>;
  failedNodes: string[];
  skippedNodes: string[];
}

// ── Gateway-based Workflow Message Service ──

export interface IGatewayWorkflowMessageService {
  recordStart(workflow: WorkflowDefinition, executionId: string): void;
  recordStatus(workflow: WorkflowDefinition, executionId: string, nodes: NodeStatus[]): void;
  recordResult(workflow: WorkflowDefinition, summary: ExecutionSummary): void;
  recordError(workflow: WorkflowDefinition, summary: ExecutionSummary, errorMessage?: string): void;
}

/**
 * Gateway-based implementation that sends workflow lifecycle messages
 * to gateway sessions via GatewayClient.injectMessage().
 *
 * - Child session (executionSessionKey) receives all progress updates.
 * - Main session (mainSessionKey) receives only the final result or error.
 */
export class GatewayWorkflowMessageServiceImpl implements IGatewayWorkflowMessageService {
  constructor(
    private mainSessionKey: string,
    private executionSessionKey: string,
  ) {}

  recordStart(workflow: WorkflowDefinition, executionId: string): void {
    gatewayClient.injectMessage(
      this.executionSessionKey,
      `🎬 工作流「${workflow.name}」已启动，执行ID: ${executionId}`,
      "dag-start",
    );
  }

  recordStatus(workflow: WorkflowDefinition, executionId: string, nodes: NodeStatus[]): void {
    const done = nodes.filter((n) => n.status === "completed").length;
    const total = nodes.length;
    gatewayClient.injectMessage(
      this.executionSessionKey,
      `⏳ ${nodes.map((n) => `${n.agent} → ${n.status}`).join(", ")} (${done}/${total})`,
      "dag-progress",
    );
  }

  recordResult(workflow: WorkflowDefinition, summary: ExecutionSummary): void {
    const content = this.aggregateResults(workflow, summary);

    // Sub-session: completion notification
    gatewayClient.injectMessage(
      this.executionSessionKey,
      "✅ 工作流完成，聚合报告如上",
      "dag-complete",
    );

    // Main session: aggregated report
    gatewayClient.injectMessage(
      this.mainSessionKey,
      content,
      "dag-complete",
    );
  }

  recordError(workflow: WorkflowDefinition, summary: ExecutionSummary, errorMessage?: string): void {
    const errorText = errorMessage ?? "Workflow 执行失败";

    // Sub-session: error notification
    gatewayClient.injectMessage(
      this.executionSessionKey,
      `❌ ${errorText}`,
      "dag-error",
    );

    // Main session: error notification
    gatewayClient.injectMessage(
      this.mainSessionKey,
      `⚠️ 工作流执行失败：${errorText}`,
      "dag-error",
    );
  }

  private aggregateResults(workflow: WorkflowDefinition, summary: ExecutionSummary): string {
    const lines: string[] = [];
    lines.push(`# Workflow 执行结果 — ${workflow.name}`);
    lines.push("");

    const nodes = workflow.nodes ?? [];
    for (const node of nodes) {
      if (node.type === "input" || node.type === "output") {
        continue;
      }
      const result = summary.results[node.id] as
        | { status?: string; output?: unknown; agent?: string }
        | undefined;
      const nodeName = node.label || node.agent || node.id;
      if (result) {
        if (result.status === "failed") {
          lines.push(`## ${nodeName}`);
          lines.push("");
          lines.push("> ⚠️ 节点执行失败");
        } else {
          lines.push(`## ${nodeName}`);
          lines.push("");
          if (result.output) {
            const output = typeof result.output === "string" ? result.output : JSON.stringify(result.output, null, 2);
            lines.push(output);
          }
        }
      } else {
        lines.push(`## ${nodeName}`);
        lines.push("");
        lines.push("> ⚠️ 节点执行失败");
      }
      lines.push("");
      lines.push("---");
      lines.push("");
    }

    lines.push(`*执行 ID: ${summary.executionId} | 状态: ${summary.status}*`);
    lines.push("");

    return lines.join("\n");
  }
}
