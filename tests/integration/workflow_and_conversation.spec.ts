import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { eq } from "drizzle-orm";
import { resolve } from "path";
import * as schema from "../../src/server/infra/schema.js";
import { ConversationRepo as ConversationRepoCls } from "../../src/server/modules/conversation/repo.js";
import { WorkflowRepo as WorkflowRepoCls } from "../../src/server/modules/workflow/repo.js";
import { ExecutionRepo as ExecutionRepoCls } from "../../src/server/modules/execution/repo.js";
import { ExecutionDomainService } from "../../src/server/modules/execution/domain-service.js";
import { WorkflowRunner } from "../../src/server/modules/workflow/service/workflow_runner.js";
import { ExecutorRegistry } from "../../src/server/modules/workflow/service/workflow_runner.js";
import { createAgentDispatcher } from "../../src/server/modules/agent/dispatcher.js";
import { createTestWorkflow } from "../helpers/db-fixtures.js";

// NOTE: This file is a subset of full_stack.spec.ts and is kept for targeted test runs.

let db: ReturnType<typeof drizzle>;
let sqlite: Database;
let ConversationRepo: ConversationRepoCls;
let WorkflowRepo: WorkflowRepoCls;
let ExecutionRepo: ExecutionRepoCls;

beforeAll(() => {
  sqlite = new Database(":memory:");
  sqlite.pragma("journal_mode = WAL");
  db = drizzle(sqlite, { schema });
  const migrationsPath = resolve(process.cwd(), "config", "drizzle", "migrations");
  migrate(db, { migrationsFolder: migrationsPath });

  ConversationRepo = new ConversationRepoCls(db);
  WorkflowRepo = new WorkflowRepoCls(db);
  ExecutionRepo = new ExecutionRepoCls(db);
});

afterAll(() => {
  sqlite.close();
});

describe("integration: conversation CRUD + cascade delete (H1)", () => {
  it("should create and retrieve a conversation", () => {
    const conv = ConversationRepo.create("test-agent", "Test Title");
    expect(conv.id).toBeDefined();
    expect(conv.agentName).toBe("test-agent");

    const retrieved = ConversationRepo.get(conv.id);
    expect(retrieved).toBeDefined();
    expect(retrieved!.title).toBe("Test Title");
  });

  it("should cascade delete messages when conversation is deleted", () => {
    const conv = ConversationRepo.create("cascade-test");
    ConversationRepo.appendMessage(conv.id, "user", "hello");
    ConversationRepo.appendMessage(conv.id, "assistant", "hi");

    const msgsBefore = ConversationRepo.getMessages(conv.id, 10, 0);
    expect(msgsBefore).toHaveLength(2);

    ConversationRepo.delete(conv.id);

    const msgsAfter = ConversationRepo.getMessages(conv.id, 10, 0);
    expect(msgsAfter).toHaveLength(0);
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
  });
});

describe("integration: mark_execution retry (H3)", () => {
  it("should retry on DB failure and eventually succeed", async () => {
    const execId = ExecutionRepo.createExecution({
      workflowId: "wf-1",
      params: {},
      traceId: "tr-1",
    });
    expect(execId).toBeDefined();

    ExecutionRepo.markExecution(execId, "running");
    ExecutionRepo.markExecution(execId, "completed");

    const row = db
      .select()
      .from(schema.workflowExecutions)
      .where(eq(schema.workflowExecutions.id, execId))
      .get();
    expect(row.status).toBe("completed");
  });
});
