import { eq, desc } from "drizzle-orm";
import { db, wrapDbCall } from "../../infra/db.js";
import type { Database } from "../../infra/db.js";
import { workflows } from "../../infra/schema.js";
import type { Workflow } from "./domain/dag.js";

/** Repository for workflow persistence. */
export class WorkflowRepo {
  constructor(private db: Database) {}

  get(id: string): Workflow | undefined {
    return wrapDbCall("get workflow", () => {
      const row = this.db.select().from(workflows).where(eq(workflows.id, id)).get();
      if (!row) return undefined;
      return {
        id: row.id,
        name: row.name,
        nodes: row.nodes as unknown as Workflow["nodes"],
        edges: row.edges as unknown as Workflow["edges"],
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
        nodes: r.nodes as unknown as Workflow["nodes"],
        edges: r.edges as unknown as Workflow["edges"],
        triggerType: r.triggerType,
        config: r.config as Record<string, unknown>,
        status: r.status,
      }));
    });
  }
}

/** Default instance bound to the global production db. */
export const workflowRepo = new WorkflowRepo(db);
