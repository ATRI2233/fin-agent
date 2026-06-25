import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { resolve } from "path";
import * as schema from "../../../src/server/infra/schema.js";
import { WorkflowRepo } from "../../../src/server/modules/workflow/repo.js";
import type { Workflow } from "../../../src/server/modules/workflow/domain/dag.js";

let sqlite: Database.Database;
let db: ReturnType<typeof drizzle>;
let repo: WorkflowRepo;

beforeAll(() => {
  sqlite = new Database(":memory:");
  sqlite.pragma("journal_mode = WAL");
  db = drizzle(sqlite, { schema });
  const migrationsPath = resolve(process.cwd(), "config", "drizzle", "migrations");
  migrate(db, { migrationsFolder: migrationsPath });
  repo = new WorkflowRepo(db);
});

afterAll(() => {
  sqlite.close();
});

beforeEach(() => {
  db.delete(schema.workflows).run();
});

function insertWorkflow(overrides: Partial<typeof schema.workflows.$inferInsert> = {}) {
  const now = new Date();
  const defaults = {
    id: crypto.randomUUID(),
    name: "Default Workflow",
    nodes: [] as any,
    edges: [] as any,
    triggerType: "manual",
    config: {} as any,
    status: "draft",
    createdAt: now,
    updatedAt: now,
  };
  db.insert(schema.workflows).values({ ...defaults, ...overrides }).run();
}

describe("WorkflowRepo", () => {
  describe("get", () => {
    it("returns the workflow when it exists", () => {
      const id = crypto.randomUUID();
      const now = new Date();
      const nodes = [{ id: "n1", type: "input", data: { label: "Start" } }];
      const edges = [{ source: "n1", target: "n2" }];
      const config = { timeout: 60, retries: 3 };

      insertWorkflow({
        id,
        name: "My Flow",
        nodes: nodes as any,
        edges: edges as any,
        triggerType: "scheduled",
        config: config as any,
        status: "active",
        createdAt: now,
        updatedAt: now,
      });

      const result = repo.get(id);
      expect(result).toBeDefined();
      expect(result!.id).toBe(id);
      expect(result!.name).toBe("My Flow");
      expect(result!.nodes).toEqual(nodes);
      expect(result!.edges).toEqual(edges);
      expect(result!.triggerType).toBe("scheduled");
      expect(result!.config).toEqual(config);
      expect(result!.status).toBe("active");
    });

    it("returns undefined for a non-existent workflow", () => {
      const result = repo.get("non-existent-id");
      expect(result).toBeUndefined();
    });
  });

  describe("list", () => {
    it("returns all workflows ordered by updatedAt DESC", () => {
      const base = Date.now();
      insertWorkflow({ id: "wf-a", name: "A", updatedAt: new Date(base + 3000) });
      insertWorkflow({ id: "wf-b", name: "B", updatedAt: new Date(base + 1000) });
      insertWorkflow({ id: "wf-c", name: "C", updatedAt: new Date(base + 2000) });

      const result = repo.list(10, 0);
      expect(result).toHaveLength(3);
      expect(result[0].id).toBe("wf-a");
      expect(result[1].id).toBe("wf-c");
      expect(result[2].id).toBe("wf-b");
    });

    it("returns an empty array when no workflows exist", () => {
      const result = repo.list(10, 0);
      expect(result).toEqual([]);
    });

    it("respects the limit parameter", () => {
      for (let i = 0; i < 5; i++) {
        const now = new Date(Date.now() + i * 1000);
        insertWorkflow({ id: `wf-limit-${i}`, updatedAt: now });
      }

      const result = repo.list(2, 0);
      expect(result).toHaveLength(2);
    });

    it("respects the offset parameter", () => {
      for (let i = 0; i < 5; i++) {
        const now = new Date(Date.now() + i * 1000);
        insertWorkflow({ id: `wf-offset-${i}`, updatedAt: now });
      }

      // Skip the newest 2, expect 3 remaining
      const result = repo.list(10, 2);
      expect(result).toHaveLength(3);
      expect(result[0].id).toBe("wf-offset-2");
      expect(result[1].id).toBe("wf-offset-1");
      expect(result[2].id).toBe("wf-offset-0");
    });

    it("combines limit and offset correctly", () => {
      for (let i = 0; i < 10; i++) {
        const now = new Date(Date.now() + i * 1000);
        insertWorkflow({ id: `wf-page-${i}`, updatedAt: now });
      }

      // Page 2: skip 3, take 3
      const result = repo.list(3, 3);
      expect(result).toHaveLength(3);
      expect(result[0].id).toBe("wf-page-6");
      expect(result[1].id).toBe("wf-page-5");
      expect(result[2].id).toBe("wf-page-4");
    });
  });

  describe("JSON field deserialization", () => {
    it("deserializes nodes and edges arrays correctly", () => {
      const id = crypto.randomUUID();
      const now = new Date();
      const nodes = [
        { id: "input-1", type: "input", data: { placeholder: "Enter text" } },
        { id: "process-1", type: "default", data: { command: "analyze" } },
        { id: "output-1", type: "output", data: {} },
      ];
      const edges = [
        { source: "input-1", target: "process-1" },
        { source: "process-1", target: "output-1" },
      ];

      insertWorkflow({
        id,
        nodes: nodes as any,
        edges: edges as any,
        createdAt: now,
        updatedAt: now,
      });

      const result = repo.get(id)!;
      expect(Array.isArray(result.nodes)).toBe(true);
      expect(result.nodes).toHaveLength(3);
      expect(result.nodes[0].id).toBe("input-1");
      expect(result.nodes[0].type).toBe("input");
      expect(result.edges).toHaveLength(2);
      expect(result.edges[1]).toEqual({ source: "process-1", target: "output-1" });
    });

    it("deserializes config object correctly", () => {
      const id = crypto.randomUUID();
      const now = new Date();
      const config = {
        schedule: "0 9 * * 1-5",
        maxRetries: 5,
        notifyOnFailure: true,
        tags: ["urgent", "production"],
      };

      insertWorkflow({
        id,
        config: config as any,
        createdAt: now,
        updatedAt: now,
      });

      const result = repo.get(id)!;
      expect(result.config).toEqual(config);
      expect(result.config.schedule).toBe("0 9 * * 1-5");
      expect(result.config.maxRetries).toBe(5);
      expect(result.config.notifyOnFailure).toBe(true);
      expect(result.config.tags).toEqual(["urgent", "production"]);
    });

    it("returns empty arrays and empty object for default JSON fields", () => {
      const id = crypto.randomUUID();
      const now = new Date();

      db.insert(schema.workflows).values({
        id,
        name: "Minimal",
        nodes: [] as any,
        edges: [] as any,
        triggerType: "manual",
        config: {} as any,
        status: "draft",
        createdAt: now,
        updatedAt: now,
      }).run();

      const result = repo.get(id)!;
      expect(result.nodes).toEqual([]);
      expect(result.edges).toEqual([]);
      expect(result.config).toEqual({});
    });
  });
});
