import { FastifyPluginAsync } from "fastify";
import type { IExecutionService } from "../../../modules/execution/service.js";
import type { IdParam } from "../../types.js";

const executionRoutes: FastifyPluginAsync = async (app) => {
  app.get("/executions", async (req, _reply) => {
    const query = req.query as { limit?: string; offset?: string };
    const svc = req.registry!.resolve<IExecutionService>("IExecutionService");
    const result = svc.listExecutions(
      query.limit ? parseInt(query.limit, 10) : 20,
      query.offset ? parseInt(query.offset, 10) : 0
    );
    return { data: result, trace_id: req.traceId };
  });

  app.get("/executions/:id", async (req, _reply) => {
    const { id } = req.params as IdParam;
    const svc = req.registry!.resolve<IExecutionService>("IExecutionService");
    const record = svc.getExecutionRecord(id);
    const nodes = svc.getExecution(id);
    return {
      data: {
        id,
        workflow_id: record?.workflowId,
        status: record?.status,
        started_at: record?.startedAt,
        ended_at: record?.completedAt,
        nodes,
      },
      trace_id: req.traceId,
    };
  });

  app.get("/executions/:id/nodes", async (req, _reply) => {
    const { id } = req.params as IdParam;
    const svc = req.registry!.resolve<IExecutionService>("IExecutionService");
    return { data: svc.getExecutionNodes(id), trace_id: req.traceId };
  });

  app.post("/executions/:id/abort", async (req, _reply) => {
    const { id } = req.params as IdParam;
    const svc = req.registry!.resolve<IExecutionService>("IExecutionService");
    const result = svc.abortExecution(id);
    return { data: result, trace_id: req.traceId };
  });
};

export default executionRoutes;
