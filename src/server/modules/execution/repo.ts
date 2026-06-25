import { eq, and } from "drizzle-orm";
import { db, wrapDbCall } from "../../infra/db.js";
import type { DrizzleDatabase as Database } from "../../infra/db.js";
import { workflowExecutions, executionNodes } from "../../infra/schema.js";
import type { ExecutionStatus } from "../execution/domain.js";

// Drizzle JSON 鍒楃被鍨嬫爣璁?鈥?SQLite JSON 鍒楀湪 Drizzle 涓渶瑕佺被鍨嬫柇瑷€
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbJson = any;

export interface CreateExecutionParams {
  workflowId: string;
  params: Record<string, unknown>;
  traceId: string;
}

export interface IExecutionRepo {
  createExecution(params: CreateExecutionParams): string;
  createExecutionNodes(
    executionId: string,
    nodes: Array<{ id: string; agent: string; input: Record<string, unknown> }>
  ): void;
  recordNodeStarted(executionId: string, nodeId: string): void;
  recordNodeCompleted(
    executionId: string,
    nodeId: string,
    output: Record<string, unknown>,
    sessionId?: string
  ): void;
  recordNodeFailed(executionId: string, nodeId: string, error: string): void;
  recordNodeSkipped(executionId: string, nodeId: string): void;
  markExecution(executionId: string, status: ExecutionStatus): void;
  getExecutionNodes(executionId: string): Array<{
    id: string;
    nodeId: string;
    status: ExecutionStatus;
    input: any;
  }>;
}

/** Repository for execution persistence. */
export class ExecutionRepo implements IExecutionRepo {
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
          params: params as DbJson,
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
            input: node.input as DbJson,
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
      if (!row || row.status === "running") return;
      const result = this.db.update(executionNodes)
        .set({ status: "running" as ExecutionStatus, startedAt: new Date() })
        .where(and(
          eq(executionNodes.executionId, executionId),
          eq(executionNodes.nodeId, nodeId),
          eq(executionNodes.status, row.status as ExecutionStatus)
        ))
        .run();
      if (result.changes === 0) {
        throw new Error(`Concurrent modification detected: node ${nodeId} status changed since read`);
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
      if (!row || row.status === "completed") return;
      const result = this.db.update(executionNodes)
        .set({
          status: "completed" as ExecutionStatus,
          output: output as DbJson,
          sessionId: sessionId ?? null,
          completedAt: new Date(),
        })
        .where(and(
          eq(executionNodes.executionId, executionId),
          eq(executionNodes.nodeId, nodeId),
          eq(executionNodes.status, row.status as ExecutionStatus)
        ))
        .run();
      if (result.changes === 0) {
        throw new Error(`Concurrent modification detected: node ${nodeId} status changed since read`);
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
      if (!row || row.status === "failed") return;
      const result = this.db.update(executionNodes)
        .set({
          status: "failed" as ExecutionStatus,
          error,
          completedAt: new Date(),
        })
        .where(and(
          eq(executionNodes.executionId, executionId),
          eq(executionNodes.nodeId, nodeId),
          eq(executionNodes.status, row.status as ExecutionStatus)
        ))
        .run();
      if (result.changes === 0) {
        throw new Error(`Concurrent modification detected: node ${nodeId} status changed since read`);
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
      if (!row || row.status === "skipped") return;
      const result = this.db.update(executionNodes)
        .set({ status: "skipped" as ExecutionStatus, completedAt: new Date() })
        .where(and(
          eq(executionNodes.executionId, executionId),
          eq(executionNodes.nodeId, nodeId),
          eq(executionNodes.status, row.status as ExecutionStatus)
        ))
        .run();
      if (result.changes === 0) {
        throw new Error(`Concurrent modification detected: node ${nodeId} status changed since read`);
      }
    });
  }

  markExecution(executionId: string, status: ExecutionStatus): void {
    wrapDbCall("mark execution", () => {
      const row = this.db.select().from(workflowExecutions).where(eq(workflowExecutions.id, executionId)).get();
      if (!row || row.status === status) return;
      const update: DbJson = { status };
      if (status === "completed" || status === "failed" || status === "cleaned_up") {
        update.completedAt = new Date();
      }
      const result = this.db.update(workflowExecutions)
        .set(update)
        .where(and(
          eq(workflowExecutions.id, executionId),
          eq(workflowExecutions.status, row.status as ExecutionStatus)
        ))
        .run();
      if (result.changes === 0) {
        throw new Error(`Concurrent modification detected: execution ${executionId} status changed since read`);
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

/**
 * Factory function for creating an ExecutionRepo with a custom database instance.
 * Used by integration tests to inject an in-memory SQLite database.
 */
export function createExecutionRepo(db: Database): ExecutionRepo {
  return new ExecutionRepo(db);
}
