import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { eq } from "drizzle-orm";
import { resolve } from "path";
import * as schema from "../../src/server/infra/schema.js";
import { WorkflowRepo as WorkflowRepoCls } from "../../src/server/modules/workflow/repo.js";
import { ExecutionRepo as ExecutionRepoCls } from "../../src/server/modules/execution/repo.js";
import { ExecutionDomainService } from "../../src/server/modules/execution/domain-service.js";
import { WorkflowRunner } from "../../src/server/modules/workflow/service/workflow_runner.js";
import { ExecutorRegistry } from "../../src/server/modules/workflow/service/workflow_runner.js";
import { createAgentDispatcher } from "../../src/server/modules/agent/dispatcher.js";
import { createTestWorkflow } from "../helpers/db-fixtures.js";

let db: ReturnType<typeof drizzle>;
let sqlite: Database;
let WorkflowRepo: WorkflowRepoCls;
let ExecutionRepo: ExecutionRepoCls;

beforeAll(() => {
  sqlite = new Database(":memory:");
  sqlite.pragma("journal_mode = WAL");
  db = drizzle(sqlite, { schema });
  const migrationsPath = resolve(process.cwd(), "config", "drizzle", "migrations");
  migrate(db, { migrationsFolder: migrationsPath });

  WorkflowRepo = new WorkflowRepoCls(db);
  ExecutionRepo = new ExecutionRepoCls(db);
});

afterAll(() => {
  sqlite.close();
});


describe("integration: execution state machine", () => {
  it("should create execution and mark status transitions", () => {
    const execId = ExecutionRepo.createExecution({
      workflowId: "wf-test",
      params: { symbol: "AAPL" },
      traceId: "tr-1",
    });
    expect(execId).toBeDefined();

    let row = db
      .select()
      .from(schema.workflowExecutions)
      .where(eq(schema.workflowExecutions.id, execId))
      .get();
    expect(row.status).toBe("pending");

    ExecutionRepo.markExecution(execId, "running");
    row = db
      .select()
      .from(schema.workflowExecutions)
      .where(eq(schema.workflowExecutions.id, execId))
      .get();
    expect(row.status).toBe("running");

    ExecutionRepo.markExecution(execId, "completed");
    row = db
      .select()
      .from(schema.workflowExecutions)
      .where(eq(schema.workflowExecutions.id, execId))
      .get();
    expect(row.status).toBe("completed");
    expect(row.completedAt).toBeDefined();
  });

  it("should allow any status transition (no validation in repo)", () => {
    const execId = ExecutionRepo.createExecution({
      workflowId: "wf-test",
      params: {},
      traceId: "tr-1",
    });
    ExecutionRepo.markExecution(execId, "running");
    ExecutionRepo.markExecution(execId, "completed");

    // markExecution does not validate state transitions;
    // it uses optimistic concurrency and will always apply the requested status.
    ExecutionRepo.markExecution(execId, "running");

    const row = db
      .select()
      .from(schema.workflowExecutions)
      .where(eq(schema.workflowExecutions.id, execId))
      .get();
    expect(row.status).toBe("running");
  });

  it("should record node lifecycle", () => {
    const execId = ExecutionRepo.createExecution({
      workflowId: "wf-test",
      params: {},
      traceId: "tr-1",
    });

    ExecutionRepo.createExecutionNodes(execId, [
      { id: "node-1", agent: "test", input: {} },
    ]);

    let nodes = ExecutionRepo.getExecutionNodes(execId);
    expect(nodes).toHaveLength(1);
    expect(nodes[0].status).toBe("pending");

    ExecutionRepo.recordNodeStarted(execId, "node-1");
    nodes = ExecutionRepo.getExecutionNodes(execId);
    expect(nodes[0].status).toBe("running");

    ExecutionRepo.recordNodeCompleted(execId, "node-1", { result: "ok" });
    nodes = ExecutionRepo.getExecutionNodes(execId);
    expect(nodes[0].status).toBe("completed");
  });
});

describe("integration: workflow trigger end-to-end", () => {
  it("should trigger a simple workflow and complete all nodes", async () => {
    const { id: workflowId } = createTestWorkflow(db, {
      name: "test-workflow",
      nodes: [
        { id: "input-1", type: "input", data: {} },
        { id: "output-1", type: "output", data: {} },
      ],
      edges: [{ source: "input-1", target: "output-1" }],
      triggerType: "manual",
      config: {},
      status: "active",
    });

    const dispatcher = createAgentDispatcher();
    const executionDomainService = new ExecutionDomainService(ExecutionRepo);
    const runner = new WorkflowRunner(
      WorkflowRepo,
      ExecutionRepo,
      executionDomainService,
      new ExecutorRegistry(dispatcher)
    );

    const result = await runner.run(workflowId, { symbol: "AAPL" }, "tr-test-1");

    expect(result.status).toBe("completed");
    expect(result.executionId).toBeDefined();
    expect(result.failedNodes).toHaveLength(0);
    expect(Object.keys(result.results)).toContain("input-1");
    expect(Object.keys(result.results)).toContain("output-1");
  });

  it("should handle a failed node and skip downstream", async () => {
    const { id: workflowId } = createTestWorkflow(db, {
      name: "fail-workflow",
      nodes: [
        { id: "input-1", type: "input", data: {} },
        { id: "agent-1", type: "agent", data: {}, agent: "nonexistent" },
        { id: "output-1", type: "output", data: {} },
      ],
      edges: [
        { source: "input-1", target: "agent-1" },
        { source: "agent-1", target: "output-1" },
      ],
      triggerType: "manual",
      config: {},
      status: "active",
    });

    const dispatcher = createAgentDispatcher();
    const executionDomainService = new ExecutionDomainService(ExecutionRepo);
    const runner = new WorkflowRunner(
      WorkflowRepo,
      ExecutionRepo,
      executionDomainService,
      new ExecutorRegistry(dispatcher)
    );

    const result = await runner.run(workflowId, { symbol: "AAPL" }, "tr-test-2");

    expect(result.status).toBe("failed");
    expect(result.failedNodes).toContain("agent-1");
    expect(result.skippedNodes).toContain("output-1");
  });
});
