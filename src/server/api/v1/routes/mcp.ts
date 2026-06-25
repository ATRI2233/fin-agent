import { FastifyPluginAsync } from "fastify";
import { readFileSync } from "fs";
import { resolve } from "path";
import { ValidationError } from "../../../infra/errors.js";
import { settings } from "../../../infra/settings.js";

/** Load the MCP tool manifest from the configured MCP config path. */
function loadMcpConfig(): any {
  const path = resolve(process.cwd(), settings.MCP_CONFIG_PATH);
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
    return { data: tools, trace_id: req.traceId };
  });

  app.get("/mcp/servers", async (req, reply) => {
    const config = loadMcpConfig();
    const servers = (config.servers || []).map((s: any) => ({
      name: s.name,
      description: s.description,
      toolCount: (s.tools || []).length,
    }));
    return { data: servers, trace_id: req.traceId };
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
      trace_id: req.traceId,
    };
  });

  app.post("/mcp/servers/:name/call", async (req, reply) => {
    const { name } = req.params as { name: string };
    const body = req.body as any || {};
    const toolName = body?.tool;

    const config = loadMcpConfig();
    const server = (config.servers || []).find((s: any) => s.name === name);
    if (!server) {
      throw new ValidationError(`MCP server '${name}' not found`);
    }

    const tool = (server.tools || []).find((t: any) => t.name === toolName);
    if (!tool) {
      throw new ValidationError(`Tool '${toolName}' not found in server '${name}'`);
    }

    // MCP tool invocation is not yet implemented: routing a tool call through
    // the agent dispatcher would silently invoke a non-existent agent. Until a
    // dedicated MCP client invoker is wired up, fail explicitly so the caller
    // gets a clear error instead of a bogus success.
    const traceId = req.traceId;
    throw new ValidationError(
      `MCP tool invocation is not implemented (server='${name}', tool='${toolName}')`,
      { server: name, tool: toolName, traceId }
    );
  });
};

export default mcpRoutes;
