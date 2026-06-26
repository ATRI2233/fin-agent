/** ExecutionObserver — bridges WorkflowRunner lifecycle events to WorkflowMessageService. */

import type { IGatewayWorkflowMessageService, WorkflowDefinition, NodeStatus, ExecutionSummary } from "../../conversation/workflow_message_service.js";

export interface IExecutionObserver {
  onExecutionStart(workflow: WorkflowDefinition, executionId: string, conversationId: string): void;
  onNodeStatusChange(workflow: WorkflowDefinition, executionId: string, conversationId: string, nodes: NodeStatus[]): void;
  onExecutionComplete(workflow: WorkflowDefinition, executionId: string, conversationId: string, summary: ExecutionSummary): void;
  onExecutionError(workflow: WorkflowDefinition, executionId: string, conversationId: string, summary: ExecutionSummary, error?: string): void;
}

/**
 * Session-aware execution observer that bridges workflow lifecycle events
 * to the Gateway-based message service.
 *
 * This observer captures main and child session keys at construction time
 * and ignores the `conversationId` parameter from the runner (it is unused).
 */
export class SessionAwareExecutionObserver implements IExecutionObserver {
  constructor(private gatewayMsgSvc: IGatewayWorkflowMessageService) {}

  onExecutionStart(workflow: WorkflowDefinition, executionId: string, _conversationId: string): void {
    this.gatewayMsgSvc.recordStart(workflow, executionId);
  }

  onNodeStatusChange(workflow: WorkflowDefinition, executionId: string, _conversationId: string, nodes: NodeStatus[]): void {
    this.gatewayMsgSvc.recordStatus(workflow, executionId, nodes);
  }

  onExecutionComplete(workflow: WorkflowDefinition, executionId: string, _conversationId: string, summary: ExecutionSummary): void {
    this.gatewayMsgSvc.recordResult(workflow, summary as any);
  }

  onExecutionError(workflow: WorkflowDefinition, executionId: string, _conversationId: string, summary: ExecutionSummary, error?: string): void {
    this.gatewayMsgSvc.recordError(workflow, summary as any, error);
  }
}
