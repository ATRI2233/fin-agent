import { FastifyPluginAsync } from "fastify";
import { WorkflowRepo } from "../../../modules/workflow/repo.js";
import { WorkflowNotFoundError } from "../../../infra/errors.js";

const workflowRoutes: FastifyPluginAsync = async (app) => {
  app.get("/workflows", async (req, reply) => {
    const list = WorkflowRepo.list(50, 0);
    return { data: list, trace_id: (req as any).traceId };
  });

  app.get("/workflows/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const wf = WorkflowRepo.get(id);
    if (!wf) {
      throw new WorkflowNotFoundError(`Workflow ${id} not found`);
    }
    return { data: wf, trace_id: (req as any).traceId };
  });

  app.post("/workflows/:id/trigger", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as any || {};
    const params = typeof body?.params === "object" && body.params !== null ? body.params : {};
    const wf = WorkflowRepo.get(id);
    if (!wf) {
      throw new WorkflowNotFoundError(`Workflow ${id} not found`);
    }
    const runner = (req as any).registry.resolve("WorkflowRunner");
    const traceId = (req as any).traceId;
    const result = await runner.run(id, params, traceId);
    return {
      data: { executionId: result.executionId, status: result.status },
      trace_id: traceId,
    };
  });
};

export default workflowRoutes;
