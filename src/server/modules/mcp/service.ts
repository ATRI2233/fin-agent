import { readFile } from "fs/promises";
import { resolve } from "path";
import { ValidationError } from "../../infra/errors.js";
import { settings } from "../../infra/settings.js";
import { createLogger } from "../../infra/logging.js";

interface McpConfig {
  servers: {
    name: string;
    description?: string;
    tools: {
      name: string;
      description?: string;
    }[];
  }[];
}

interface ToolInfo {
  name: string;
  description?: string;
  server: string;
}

interface ServerInfo {
  name: string;
  description?: string;
  toolCount: number;
}

const log = createLogger("mcp-service");

export interface IMcpService {
  listTools(): Promise<ToolInfo[]>;
  listServers(): Promise<ServerInfo[]>;
  getServerTools(name: string): Promise<{ name: string; description?: string }[]>;
  callTool(serverName: string, toolName: string, traceId: string): Promise<void>;
  getAllowedTools(agentName: string): Promise<string[]>;
}

export class McpService implements IMcpService {
  private mcpConfigPath: string;

  constructor(mcpConfigPath?: string) {
    this.mcpConfigPath = mcpConfigPath ?? resolve(process.cwd(), settings.MCP_CONFIG_PATH);
  }

  private async loadMcpConfig(): Promise<McpConfig> {
    const path = this.mcpConfigPath;
    try {
      const raw = await readFile(path, "utf-8");
      return JSON.parse(raw) as McpConfig;
    } catch (err) {
      log.error({ err, path }, "Failed to load MCP config");
      return { servers: [] };
    }
  }

  async listTools(): Promise<ToolInfo[]> {
    const config = await this.loadMcpConfig();
    const tools: ToolInfo[] = [];
    for (const server of config.servers || []) {
      for (const tool of server.tools || []) {
        tools.push({
          name: tool.name,
          description: tool.description,
          server: server.name,
        });
      }
    }
    return tools;
  }

  async listServers(): Promise<ServerInfo[]> {
    const config = await this.loadMcpConfig();
    return (config.servers || []).map((s) => ({
      name: s.name,
      description: s.description,
      toolCount: (s.tools || []).length,
    }));
  }

  async getServerTools(name: string): Promise<{ name: string; description?: string }[]> {
    const config = await this.loadMcpConfig();
    const server = (config.servers || []).find((s) => s.name === name);
    if (!server) {
      throw new ValidationError(`MCP server '${name}' not found`);
    }
    return server.tools || [];
  }

  async callTool(serverName: string, toolName: string, traceId: string): Promise<void> {
    const config = await this.loadMcpConfig();
    const server = (config.servers || []).find((s) => s.name === serverName);
    if (!server) {
      throw new ValidationError(`MCP server '${serverName}' not found`);
    }
    const tool = (server.tools || []).find((t) => t.name === toolName);
    if (!tool) {
      throw new ValidationError(`Tool '${toolName}' not found in server '${serverName}'`);
    }
    throw new ValidationError(
      `MCP tool invocation is not implemented (server='${serverName}', tool='${toolName}')`,
      { server: serverName, tool: toolName, traceId }
    );
  }

  async getAllowedTools(_agentName: string): Promise<string[]> {
    // For now, return all tool names as the allowed tools for any agent.
    // The MCP config doesn't have per-agent tool whitelists yet.
    const config = await this.loadMcpConfig();
    const tools: string[] = [];
    for (const server of config.servers || []) {
      for (const tool of server.tools || []) {
        tools.push(tool.name);
      }
    }
    return tools;
  }
}
