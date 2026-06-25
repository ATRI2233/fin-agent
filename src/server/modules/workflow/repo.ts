import { eq, desc } from "drizzle-orm";
import { db, wrapDbCall } from "../../infra/db.js";
import type { DrizzleDatabase as Database } from "../../infra/db.js";
import { workflows } from "../../infra/schema.js";
import type { Workflow, Node, Edge } from "./domain/dag.js";
import { WorkflowNotFoundError } from "../../infra/errors.js";

/** Runtime validation: is the parsed value a valid Node array? */
function validateNodes(value: unknown): value is Node[] {
  if (!Array.isArray(value)) return false;
  return value.every(
    (item) =>
      item !== null &&
      typeof item === "object" &&
      typeof (item as Record<string, unknown>).id === "string" &&
      typeof (item as Record<string, unknown>).type === "string"
  );
}

/** Runtime validation: is the parsed value a valid Edge array? */
function validateEdges(value: unknown): value is Edge[] {
  if (!Array.isArray(value)) return false;
  return value.every(
    (item) =>
      item !== null &&
      typeof item === "object" &&
      typeof (item as Record<string, unknown>).source === "string" &&
      typeof (item as Record<string, unknown>).target === "string"
  );
}

export interface IWorkflowRepo {
  get(id: string): Workflow | undefined;
  list(limit: number, offset: number): Workflow[];
  create(workflow: { id: string; name: string; nodes: unknown; edges: unknown; triggerType: string; config: unknown; status: string }): void;
  update(id: string, data: Partial<{ name: string; description: string; nodes: unknown; edges: unknown; triggerType: string; config: unknown }>): void;
  delete(id: string): void;
}

/** Repository for workflow persistence. */
export class WorkflowRepo implements IWorkflowRepo {
  constructor(private db: Database) {}

  get(id: string): Workflow | undefined {
    return wrapDbCall("get workflow", () => {
      const row = this.db.select().from(workflows).where(eq(workflows.id, id)).get();
      if (!row) return undefined;
      return {
        id: row.id,
        name: row.name,
        nodes: validateNodes(row.nodes) ? row.nodes : [],
        edges: validateEdges(row.edges) ? row.edges : [],
        triggerType: row.triggerType,
        config: row.config as Record<string, unknown>,
        status: row.status,
      };
    });
  }

  list(limit: number, offset: number): Workflow[] {
    return wrapDbCall("list workflows", () => {
      const rows = this.db
        .select()
        .from(workflows)
        .orderBy(desc(workflows.updatedAt))
        .limit(limit)
        .offset(offset)
        .all();
      return rows.map((r) => ({
        id: r.id,
        name: r.name,
        nodes: validateNodes(r.nodes) ? r.nodes : [],
        edges: validateEdges(r.edges) ? r.edges : [],
        triggerType: r.triggerType,
        config: r.config as Record<string, unknown>,
        status: r.status,
      }));
    });
  }

  create(workflow: { id: string; name: string; nodes: unknown; edges: unknown; triggerType: string; config: unknown; status: string }): void {
    wrapDbCall("create workflow", () => {
      const now = new Date();
      this.db.insert(workflows).values({
        id: workflow.id,
        name: workflow.name,
        description: null,
        nodes: workflow.nodes as any,
        edges: workflow.edges as any,
        triggerType: workflow.triggerType,
        config: workflow.config as any,
        status: workflow.status,
        createdAt: now,
        updatedAt: now,
      }).run();
    });
  }

  update(id: string, data: Partial<{ name: string; description: string; nodes: unknown; edges: unknown; triggerType: string; config: unknown }>): void {
    wrapDbCall("update workflow", () => {
      const existing = this.db.select().from(workflows).where(eq(workflows.id, id)).get();
      if (!existing) {
        throw new WorkflowNotFoundError(`Workflow ${id} not found`);
      }
      const updateData: Record<string, unknown> = { updatedAt: new Date() };
      if (data.name !== undefined) updateData.name = data.name;
      if (data.description !== undefined) updateData.description = data.description;
      if (data.nodes !== undefined) updateData.nodes = data.nodes;
      if (data.edges !== undefined) updateData.edges = data.edges;
      if (data.triggerType !== undefined) updateData.triggerType = data.triggerType;
      if (data.config !== undefined) updateData.config = data.config;
      this.db.update(workflows).set(updateData).where(eq(workflows.id, id)).run();
    });
  }

  delete(id: string): void {
    wrapDbCall("delete workflow", () => {
      const existing = this.db.select().from(workflows).where(eq(workflows.id, id)).get();
      if (!existing) {
        throw new WorkflowNotFoundError(`Workflow ${id} not found`);
      }
      this.db.delete(workflows).where(eq(workflows.id, id)).run();
    });
  }
}

/** Default instance bound to the global production db. */
export const workflowRepo = new WorkflowRepo(db);

/**
 * Factory function for creating a WorkflowRepo with a custom database instance.
 * Used by integration tests to inject an in-memory SQLite database.
 */
export function createWorkflowRepo(db: Database): WorkflowRepo {
  return new WorkflowRepo(db);
}
