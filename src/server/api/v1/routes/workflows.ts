import { FastifyPluginAsync } from "fastify";
import type { IWorkflowRunner } from "../../../modules/workflow/service/workflow_runner.js";
import type { IWorkflowService } from "../../../modules/workflow/service/workflow_service.js";
import type { TriggerWorkflowBody, IdParam } from "../../types.js";

const workflowRoutes: FastifyPluginAsync = async (app) => {
  app.get("/workflows", async (req, _reply) => {
    const svc = req.registry!.resolve<IWorkflowService>("IWorkflowService");
    const list = svc.listWorkflows();
    return { data: list, trace_id: req.traceId };
  });

  app.get("/workflows/:id", async (req, _reply) => {
    const { id } = req.params as IdParam;
    const svc = req.registry!.resolve<IWorkflowService>("IWorkflowService");
    const wf = svc.getWorkflow(id);
    return { data: wf, trace_id: req.traceId };
  });

  app.post("/workflows/:id/trigger", async (req, _reply) => {
    const { id } = req.params as IdParam;
    const body = req.body as TriggerWorkflowBody;
    const params = body.params ?? {};
    const svc = req.registry!.resolve<IWorkflowService>("IWorkflowService");
    const result = await svc.triggerWorkflow(id, params, req.traceId ?? "");
    return { data: { executionId: result.executionId, status: result.status }, trace_id: req.traceId };
  });
};

export default workflowRoutes;
