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

  it("should list conversations with pagination", () => {
    const c1 = ConversationRepo.create("agent-1", "First");
    const c2 = ConversationRepo.create("agent-2", "Second");
    const c3 = ConversationRepo.create("agent-3", "Third");

    const all = ConversationRepo.list(10, 0);
    const ids = all.map((c) => c.id);
    expect(ids.length).toBeGreaterThanOrEqual(3);
    expect(ids).toContain(c1.id);
    expect(ids).toContain(c2.id);
    expect(ids).toContain(c3.id);
  });

  it("should append messages and update conversation updatedAt", () => {
    const conv = ConversationRepo.create("msg-test");
    const before = conv.updatedAt;

    const msg = ConversationRepo.appendMessage(conv.id, "user", "hello");
    expect(msg.role).toBe("user");
    expect(msg.content).toBe("hello");

    const after = ConversationRepo.get(conv.id)!;
    expect(after.updatedAt.getTime() / 1000).toBeGreaterThanOrEqual(
      Math.floor(before.getTime() / 1000)
    );
  });

  it("should retrieve messages in order", () => {
    const conv = ConversationRepo.create("order-test");
    ConversationRepo.appendMessage(conv.id, "user", "msg1");
    ConversationRepo.appendMessage(conv.id, "assistant", "msg2");
    ConversationRepo.appendMessage(conv.id, "user", "msg3");

    const msgs = ConversationRepo.getMessages(conv.id, 10, 0);
    expect(msgs).toHaveLength(3);
    expect(msgs[0].content).toBe("msg1");
    expect(msgs[1].content).toBe("msg2");
    expect(msgs[2].content).toBe("msg3");
  });

  it("should cascade delete messages when conversation is deleted (H1 fix)", () => {
    const conv = ConversationRepo.create("cascade-test");
    ConversationRepo.appendMessage(conv.id, "user", "hello");
    ConversationRepo.appendMessage(conv.id, "assistant", "hi");

    const msgsBefore = ConversationRepo.getMessages(conv.id, 10, 0);
    expect(msgsBefore).toHaveLength(2);

    ConversationRepo.delete(conv.id);

    const msgsAfter = ConversationRepo.getMessages(conv.id, 10, 0);
    expect(msgsAfter).toHaveLength(0);

    const convAfter = ConversationRepo.get(conv.id);
    expect(convAfter).toBeUndefined();
  });

  it("should paginate messages", () => {
    const conv = ConversationRepo.create("page-test");
    for (let i = 0; i < 5; i++) {
      ConversationRepo.appendMessage(conv.id, "user", `msg-${i}`);
    }

    const page1 = ConversationRepo.getMessages(conv.id, 2, 0);
    expect(page1).toHaveLength(2);
    expect(page1[0].content).toBe("msg-0");
    expect(page1[1].content).toBe("msg-1");

    const page2 = ConversationRepo.getMessages(conv.id, 2, 2);
    expect(page2).toHaveLength(2);
    expect(page2[0].content).toBe("msg-2");
    expect(page2[1].content).toBe("msg-3");
  });
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
