/**
 * mcpClientManager — 外部 MCP 服务器客户端管理器
 *
 * 使用 @modelcontextprotocol/sdk 的 Client + StdioClientTransport
 * 管理多个外部 MCP 服务器的生命周期。
 *
 * 核心策略：
 * - 惰性连接：首次 callTool() 时 spawn + connect
 * - 连接池：按 serverName 缓存，进程崩溃自动重连
 * - 超时控制：每个 call 默认 30s，可配置
 * - 隔离：每个服务器独立 Client 实例
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath, pathToFileURL } from "url";
import path from "path";
import "dotenv/config";

// ── 代理引导：注入子进程使 Node.js fetch 走代理 ──────────────
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROXY_BOOTSTRAP_URL = pathToFileURL(
  path.join(__dirname, "proxy-bootstrap.mjs")
).href;

interface MCPClientConfig {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

interface ConnectedClient {
  client: Client;
  transport: StdioClientTransport;
  serverName: string;
  disconnected: boolean;
}

function readEnv(key: string): string {
  return (process.env[key] || "").trim();
}

function getMCPConfig(): Record<string, MCPClientConfig> {
  return {
    "stock-scanner": {
      command: "npx",
      args: ["-y", "stock-scanner-mcp", "--enable-workspace",
        "--modules", "tradingview,tradingview-crypto,sec-edgar,coingecko,options,options-cboe,sentiment,frankfurter,workspace,finnhub,fred"],
      env: {
        FINNHUB_API_KEY: readEnv("FINNHUB_API_KEY"),
        FRED_API_KEY: readEnv("FRED_API_KEY"),
      },
    },
    "sec-edgar": {
      command: "npx",
      args: ["-y", "mcp-edgar"],
      env: {},
    },
    "fear-greed": {
      command: "npx",
      args: ["-y", "mcp-server-fear-greed"],
      env: {},
    },
    "oil-price": {
      command: "npx",
      args: ["-y", "oilpriceapi-mcp"],
      env: {
        OILPRICE_API_KEY: readEnv("OILPRICE_API_KEY"),
        OILPRICEAPI_KEY: readEnv("OILPRICE_API_KEY"),
      },
    },
  };
}

const DEFAULT_CALL_TIMEOUT = 30_000;
const CONNECT_TIMEOUT = 15_000;

export class MCPClientManager {
  private clients: Map<string, ConnectedClient> = new Map();
  private initialized = false;

  async initialize(): Promise<void> {
    // 惰性连接模式：不启动任何子进程，仅校验配置
    const errors: string[] = [];
    for (const [name, config] of Object.entries(getMCPConfig())) {
      if (!config.command) {
        errors.push(`MCP 服务器 "${name}" 缺少启动命令`);
      }
    }
    if (errors.length > 0) {
      throw new Error(`MCP 配置错误:\n${errors.join("\n")}`);
    }
    this.initialized = true;
    console.error(`[MCPClientManager] 就绪，${Object.keys(getMCPConfig()).length} 个服务器配置已加载（惰性连接模式）`);
  }

  async callTool(
    serverName: string,
    toolName: string,
    args: Record<string, any>,
    timeout = DEFAULT_CALL_TIMEOUT
  ): Promise<any> {
    if (!getMCPConfig()[serverName]) {
      throw new Error(`未知 MCP 服务器: ${serverName}，可用: ${Object.keys(getMCPConfig()).join(", ")}`);
    }

    const connected = await this.getOrConnect(serverName);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      const mcpResult = await connected.client.callTool(
        { name: toolName, arguments: args },
        undefined,
        { signal: controller.signal }
      );

      // 解析 MCP 结果格式：从 content[] 中提取数据
      return this.extractResult(mcpResult);
    } catch (err: any) {
      // 标记断开，下次 callTool 会自动重新连接
      connected.disconnected = true;
      if (err.name === "AbortError") {
        throw new Error(`调用 ${serverName}:${toolName} 超时 (${timeout}ms)`);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * 解析 MCP callTool 返回的 content 数组，提取实际数据。
   * MCP 标准返回格式: { content: [{ type: "text", text: "..." }] }
   * 工具层期望: 直接是 JSON 对象（或原始值）
   */
  private extractResult(mcpResult: any): any {
    if (!mcpResult || !mcpResult.content || !Array.isArray(mcpResult.content)) {
      return mcpResult;
    }

    const texts = mcpResult.content
      .filter((c: any) => c.type === "text" && c.text != null)
      .map((c: any) => c.text);

    if (texts.length === 1) {
      // 尝试 JSON.parse，失败则返回原始字符串
      try {
        return JSON.parse(texts[0]);
      } catch {
        return texts[0];
      }
    }

    // 多个 content 项：尝试合并
    if (texts.length > 1) {
      const parsed: any[] = [];
      for (const t of texts) {
        try { parsed.push(JSON.parse(t)); } catch { parsed.push(t); }
      }
      return parsed;
    }

    return mcpResult;
  }

  async listTools(serverName: string): Promise<any[]> {
    const connected = await this.getOrConnect(serverName);
    try {
      const result = await connected.client.listTools();
      return result.tools || [];
    } catch {
      connected.disconnected = true;
      return [];
    }
  }

  async ping(serverName: string): Promise<boolean> {
    const connected = await this.getOrConnect(serverName);
    try {
      await connected.client.ping();
      return true;
    } catch {
      connected.disconnected = true;
      return false;
    }
  }

  async disconnect(serverName: string): Promise<void> {
    const entry = this.clients.get(serverName);
    if (!entry) return;

    try {
      await entry.client.close();
    } catch (err) {
      console.error(`[MCPClientManager] 断开 ${serverName} 时出错:`, err);
    }
    this.clients.delete(serverName);
    console.error(`[MCPClientManager] 已断开 ${serverName}`);
  }

  async disconnectAll(): Promise<void> {
    const names = Array.from(this.clients.keys());
    await Promise.allSettled(names.map((name) => this.disconnect(name)));
    console.error("[MCPClientManager] 已断开所有 MCP 服务器");
  }

  getAvailableServers(): string[] {
    return Object.keys(getMCPConfig());
  }

  getConnectedServers(): string[] {
    return Array.from(this.clients.entries())
      .filter(([, c]) => !c.disconnected)
      .map(([name]) => name);
  }

  private async getOrConnect(serverName: string): Promise<ConnectedClient> {
    const existing = this.clients.get(serverName);
    if (existing && !existing.disconnected) {
      return existing;
    }

    // 断开或不存在时重新连接
    if (existing) {
      await this.disconnect(serverName);
    }

    const config = getMCPConfig()[serverName];

    // 构建子进程环境变量，仅在配置了代理时才传递
    const proxyVars: Record<string, string> = {};
    const proxyUrl = readEnv("HTTP_PROXY") || readEnv("https_proxy");
    if (proxyUrl) {
      proxyVars.HTTP_PROXY = readEnv("HTTP_PROXY") || readEnv("http_proxy");
      proxyVars.HTTPS_PROXY = readEnv("HTTPS_PROXY") || readEnv("https_proxy");
      proxyVars.http_proxy = readEnv("http_proxy") || readEnv("HTTP_PROXY");
      proxyVars.https_proxy = readEnv("https_proxy") || readEnv("HTTPS_PROXY");
      proxyVars.PROXY_URL = readEnv("PROXY_URL");
      proxyVars.NO_PROXY = readEnv("NO_PROXY");
      proxyVars.no_proxy = readEnv("no_proxy");
      proxyVars.NODE_OPTIONS = [
        readEnv("NODE_OPTIONS"),
        `--import "${PROXY_BOOTSTRAP_URL}"`,
      ].filter(Boolean).join(" ").trim();
    }

    const transport = new StdioClientTransport({
      command: config.command,
      args: config.args,
      env: {
        ...config.env,
        ...proxyVars,
      },
      stderr: "inherit",
    });

    const client = new Client(
      { name: "fin-agent-mcp-server", version: "1.1.0" },
      { capabilities: {} }
    );

    const entry: ConnectedClient = { client, transport, serverName, disconnected: false };

    // 注册断开/错误回调
    transport.onclose = () => {
      entry.disconnected = true;
      this.clients.delete(serverName);
    };
    transport.onerror = (err) => {
      // JSON 解析错误通常是由子进程向 stdout 输出非 JSON 文本导致的
      // （例如 MCP 服务器的启动横幅），这不意味着连接已断开，
      // transport 在跳过无效行后会继续处理后续的合法消息。
      if (err instanceof SyntaxError) {
        console.warn(`[MCPClientManager] ${serverName} stdout 包含非 JSON 输出，已跳过:`, err.message);
        return;
      }
      console.error(`[MCPClientManager] ${serverName} 传输错误:`, err);
      entry.disconnected = true;
    };

    try {
      const connectPromise = client.connect(transport);
      const timeoutPromise = new Promise<void>((_, reject) =>
        setTimeout(() => reject(new Error(`连接 ${serverName} 超时 (${CONNECT_TIMEOUT}ms)`)), CONNECT_TIMEOUT)
      );
      await Promise.race([connectPromise, timeoutPromise]);
      this.clients.set(serverName, entry);
      return entry;
    } catch (err) {
      // 连接失败时清理 transport
      try { await transport.close(); } catch {}
      console.error(`[MCPClientManager] 连接 ${serverName} 失败:`, err);
      throw err;
    }
  }
}
