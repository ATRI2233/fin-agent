import { FastifyPluginAsync } from "fastify";
import { FinAgentError, ErrorCode } from "../../../infra/errors.js";
import type { AgentPort } from "../../../infra/agent/AgentPort.js";

const agentRoutes: FastifyPluginAsync = async (app) => {
  app.get("/agents", async (req, reply) => {
    return { data: [], trace_id: req.traceId };
  });

  app.get("/agents/:name", async (req, reply) => {
    const { name } = req.params as { name: string };
    return { data: { name }, trace_id: req.traceId };
  });

  app.post("/agents/:name/dispatch", async (req, reply) => {
    const { name } = req.params as { name: string };
    const body = req.body as any || {};
    const input = body?.input ?? {};
    const traceId = req.traceId;

    const agentPort = req.registry.resolve<AgentPort>("AgentPort");
    try {
      const result = await agentPort.invoke({
        agentName: name,
        payload: input,
        traceId,
      });
      return { data: result.content, trace_id: traceId };
    } catch (e) {
      if (e instanceof FinAgentError) throw e;
      throw new FinAgentError(
        `Agent '${name}' dispatch failed`,
        ErrorCode.INTERNAL_FAILURE,
        500,
        { agent: name, cause: String(e) }
      );
    }
  });
};

export default agentRoutes;
