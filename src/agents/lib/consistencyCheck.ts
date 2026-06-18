import { ToolRegistration } from "./types.js";
import { getJudgments } from "./dataHub.js";

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
        const judgments = getJudgments(symbol, 20);

        if (!Array.isArray(judgments) || judgments.length === 0) {
          return {
            content: [{ type: "text", text: JSON.stringify({
              symbol,
              timestamp: new Date().toISOString(),
              consistency_score: 100,
              message: "无历史判断，无法做一致性校验",
            }, null, 2) }],
          };
        }

        const thirtyDaysAgo = Date.now() - 30 * 86400000;
        const previousDirections = judgments.slice(0, 10).map((j: any) => ({
          timestamp: j.created_at || j.timestamp,
          direction: j.direction,
          confidence: j.confidence,
          age_days: Math.round((Date.now() - new Date(j.created_at || j.timestamp).getTime()) / 86400000),
        }));

        const recentFlips = previousDirections.filter(
          (d: any) => new Date(d.timestamp).getTime() > thirtyDaysAgo
        );
        let flipCount30d = 0;
        for (let i = 1; i < recentFlips.length; i++) {
          if (recentFlips[i].direction !== recentFlips[i - 1].direction &&
              recentFlips[i].direction !== "neutral" &&
              recentFlips[i - 1].direction !== "neutral") {
            flipCount30d++;
          }
        }

        const flipWarning = flipCount30d >= 3;

        const confidenceValues = judgments.slice(0, 10).map((j: any) => j.confidence as number);
        const avgConfidence = confidenceValues.length > 0
          ? confidenceValues.reduce((a: number, b: number) => a + b, 0) / confidenceValues.length
          : 50;
        const maxDeviation = confidenceValues.length > 0
          ? Math.max(...confidenceValues.map((c: number) => Math.abs(c - avgConfidence)))
          : 0;
        const confidenceStability = Math.max(0, 100 - maxDeviation * 2);

        let consistencyScore = 100;
        let currentDir = currentDirection;
        if (!checkOnly && currentDir) {
          const lastDirection = judgments[0]?.direction;
          if (lastDirection && lastDirection !== "neutral" && currentDir !== "neutral" && lastDirection !== currentDir) {
            consistencyScore -= 30;
          }
          if (Math.abs(currentConfidence - (judgments[0]?.confidence || 50)) > 40) {
            consistencyScore -= 20;
          }
          consistencyScore -= flipCount30d * 10;
          consistencyScore = Math.max(0, consistencyScore);
        } else {
          consistencyScore = 100 - flipCount30d * 10;
          consistencyScore = Math.max(0, consistencyScore);
        }

        const result: ConsistencyReport = {
          symbol,
          timestamp: new Date().toISOString(),
          consistency_score: consistencyScore,
          current_direction: currentDir || "N/A",
          previous_directions: previousDirections,
          flip_count_30d: flipCount30d,
          flip_warning: flipWarning,
          confidence_stability: Math.round(confidenceStability),
        };

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
