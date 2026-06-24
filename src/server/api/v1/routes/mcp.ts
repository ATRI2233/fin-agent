import { FastifyPluginAsync } from "fastify";
import { readFileSync } from "fs";
import { resolve } from "path";
import { ValidationError } from "../../../infra/errors.js";

/** Load the MCP tool manifest from .opencode/opencode.json. */
function loadMcpConfig(): any {
  const path = resolve(process.cwd(), ".opencode", "opencode.json");
  try {
    const raw = readFileSync(path, "utf-8");
    return JSON.parse(raw);
  } catch (e) {
    return { servers: [] };
  }
}

const mcpRoutes: FastifyPluginAsync = async (app) => {
  app.get("/mcp/tools", async (req, reply) => {
    const config = loadMcpConfig();
    const tools: any[] = [];
    for (const server of config.servers || []) {
      for (const tool of server.tools || []) {
        tools.push({
          name: tool.name,
          description: tool.description,
          server: server.name,
        });
      }
    }
    return { data: tools, trace_id: (req as any).traceId };
  });

  app.get("/mcp/servers", async (req, reply) => {
    const config = loadMcpConfig();
    const servers = (config.servers || []).map((s: any) => ({
      name: s.name,
      description: s.description,
      toolCount: (s.tools || []).length,
    }));
    return { data: servers, trace_id: (req as any).traceId };
  });

  app.get("/mcp/servers/:name/tools", async (req, reply) => {
    const { name } = req.params as { name: string };
    const config = loadMcpConfig();
    const server = (config.servers || []).find((s: any) => s.name === name);
    if (!server) {
      throw new ValidationError(`MCP server '${name}' not found`);
    }
    return {
      data: server.tools || [],
      trace_id: (req as any).traceId,
    };
  });

  app.post("/mcp/servers/:name/call", async (req, reply) => {
    const { name } = req.params as { name: string };
    const body = req.body as any || {};
    const toolName = body?.tool;
    const args = body?.arguments || {};

    const config = loadMcpConfig();
    const server = (config.servers || []).find((s: any) => s.name === name);
    if (!server) {
      throw new ValidationError(`MCP server '${name}' not found`);
    }

    const tool = (server.tools || []).find((t: any) => t.name === toolName);
    if (!tool) {
      throw new ValidationError(`Tool '${toolName}' not found in server '${name}'`);
    }

    // TODO: Actually invoke the tool via AgentDispatcher when direct call is available
    const dispatcher = (req as any).registry.resolve("AgentDispatcher");
    const result = await dispatcher.dispatch(toolName, args, (req as any).traceId);

    return { data: result, trace_id: (req as any).traceId };
  });
};

export default mcpRoutes;