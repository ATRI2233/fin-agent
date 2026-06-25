/**
 * infra/agent/AgentPort.ts — Agent 端口接口（Adapter 模式中的 Target）
 *
 * 定义 Agent 调用的值对象和接口契约。
 * OpenClawAdapter 实现此接口；调用方（routes / workflow_runner）依赖此接口。
 */

/** Token 用量统计（可选，由底层 Adapter 填充） */
export interface TokenUsage {
  readonly promptTokens?: number;
  readonly completionTokens?: number;
  readonly totalTokens?: number;
}

/** Agent 调用扩展选项（预留字段，避免未来扩展时修改接口契约） */
export interface AgentOptions {
  readonly maxTokens?: number;
  readonly temperature?: number;
  readonly stream?: boolean;
  readonly [key: string]: unknown;
}

/** Agent 输入值对象 */
export interface AgentInput {
  readonly agentName: string;
  readonly payload: unknown;
  readonly traceId: string;
  readonly options?: AgentOptions;
}

/** Agent 输出值对象 */
export interface AgentOutput {
  /** 解析后的内容（可能是对象或字符串，由调用方根据场景处理） */
  readonly content: unknown;
  /** 原始响应字符串，方便调用方在解析失败时降级处理 */
  readonly raw?: string;
  /** Token 用量统计 */
  readonly usage?: TokenUsage;
}

/** Lifecycle — 可选的生命周期管理接口 */
export interface Lifecycle {
  init?(): Promise<void>;
  shutdown?(): Promise<void>;
}

/** AgentPort — 调用 Agent 的通用接口 */
export interface AgentPort {
  invoke(input: AgentInput): Promise<AgentOutput>;
}
