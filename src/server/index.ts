import { createApp } from "./app.js";
import { Registry } from "./infra/registry.js";
import { validateSettings, settings } from "./infra/settings.js";
import { createLogger } from "./infra/logging.js";
import { runMigrations, sqlite } from "./infra/db.js";
import { WorkflowRepo, workflowRepo } from "./modules/workflow/repo.js";
import type { IWorkflowRepo } from "./modules/workflow/repo.js";
import { ExecutionRepo, executionRepo } from "./modules/execution/repo.js";
import type { IExecutionRepo } from "./modules/execution/repo.js";
import { ExecutionDomainService } from "./modules/execution/domain-service.js";
import { WorkflowRunner, ExecutorRegistry } from "./modules/workflow/service/workflow_runner.js";
import { OpenClawAdapter } from "../agents/adapter/OpenClawAdapter.js";
import type { AgentPort } from "../agents/adapter/AgentPort.js";
import { WorkflowService } from "./modules/workflow/service/workflow_service.js";
import { ExecutionService } from "./modules/execution/service.js";
import { AgentService } from "./modules/agent/service.js";
import { McpService } from "./modules/mcp/service.js";
import { GatewayClient, gatewayClient } from "./infra/gateway-client.js";

const log = createLogger("index");

async function main() {
  validateSettings(settings);
  log.info({ settings: { ...settings, API_KEY: "***" } }, "Settings validated");

  // Database migrations
  runMigrations();
  log.info("Database migrations applied");

  // Build registry
  const registry = new Registry();

  // Register repositories
  registry.register("WorkflowRepo", () => workflowRepo);
  registry.register("ExecutionRepo", () => executionRepo);

  // Register agent port (OpenClaw adapter)
  registry.register("AgentPort", () => new OpenClawAdapter());

  // Register execution domain service
  registry.register("ExecutionDomainService", (r) => {
    const repo = r.resolve<ExecutionRepo>("ExecutionRepo");
    return new ExecutionDomainService(repo);
  });

  // Register executor registry
  registry.register("ExecutorRegistry", (r) => {
    const port = r.resolve<AgentPort>("AgentPort");
    return new ExecutorRegistry(port);
  });

  // Register workflow runner
  registry.register("WorkflowRunner", (r) => {
    const wfRepo = r.resolve<WorkflowRepo>("WorkflowRepo");
    const execRepo = r.resolve<ExecutionRepo>("ExecutionRepo");
    const execDomainSvc = r.resolve<ExecutionDomainService>("ExecutionDomainService");
    const execReg = r.resolve<ExecutorRegistry>("ExecutorRegistry");
    return new WorkflowRunner(wfRepo, execRepo, execDomainSvc, execReg);
  });

  // Register gateway client
  registry.register("GatewayClient", () => gatewayClient);

  // Register services
  registry.register("IWorkflowService", (r) => {
    const wfRepo = r.resolve<IWorkflowRepo>("WorkflowRepo");
    const runner = r.resolve<WorkflowRunner>("WorkflowRunner");
    const gc = r.resolve<GatewayClient>("GatewayClient");
    return new WorkflowService(wfRepo, runner, gc);
  });

  registry.register("IExecutionService", (r) => {
    const repo = r.resolve<IExecutionRepo>("ExecutionRepo");
    return new ExecutionService(repo);
  });

  registry.register("IAgentService", (r) => {
    const agentPort = r.resolve<AgentPort>("AgentPort");
    return new AgentService(agentPort);
  });

  registry.register("IMcpService", () => {
    return new McpService();
  });

  // Create app
  const app = createApp(registry);

  // Start server
  const host = settings.API_HOST;
  const port = settings.API_PORT;
  try {
    await app.listen({ host, port });
    log.info(`Server listening on http://${host}:${port}`);

  } catch (err) {
    log.error({ err }, "Failed to start server");
    registry.shutdown();
    sqlite.close();
    process.exit(1);
  }

  // Graceful shutdown
  const signals = ["SIGTERM", "SIGINT"];
  for (const sig of signals) {
    process.on(sig, async () => {
      log.info({ signal: sig }, "Shutting down...");
      await app.close();
      registry.shutdown();
      log.info("Shutdown complete");
      process.exit(0);
    });
  }
}

main().catch((err) => {
  log.error(err, "Fatal error during startup");
  process.exit(1);
});
