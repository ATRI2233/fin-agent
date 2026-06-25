import { FastifyPluginAsync } from "fastify";
import type { IAgentService } from "../../../modules/agent/service.js";
import type { DispatchAgentBody, NameParam } from "../../types.js";

const agentRoutes: FastifyPluginAsync = async (app) => {
  app.get("/agents", async (req, _reply) => {
    const svc = req.registry!.resolve<IAgentService>("IAgentService");
    return { data: svc.listAgents(), trace_id: req.traceId };
  });

  app.get("/agents/:name", async (req, reply) => {
    const { name } = req.params as NameParam;
    const svc = req.registry!.resolve<IAgentService>("IAgentService");
    const agent = svc.getAgent(name);
    if (!agent) {
      return reply.code(404).send({ message: `Agent "${name}" not found`, trace_id: req.traceId });
    }
    return { data: agent, trace_id: req.traceId };
  });

  app.post("/agents/:name/dispatch", async (req, _reply) => {
    const { name } = req.params as NameParam;
    const body = (req.body ?? {}) as DispatchAgentBody;
    const traceId = req.traceId ?? "";
    const svc = req.registry!.resolve<IAgentService>("IAgentService");
    const result = await svc.dispatchAgent(name, body.input ?? {}, traceId);
    return { data: result, trace_id: traceId };
  });
};

export default agentRoutes;
