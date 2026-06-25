/**
 * fin-agent-mcp-server — 共享类型定义
 */

export interface ToolRegistration {
  name: string;
  description: string;
  inputSchema: any;
  handler: (request: any) => Promise<any>;
}

export interface AgentSignal {
  distribution: { p_bullish: number; p_bearish: number; p_neutral: number };
  assumptions?: string[];
  key_drivers?: Array<{ factor: string; weight: number; direction: string }>;
  timeframe?: string;
  data_quality?: number;
  details?: string;
}
