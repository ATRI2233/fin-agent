import { ToolRegistration } from "./types.js";

// ── 类型定义 ─────────────────────────────────────────────
interface AgentAccuracy {
  hit_rate: number;
  sample_count: number;
}

interface WeightUpdate {
  old: number;
  new: number;
  reason: string;
}

interface PatternAlert {
  pattern: string;
  condition: string;
  signal: string;
  action: string;
}

interface RetiredRule {
  rule_id: number;
  rule: string;
  reason: string;
  retired_at: string;
}

interface MemoryLearnerResult {
  agent: string;
  timestamp: string;
  action: string;
  accuracy_report: {
    overall_hit_rate: number;
    total_predictions: number;
    correct_predictions: number;
    by_agent: Record<string, AgentAccuracy>;
  };
  weight_updates: Record<string, WeightUpdate>;
  pattern_alerts: PatternAlert[];
  retired_rules: RetiredRule[];
  next_review: string;
}

// ── 默认权重 ─────────────────────────────────────────────
const DEFAULT_WEIGHTS: Record<string, number> = {
  technical: 0.35,
  fundamental: 0.30,
  sentiment: 0.10,
  macro: 0.10,
  risk: 0.10,
  smart_money: 0.05,
};

export function registerMemoryLearner(): ToolRegistration {
  return {
    name: "memory_learner",
    description: "经验学习者：追踪准确率、进化权重、提取模式、淘汰失效规则",
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["full_review", "update_weights", "extract_patterns", "retire_rules"],
          description: "操作类型",
        },
        lookback_days: {
          type: "number",
          description: "回溯天数，默认30",
          default: 30,
        },
        symbol: {
          type: "string",
          description: "指定标的（可选）",
        },
      },
      required: ["action"],
    },
    handler: async (request: any) => {
      const args = request.params.arguments || {};
      const action = args.action || "full_review";
      const lookbackDays = args.lookback_days || 30;
      const symbol = args.symbol;

      try {
        const result: MemoryLearnerResult = {
          agent: "memory-learner",
          timestamp: new Date().toISOString(),
          action,
          accuracy_report: {
            overall_hit_rate: 0,
            total_predictions: 0,
            correct_predictions: 0,
            by_agent: {},
          },
          weight_updates: {},
          pattern_alerts: [],
          retired_rules: [],
          next_review: getNextReviewDate(),
        };

        // 执行准确率统计
        if (action === "full_review" || action === "update_weights") {
          const accuracy = computeAccuracy(lookbackDays, symbol);
          result.accuracy_report = accuracy;
          result.weight_updates = computeWeightUpdates(accuracy);
        }

        // 提取模式
        if (action === "full_review" || action === "extract_patterns") {
          result.pattern_alerts = extractPatterns(lookbackDays);
        }

        // 淘汰规则
        if (action === "full_review" || action === "retire_rules") {
          result.retired_rules = retireRules();
        }

        // 持久化权重更新
        if (action === "full_review" || action === "update_weights") {
          saveWeightUpdates(result.weight_updates);
        }

        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (err: any) {
        return {
          content: [{ type: "text", text: JSON.stringify({ error: err.message }) }],
          isError: true,
        };
      }
    },
  };
}

// ── 辅助函数 ──────────────────────────────────────────────

function getNextReviewDate(): string {
  const next = new Date();
  next.setDate(next.getDate() + 7);
  return next.toISOString().split("T")[0];
}

function computeAccuracy(lookbackDays: number, symbol?: string): MemoryLearnerResult["accuracy_report"] {
  return {
    overall_hit_rate: 0,
    total_predictions: 0,
    correct_predictions: 0,
    by_agent: {},
  };
}

function computeWeightUpdates(accuracy: MemoryLearnerResult["accuracy_report"]): Record<string, WeightUpdate> {
  const updates: Record<string, WeightUpdate> = {};
  for (const [agent, weight] of Object.entries(DEFAULT_WEIGHTS)) {
    updates[agent] = {
      old: weight,
      new: weight,
      reason: "记忆系统已关闭，维持默认权重",
    };
  }
  return updates;
}

function extractPatterns(lookbackDays: number): PatternAlert[] {
  return [];
}

function retireRules(): RetiredRule[] {
  return [];
}

function saveWeightUpdates(updates: Record<string, WeightUpdate>) {
  // no-op
}
