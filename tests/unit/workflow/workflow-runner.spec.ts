import { describe, it, expect, vi } from "vitest";
import { WorkflowRunner, ExecutorRegistry } from "../../../src/server/modules/workflow/service/workflow_runner.js";
import { WorkflowNotFoundError, ValidationError } from "../../../src/server/infra/errors.js";
import { settings } from "../../../src/server/infra/settings.js";
import type { IWorkflowRepo } from "../../../src/server/modules/workflow/repo.js";
import type { IExecutionRepo } from "../../../src/server/modules/execution/repo.js";
import type { IExecutionDomainService } from "../../../src/server/modules/execution/domain-service.js";
import type { AgentPort } from "../../../src/agents/adapter/AgentPort.js";
import type { Workflow } from "../../../src/server/modules/workflow/domain/dag.js";

// ---------------------------------------------------------------------------
//  Helpers
// ---------------------------------------------------------------------------

function createMockWorkflowRepo(): IWorkflowRepo {
  return { get: vi.fn(), list: vi.fn() };
}

function createMockExecutionRepo(): IExecutionRepo {
  return {
    createExecution: vi.fn(),
    createExecutionNodes: vi.fn(),
    recordNodeStarted: vi.fn(),
    recordNodeCompleted: vi.fn(),
    recordNodeFailed: vi.fn(),
    recordNodeSkipped: vi.fn(),
    markExecution: vi.fn(),
    getExecutionNodes: vi.fn(),
  };
}

function createMockDomainService(): IExecutionDomainService {
  return { markDownstreamSkipped: vi.fn() };
}

function createMockAgentPort(): AgentPort {
  return { invoke: vi.fn() };
}

function simpleWorkflow(): Workflow {
  return {
    id: "wf-1",
    name: "test-workflow",
    nodes: [
      { id: "input-1", type: "input", data: {} },
      { id: "output-1", type: "output", data: {} },
    ],
    edges: [{ source: "input-1", target: "output-1" }],
    triggerType: "manual",
    config: {},
    status: "active",
  };
}

// ---------------------------------------------------------------------------
//  ExecutorRegistry
// ---------------------------------------------------------------------------

describe("ExecutorRegistry", () => {
  it("should create InputExecutor for 'input' type", () => {
    const registry = new ExecutorRegistry(createMockAgentPort());
    const executor = registry.create("input");
    expect(executor.constructor.name).toBe("InputExecutor");
  });

  it("should create OutputExecutor for 'output' type", () => {
    const registry = new ExecutorRegistry(createMockAgentPort());
    const executor = registry.create("output");
    expect(executor.constructor.name).toBe("OutputExecutor");
  });

  it("should create AgentExecutor for 'agent' type", () => {
    const registry = new ExecutorRegistry(createMockAgentPort());
    const executor = registry.create("agent");
    expect(executor.constructor.name).toBe("AgentExecutor");
  });

  it("should throw ValidationError for unknown type", () => {
    const registry = new ExecutorRegistry(createMockAgentPort());
    expect(() => registry.create("unknown")).toThrow(ValidationError);
  });
});

// ---------------------------------------------------------------------------
//  WorkflowRunner — run
// ---------------------------------------------------------------------------

describe("WorkflowRunner", () => {
  describe("run", () => {
    it("should complete a simple workflow successfully (input -> output)", async () => {
      const workflowRepo = createMockWorkflowRepo();
      const executionRepo = createMockExecutionRepo();
      const domainService = createMockDomainService();
      const agentPort = createMockAgentPort();

      workflowRepo.get = vi.fn().mockReturnValue(simpleWorkflow());
      executionRepo.createExecution = vi.fn().mockReturnValue("exec-1");
      executionRepo.markExecution = vi.fn();
      executionRepo.recordNodeStarted = vi.fn();
      executionRepo.recordNodeCompleted = vi.fn();
      domainService.markDownstreamSkipped = vi.fn().mockReturnValue([]);

      const registry = new ExecutorRegistry(agentPort);
      const runner = new WorkflowRunner(workflowRepo, executionRepo, domainService, registry);

      const result = await runner.run("wf-1", { symbol: "AAPL" }, "tr-1");

      expect(result.status).toBe("completed");
      expect(result.executionId).toBe("exec-1");
      expect(result.workflowId).toBe("wf-1");
      expect(result.failedNodes).toHaveLength(0);
      expect(result.skippedNodes).toHaveLength(0);
      expect(result.results["input-1"]).toBeDefined();
      expect(result.results["output-1"]).toBeDefined();
      expect(result.results["input-1"].output).toEqual({ symbol: "AAPL" });
      expect(result.results["output-1"].output).toEqual({
        inputs: [{ symbol: "AAPL" }],
      });
    });

    it("should throw WorkflowNotFoundError when workflow does not exist", async () => {
      const workflowRepo = createMockWorkflowRepo();
      const executionRepo = createMockExecutionRepo();
      const domainService = createMockDomainService();
      const agentPort = createMockAgentPort();

      workflowRepo.get = vi.fn().mockReturnValue(undefined);

      const registry = new ExecutorRegistry(agentPort);
      const runner = new WorkflowRunner(workflowRepo, executionRepo, domainService, registry);

      await expect(runner.run("nonexistent", {}, "tr-1")).rejects.toThrow(
        WorkflowNotFoundError,
      );
    });

    it("should handle a failed node and return 'failed' status", async () => {
      const workflowRepo = createMockWorkflowRepo();
      const executionRepo = createMockExecutionRepo();
      const domainService = createMockDomainService();
      const agentPort = createMockAgentPort();

      workflowRepo.get = vi.fn().mockReturnValue({
        id: "wf-2",
        name: "fail-workflow",
        nodes: [
          { id: "input-1", type: "input", data: {} },
          { id: "agent-1", type: "agent", data: {}, agent: "bad-agent" },
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

      executionRepo.createExecution = vi.fn().mockReturnValue("exec-2");
      executionRepo.markExecution = vi.fn();
      executionRepo.recordNodeStarted = vi.fn();
      executionRepo.recordNodeCompleted = vi.fn();
      executionRepo.recordNodeFailed = vi.fn();
      executionRepo.recordNodeSkipped = vi.fn();
      domainService.markDownstreamSkipped = vi.fn().mockReturnValue(["output-1"]);

      agentPort.invoke = vi.fn().mockRejectedValue(new Error("Agent failed"));

      const registry = new ExecutorRegistry(agentPort);
      const runner = new WorkflowRunner(workflowRepo, executionRepo, domainService, registry);

      const result = await runner.run("wf-2", { symbol: "AAPL" }, "tr-2");

      expect(result.status).toBe("failed");
      expect(result.failedNodes).toContain("agent-1");
    });

    it("should propagate error from markExecution retry failure", async () => {
      const workflowRepo = createMockWorkflowRepo();
      const executionRepo = createMockExecutionRepo();
      const domainService = createMockDomainService();
      const agentPort = createMockAgentPort();

      workflowRepo.get = vi.fn().mockReturnValue(simpleWorkflow());
      executionRepo.createExecution = vi.fn().mockReturnValue("exec-3");
      executionRepo.recordNodeStarted = vi.fn();
      executionRepo.recordNodeCompleted = vi.fn();
      domainService.markDownstreamSkipped = vi.fn().mockReturnValue([]);

      // Make markExecution fail only for the final status (completed / failed) call
      executionRepo.markExecution = vi.fn().mockImplementation(
        (_id: string, status: string) => {
          if (status === "completed" || status === "failed") {
            throw new Error("DB write failed");
          }
        },
      );

      // Reduce retry count to keep the test fast (only attempt once, no back-off sleep)
      const origMaxRetries = settings.MAX_AGENT_RETRIES;
      settings.MAX_AGENT_RETRIES = 0;

      const registry = new ExecutorRegistry(agentPort);
      const runner = new WorkflowRunner(workflowRepo, executionRepo, domainService, registry);

      await expect(runner.run("wf-1", {}, "tr-3")).rejects.toThrow("DB write failed");

      settings.MAX_AGENT_RETRIES = origMaxRetries;
    });

    it("should pass correct params and traceId to execution creation", async () => {
      const workflowRepo = createMockWorkflowRepo();
      const executionRepo = createMockExecutionRepo();
      const domainService = createMockDomainService();
      const agentPort = createMockAgentPort();

      workflowRepo.get = vi.fn().mockReturnValue(simpleWorkflow());
      executionRepo.createExecution = vi.fn().mockReturnValue("exec-4");
      executionRepo.markExecution = vi.fn();
      executionRepo.recordNodeStarted = vi.fn();
      executionRepo.recordNodeCompleted = vi.fn();
      domainService.markDownstreamSkipped = vi.fn().mockReturnValue([]);

      const registry = new ExecutorRegistry(agentPort);
      const runner = new WorkflowRunner(workflowRepo, executionRepo, domainService, registry);

      const params = { symbol: "TSLA", amount: 100 };
      await runner.run("wf-1", params, "tr-custom");

      expect(executionRepo.createExecution).toHaveBeenCalledWith({
        workflowId: "wf-1",
        params,
        traceId: "tr-custom",
      });
    });
  });
});
