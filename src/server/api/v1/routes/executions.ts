import { FastifyPluginAsync } from "fastify";
import { ExecutionRepo } from "../../../modules/execution/repo.js";
import { ExecutionNotFoundError } from "../../../infra/errors.js";

const executionRoutes: FastifyPluginAsync = async (app) => {
  app.get("/executions", async (req, reply) => {
    // TODO: list executions from ExecutionRepo
    return { data: [], trace_id: (req as any).traceId };
  });

  app.get("/executions/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const nodes = ExecutionRepo.getExecutionNodes(id);
    if (nodes.length === 0) {
      throw new ExecutionNotFoundError(`Execution ${id} not found`);
    }
    return { data: { id, nodes }, trace_id: (req as any).traceId };
  });

  app.get("/executions/:id/nodes", async (req, reply) => {
    const { id } = req.params as { id: string };
    const nodes = ExecutionRepo.getExecutionNodes(id);
    return { data: nodes, trace_id: (req as any).traceId };
  });
};

export default executionRoutes;