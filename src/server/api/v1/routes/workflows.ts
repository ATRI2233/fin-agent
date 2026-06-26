import { FastifyPluginAsync } from "fastify";
export type { IWorkflowRunner } from "../../../modules/workflow/service/workflow_runner.js";
import type { IWorkflowService } from "../../../modules/workflow/service/workflow_service.js";
import type { TriggerWorkflowBody, IdParam, DagTriggerBody } from "../../types.js";

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

  app.post("/workflows/dag-trigger", async (req, reply) => {
    const body = req.body as DagTriggerBody;

    if (!body.sessionKey || !body.workflowId) {
      return reply.status(400).send({
        code: 1100,
        message: "sessionKey and workflowId are required",
        data: null,
        trace_id: req.traceId,
      });
    }

    const svc = req.registry!.resolve<IWorkflowService>("IWorkflowService");

    // Fire-and-forget the workflow execution; the execution ID is
    // returned from the child session creation before the async run.
    const executionId = await svc.triggerWorkflowBySession(
      body.sessionKey,
      body.workflowId,
      {},
      req.traceId ?? "",
    );

    return { data: { executionId }, trace_id: req.traceId };
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
