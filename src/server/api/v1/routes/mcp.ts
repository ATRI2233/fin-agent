import { FastifyPluginAsync } from "fastify";
import type { IMcpService } from "../../../modules/mcp/service.js";
import type { NameParam, CallMcpToolBody } from "../../types.js";

const mcpRoutes: FastifyPluginAsync = async (app) => {
  app.get("/mcp/tools", async (req, _reply) => {
    const svc = req.registry!.resolve<IMcpService>("IMcpService");
    return { data: await svc.listTools(), trace_id: req.traceId };
  });

  app.get("/mcp/servers", async (req, _reply) => {
    const svc = req.registry!.resolve<IMcpService>("IMcpService");
    return { data: await svc.listServers(), trace_id: req.traceId };
  });

  app.get("/mcp/servers/:name/tools", async (req, _reply) => {
    const { name } = req.params as NameParam;
    const svc = req.registry!.resolve<IMcpService>("IMcpService");
    return { data: await svc.getServerTools(name), trace_id: req.traceId };
  });

  app.post("/mcp/servers/:name/call", async (req, _reply) => {
    const { name } = req.params as NameParam;
    const body = req.body as CallMcpToolBody;
    const traceId = req.traceId ?? "";
    const svc = req.registry!.resolve<IMcpService>("IMcpService");
    await svc.callTool(name, body.tool, traceId);
  });

  app.get("/mcp/agents/:name/allowed-tools", async (req, _reply) => {
    const { name } = req.params as NameParam;
    const svc = req.registry!.resolve<IMcpService>("IMcpService");
    return { data: await svc.getAllowedTools(name), trace_id: req.traceId };
  });
};

export default mcpRoutes;
