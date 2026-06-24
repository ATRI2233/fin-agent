import { eq, and } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { db } from "../../infra/db.js";
import { workflowExecutions, executionNodes } from "../../infra/schema.js";
import { DatabaseError } from "../../infra/errors.js";
import { transition, type ExecutionStatus } from "../execution/domain.js";

export interface CreateExecutionParams {
  workflowId: string;
  params: Record<string, unknown>;
  traceId: string;
}

export interface NodeOutput {
  output?: Record<string, unknown>;
  sessionId?: string;
}

/** Factory: returns an ExecutionRepo bound to a specific db instance. */
export function createExecutionRepo(db: BetterSQLite3Database) {
  return {
    createExecution({ workflowId, params, traceId }: CreateExecutionParams): string {
      const id = crypto.randomUUID();
      const now = new Date();
      try {
        db.insert(workflowExecutions)
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
      } catch (e) {
        throw new DatabaseError("Failed to create execution", { cause: String(e) });
      }
    },

    createExecutionNodes(
      executionId: string,
      nodes: Array<{ id: string; agent: string; input: Record<string, unknown> }>
    ): void {
      try {
        for (const node of nodes) {
          db.insert(executionNodes)
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
      } catch (e) {
        throw new DatabaseError("Failed to create execution nodes", { cause: String(e) });
      }
    },

    recordNodeStarted(executionId: string, nodeId: string): void {
      try {
        const row = db
          .select()
          .from(executionNodes)
          .where(and(eq(executionNodes.executionId, executionId), eq(executionNodes.nodeId, nodeId)))
          .get();
        if (row && row.status !== "running") {
          transition(row.status as ExecutionStatus, "running");
          db.update(executionNodes)
            .set({ status: "running" as ExecutionStatus, startedAt: new Date() })
            .where(and(eq(executionNodes.executionId, executionId), eq(executionNodes.nodeId, nodeId)))
            .run();
        }
      } catch (e) {
        throw new DatabaseError("Failed to record node started", { cause: String(e) });
      }
    },

    recordNodeCompleted(
      executionId: string,
      nodeId: string,
      output: Record<string, unknown>,
      sessionId?: string
    ): void {
      try {
        const row = db
          .select()
          .from(executionNodes)
          .where(and(eq(executionNodes.executionId, executionId), eq(executionNodes.nodeId, nodeId)))
          .get();
        if (row && row.status !== "completed") {
          transition(row.status as ExecutionStatus, "completed");
          db.update(executionNodes)
            .set({
              status: "completed" as ExecutionStatus,
              output: output as any,
              sessionId: sessionId ?? null,
              completedAt: new Date(),
            })
            .where(and(eq(executionNodes.executionId, executionId), eq(executionNodes.nodeId, nodeId)))
            .run();
        }
      } catch (e) {
        throw new DatabaseError("Failed to record node completed", { cause: String(e) });
      }
    },

    recordNodeFailed(executionId: string, nodeId: string, error: string): void {
      try {
        const row = db
          .select()
          .from(executionNodes)
          .where(and(eq(executionNodes.executionId, executionId), eq(executionNodes.nodeId, nodeId)))
          .get();
        if (row && row.status !== "failed") {
          transition(row.status as ExecutionStatus, "failed");
          db.update(executionNodes)
            .set({
              status: "failed" as ExecutionStatus,
              error,
              completedAt: new Date(),
            })
            .where(and(eq(executionNodes.executionId, executionId), eq(executionNodes.nodeId, nodeId)))
            .run();
        }
      } catch (e) {
        throw new DatabaseError("Failed to record node failed", { cause: String(e) });
      }
    },

    recordNodeSkipped(executionId: string, nodeId: string): void {
      try {
        const row = db
          .select()
          .from(executionNodes)
          .where(and(eq(executionNodes.executionId, executionId), eq(executionNodes.nodeId, nodeId)))
          .get();
        if (row && row.status !== "skipped") {
          transition(row.status as ExecutionStatus, "skipped");
          db.update(executionNodes)
            .set({ status: "skipped" as ExecutionStatus, completedAt: new Date() })
            .where(and(eq(executionNodes.executionId, executionId), eq(executionNodes.nodeId, nodeId)))
            .run();
        }
      } catch (e) {
        throw new DatabaseError("Failed to record node skipped", { cause: String(e) });
      }
    },

    markExecution(executionId: string, status: ExecutionStatus): void {
      try {
        const row = db.select().from(workflowExecutions).where(eq(workflowExecutions.id, executionId)).get();
        if (row && row.status !== status) {
          transition(row.status as ExecutionStatus, status);
          const update: any = { status };
          if (status === "completed" || status === "failed" || status === "cleaned_up") {
            update.completedAt = new Date();
          }
          db.update(workflowExecutions).set(update).where(eq(workflowExecutions.id, executionId)).run();
        }
      } catch (e) {
        throw new DatabaseError("Failed to mark execution", { cause: String(e) });
      }
    },

    getExecutionNodes(executionId: string): Array<{
      id: string;
      nodeId: string;
      status: ExecutionStatus;
      input: any;
    }> {
      try {
        return db
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
      } catch (e) {
        throw new DatabaseError("Failed to get execution nodes", { cause: String(e) });
      }
    },

    markDownstreamSkipped(executionId: string, failedNodeId: string): string[] {
      try {
        const pendingRows = db
          .select()
          .from(executionNodes)
          .where(
            and(
              eq(executionNodes.executionId, executionId),
              eq(executionNodes.status, "pending")
            )
          )
          .all();

        const skippedIds: string[] = [];
        const processed = new Set<string>();
        const queue = [failedNodeId];

        while (queue.length > 0) {
          const current = queue.shift()!;
          if (processed.has(current)) continue;
          processed.add(current);

          for (const row of pendingRows) {
            const nid = row.nodeId;
            if (processed.has(nid)) continue;
            if (nid === failedNodeId) continue;
            if (_inputReferences(row.input, current)) {
              transition(row.status as ExecutionStatus, "skipped");
              db.update(executionNodes)
                .set({ status: "skipped" as ExecutionStatus, completedAt: new Date() })
                .where(eq(executionNodes.id, row.id))
                .run();
              skippedIds.push(nid);
              queue.push(nid);
              processed.add(nid);
            }
          }
        }

        skippedIds.sort();
        return skippedIds;
      } catch (e) {
        throw new DatabaseError("Failed to mark downstream skipped", { cause: String(e) });
      }
    },
  };
}

/** Default instance bound to the global production db. */
export const ExecutionRepo = createExecutionRepo(db);

function _inputReferences(input: any, nodeId: string): boolean {
  if (input == null) return false;
  if (typeof input === "string") return input === nodeId;
  if (typeof input === "object") {
    if (Array.isArray(input)) return input.some((v) => _inputReferences(v, nodeId));
    for (const [k, v] of Object.entries(input)) {
      if (k === nodeId || _inputReferences(v, nodeId)) return true;
    }
  }
  return false;
}
