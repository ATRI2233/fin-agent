import { FastifyPluginAsync } from "fastify";
import { ValidationError } from "../../../infra/errors.js";

const agentRoutes: FastifyPluginAsync = async (app) => {
  app.get("/agents", async (req, reply) => {
    return { data: [], trace_id: (req as any).traceId };
  });

  app.get("/agents/:name", async (req, reply) => {
    const { name } = req.params as { name: string };
    return { data: { name }, trace_id: (req as any).traceId };
  });

  app.post("/agents/:name/dispatch", async (req, reply) => {
    const { name } = req.params as { name: string };
    const body = req.body as any || {};
    const input = body?.input ?? {};
    const traceId = (req as any).traceId;
    const dispatcher = (req as any).registry.resolve("AgentDispatcher");
    try {
      const result = await dispatcher.dispatch(name, input, traceId);
      return { data: result, trace_id: traceId };
    } catch (e) {
      if (e instanceof ValidationError) throw e;
      throw new ValidationError(`Agent '${name}' dispatch failed`, {
        cause: String(e),
      });
    }
  });
};

export default agentRoutes;