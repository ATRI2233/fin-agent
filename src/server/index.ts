import { createApp } from "./app.js";
import { Registry } from "./infra/registry.js";
import { validateSettings, settings } from "./infra/settings.js";
import { createLogger } from "./infra/logging.js";
import { runMigrations } from "./infra/db.js";
import { WorkflowRepo } from "./modules/workflow/repo.js";
import { ExecutionRepo } from "./modules/execution/repo.js";
import { WorkflowRunner, ExecutorRegistry, type AgentDispatcher } from "./modules/workflow/service/workflow_runner.js";
import { createAgentDispatcher } from "./modules/agent/dispatcher.js";
import { ConversationRepo } from "./modules/conversation/repo.js";

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
  registry.register("WorkflowRepo", () => WorkflowRepo);
  registry.register("ExecutionRepo", () => ExecutionRepo);
  registry.register("ConversationRepo", () => ConversationRepo);

  // Register agent dispatcher
  registry.register("AgentDispatcher", () => createAgentDispatcher());

  // Register executor registry
  registry.register("ExecutorRegistry", (r) => {
    const dispatcher = r.resolve<AgentDispatcher>("AgentDispatcher");
    return new ExecutorRegistry(dispatcher);
  });

  // Register workflow runner
  registry.register("WorkflowRunner", (r) => {
    const workflowRepo = r.resolve<typeof WorkflowRepo>("WorkflowRepo");
    const executionRepo = r.resolve<typeof ExecutionRepo>("ExecutionRepo");
    const executorRegistry = r.resolve<ExecutorRegistry>("ExecutorRegistry");
    return new WorkflowRunner(workflowRepo, executionRepo, executorRegistry);
  });

  // Create app
  const app = createApp(registry);

  // Start server
  const host = settings.API_HOST;
  const port = settings.API_PORT;
  await app.listen({ host, port });
  log.info(`Server listening on http://${host}:${port}`);

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
