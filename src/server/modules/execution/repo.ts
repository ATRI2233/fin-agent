import { eq, and } from "drizzle-orm";
import { db, wrapDbCall } from "../../infra/db.js";
import type { Database } from "../../infra/db.js";
import { workflowExecutions, executionNodes } from "../../infra/schema.js";
import { transition, type ExecutionStatus } from "../execution/domain.js";

export interface CreateExecutionParams {
  workflowId: string;
  params: Record<string, unknown>;
  traceId: string;
}

/** Repository for execution persistence. */
export class ExecutionRepo {
  constructor(private db: Database) {}

  createExecution({ workflowId, params, traceId }: CreateExecutionParams): string {
    const id = crypto.randomUUID();
    const now = new Date();
    return wrapDbCall("create execution", () => {
      this.db.insert(workflowExecutions)
        .values({
          id,
          workflowId,
          status: "pending" as ExecutionStatus,
          params: params as any,
          traceId,
          createdAt: now,
          startedAt: null,
          completedAt: null,
        })
        .run();
      return id;
    });
  }

  createExecutionNodes(
    executionId: string,
    nodes: Array<{ id: string; agent: string; input: Record<string, unknown> }>
  ): void {
    wrapDbCall("create execution nodes", () => {
      for (const node of nodes) {
        this.db.insert(executionNodes)
          .values({
            id: crypto.randomUUID(),
            executionId,
            nodeId: node.id,
            agent: node.agent,
            status: "pending" as ExecutionStatus,
            input: node.input as any,
            output: null,
            sessionId: null,
            error: null,
            startedAt: null,
            completedAt: null,
            retryCount: 0,
          })
          .run();
      }
    });
  }

  recordNodeStarted(executionId: string, nodeId: string): void {
    wrapDbCall("record node started", () => {
      const row = this.db
        .select()
        .from(executionNodes)
        .where(and(eq(executionNodes.executionId, executionId), eq(executionNodes.nodeId, nodeId)))
        .get();
      if (row && row.status !== "running") {
        transition(row.status as ExecutionStatus, "running");
        this.db.update(executionNodes)
          .set({ status: "running" as ExecutionStatus, startedAt: new Date() })
          .where(and(eq(executionNodes.executionId, executionId), eq(executionNodes.nodeId, nodeId)))
          .run();
      }
    });
  }

  recordNodeCompleted(
    executionId: string,
    nodeId: string,
    output: Record<string, unknown>,
    sessionId?: string
  ): void {
    wrapDbCall("record node completed", () => {
      const row = this.db
        .select()
        .from(executionNodes)
        .where(and(eq(executionNodes.executionId, executionId), eq(executionNodes.nodeId, nodeId)))
        .get();
      if (row && row.status !== "completed") {
        transition(row.status as ExecutionStatus, "completed");
        this.db.update(executionNodes)
          .set({
            status: "completed" as ExecutionStatus,
            output: output as any,
            sessionId: sessionId ?? null,
            completedAt: new Date(),
          })
          .where(and(eq(executionNodes.executionId, executionId), eq(executionNodes.nodeId, nodeId)))
          .run();
      }
    });
  }

  recordNodeFailed(executionId: string, nodeId: string, error: string): void {
    wrapDbCall("record node failed", () => {
      const row = this.db
        .select()
        .from(executionNodes)
        .where(and(eq(executionNodes.executionId, executionId), eq(executionNodes.nodeId, nodeId)))
        .get();
      if (row && row.status !== "failed") {
        transition(row.status as ExecutionStatus, "failed");
        this.db.update(executionNodes)
          .set({
            status: "failed" as ExecutionStatus,
            error,
            completedAt: new Date(),
          })
          .where(and(eq(executionNodes.executionId, executionId), eq(executionNodes.nodeId, nodeId)))
          .run();
      }
    });
  }

  recordNodeSkipped(executionId: string, nodeId: string): void {
    wrapDbCall("record node skipped", () => {
      const row = this.db
        .select()
        .from(executionNodes)
        .where(and(eq(executionNodes.executionId, executionId), eq(executionNodes.nodeId, nodeId)))
        .get();
      if (row && row.status !== "skipped") {
        transition(row.status as ExecutionStatus, "skipped");
        this.db.update(executionNodes)
          .set({ status: "skipped" as ExecutionStatus, completedAt: new Date() })
          .where(and(eq(executionNodes.executionId, executionId), eq(executionNodes.nodeId, nodeId)))
          .run();
      }
    });
  }

  markExecution(executionId: string, status: ExecutionStatus): void {
    wrapDbCall("mark execution", () => {
      const row = this.db.select().from(workflowExecutions).where(eq(workflowExecutions.id, executionId)).get();
      if (row && row.status !== status) {
        transition(row.status as ExecutionStatus, status);
        const update: any = { status };
        if (status === "completed" || status === "failed" || status === "cleaned_up") {
          update.completedAt = new Date();
        }
        this.db.update(workflowExecutions).set(update).where(eq(workflowExecutions.id, executionId)).run();
      }
    });
  }

  getExecutionNodes(executionId: string): Array<{
    id: string;
    nodeId: string;
    status: ExecutionStatus;
    input: any;
  }> {
    return wrapDbCall("get execution nodes", () => {
      return this.db
        .select()
        .from(executionNodes)
        .where(eq(executionNodes.executionId, executionId))
        .all()
        .map((r) => ({
          id: r.id,
          nodeId: r.nodeId,
          status: r.status as ExecutionStatus,
          input: r.input,
        }));
    });
  }
}

/** Default instance bound to the global production db. */
export const executionRepo = new ExecutionRepo(db);
