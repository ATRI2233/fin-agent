import { FastifyPluginAsync } from "fastify";
import type { IExecutionService } from "../../../modules/execution/service.js";
import type { IdParam } from "../../types.js";

const executionRoutes: FastifyPluginAsync = async (app) => {
  app.get("/executions", async (req, _reply) => {
    return { data: [], trace_id: req.traceId };
  });

  app.get("/executions/:id", async (req, _reply) => {
    const { id } = req.params as IdParam;
    const svc = req.registry!.resolve<IExecutionService>("IExecutionService");
    const nodes = svc.getExecution(id);
    return { data: { id, nodes }, trace_id: req.traceId };
  });

  app.get("/executions/:id/nodes", async (req, _reply) => {
    const { id } = req.params as IdParam;
    const svc = req.registry!.resolve<IExecutionService>("IExecutionService");
    return { data: svc.getExecutionNodes(id), trace_id: req.traceId };
  });
};

export default executionRoutes;
