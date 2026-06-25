import { FastifyPluginAsync } from "fastify";
import { WorkflowNotFoundError } from "../../../infra/errors.js";

const workflowRoutes: FastifyPluginAsync = async (app) => {
  app.get("/workflows", async (req, reply) => {
    const repo = req.registry.resolve("WorkflowRepo");
    const list = repo.list(50, 0);
    return { data: list, trace_id: req.traceId };
  });

  app.get("/workflows/:id", async (req, reply) => {
    const repo = req.registry.resolve("WorkflowRepo");
    const { id } = req.params as { id: string };
    const wf = repo.get(id);
    if (!wf) {
      throw new WorkflowNotFoundError(`Workflow ${id} not found`);
    }
    return { data: wf, trace_id: req.traceId };
  });

  app.post("/workflows/:id/trigger", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as any || {};
    const params = typeof body?.params === "object" && body.params !== null ? body.params : {};
    const wf = req.registry.resolve("WorkflowRepo").get(id);
    if (!wf) {
      throw new WorkflowNotFoundError(`Workflow ${id} not found`);
    }
    const runner = req.registry.resolve("WorkflowRunner");
    const traceId = req.traceId;
    const result = await runner.run(id, params, traceId);
    return {
      data: { executionId: result.executionId, status: result.status },
      trace_id: traceId,
    };
  });
};

export default workflowRoutes;
