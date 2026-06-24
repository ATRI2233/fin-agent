import { eq, desc } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { db } from "../../infra/db.js";
import { workflows } from "../../infra/schema.js";
import { DatabaseError } from "../../infra/errors.js";
import type { Workflow } from "./domain/dag.js";

/** Factory: returns a WorkflowRepo bound to a specific db instance. */
export function createWorkflowRepo(db: BetterSQLite3Database) {
  return {
    get(id: string): Workflow | undefined {
      try {
        const row = db.select().from(workflows).where(eq(workflows.id, id)).get();
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
      } catch (e) {
        throw new DatabaseError("Failed to get workflow", { cause: String(e) });
      }
    },

    list(limit: number, offset: number): Workflow[] {
      try {
        const rows = db
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
      } catch (e) {
        throw new DatabaseError("Failed to list workflows", { cause: String(e) });
      }
    },
  };
}

/** Default instance bound to the global production db. */
export const WorkflowRepo = createWorkflowRepo(db);
