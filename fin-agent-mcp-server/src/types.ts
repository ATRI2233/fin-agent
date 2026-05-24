/**
 * fin-agent-mcp-server — 共享类型定义
 */

export interface ToolRegistration {
  name: string;
  description: string;
  inputSchema: any;
  handler: (request: any) => Promise<any>;
}
