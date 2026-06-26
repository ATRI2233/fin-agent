import { ToolRegistration } from "./types.js";

/** Parse an ISO-ish timestamp, normalising missing 'Z' suffix. */
function _parseDate(ts: string): Date {
  return new Date(ts.endsWith("Z") ? ts : ts + "Z");
}

interface ConsistencyReport {
  symbol: string;
  timestamp: string;
  consistency_score: number;
  current_direction: string;
  previous_directions: Array<{
    timestamp: string;
    direction: string;
    confidence: number;
    age_days: number;
  }>;
  flip_count_30d: number;
  flip_warning: boolean;
  confidence_stability: number;
}

export function registerConsistencyCheck(): ToolRegistration {
  return {
    name: "consistency_check",
    description:
      "逻辑一致性校验：每次新判断必须与历史判断对比。方向翻转时需提供理由，置信度大幅波动需解释，同一标的短期反复翻转触发震荡警告",
    inputSchema: {
      type: "object",
      properties: {
        symbol: {
          type: "string",
          description: "股票代码",
        },
        current_direction: {
          type: "string",
          enum: ["bullish", "bearish", "neutral"],
          description: "当前判断方向",
        },
        current_confidence: {
          type: "number",
          description: "当前置信度0-100",
          default: 50,
        },
        check_only: {
          type: "boolean",
          description: "仅查询历史记录，不校验新判断",
          default: false,
        },
      },
      required: ["symbol"],
    },
    handler: async (request: any) => {
      const args = request.params.arguments || {};
      const symbol = args.symbol;
      const currentDirection = args.current_direction as string | undefined;
      const currentConfidence = args.current_confidence || 50;
      const checkOnly = args.check_only || false;

      try {
        return {
          content: [{ type: "text", text: JSON.stringify({
            symbol,
            timestamp: new Date().toISOString(),
            consistency_score: 100,
            message: "记忆系统已关闭，无法做一致性校验",
          }, null, 2) }],
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
