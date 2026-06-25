import { FastifyPluginAsync } from "fastify";
export type { IWorkflowRunner } from "../../../modules/workflow/service/workflow_runner.js";
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
    return { data: { execution_id: result.executionId, status: result.status }, trace_id: req.traceId };
  });

  app.put("/workflows/:id", async (req, _reply) => {
    const { id } = req.params as IdParam;
    const body = req.body as Partial<{ name: string; description: string; nodes: unknown; edges: unknown; triggerType: string; config: unknown }>;
    const svc = req.registry!.resolve<IWorkflowService>("IWorkflowService");
    const result = svc.updateWorkflow(id, body);
    return { data: result, trace_id: req.traceId };
  });

  app.delete("/workflows/:id", async (req, _reply) => {
    const { id } = req.params as IdParam;
    const svc = req.registry!.resolve<IWorkflowService>("IWorkflowService");
    svc.deleteWorkflow(id);
    return { data: null, trace_id: req.traceId };
  });
};

export default workflowRoutes;
