import { ToolRegistration } from "../types.js";
import { MCPClientManager } from "../mcp/mcpClientManager.js";

interface RiskMetrics {
  symbol: string;
  timestamp: string;
  volatility_20d_pct: number | null;
  volatility_60d_pct: number | null;
  drawdown_from_52w_high_pct: number | null;
  var_95_daily_pct: number | null;
  risk_level: "low" | "medium" | "high";
  warnings: string[];
}

export function registerRiskGauge(mcpManager: MCPClientManager): ToolRegistration {
  return {
    name: "risk_gauge",
    description:
      "风控指标计算：基于历史价格数据计算 20日/60日年化波动率、距52周高点回撤百分比、95% VaR。需先调用 market_snapshot 或 tradingview_quote 获取价格数据。",
    inputSchema: {
      type: "object",
      properties: {
        symbol: {
          type: "string",
          description: "股票代码",
        },
        volatility_20d: {
          type: "number",
          description: "20日波动率（小数，如 0.15 表示 15%）",
        },
        volatility_60d: {
          type: "number",
          description: "60日波动率（小数）",
        },
        current_price: {
          type: "number",
          description: "当前价格",
        },
        high_52w: {
          type: "number",
          description: "52周高点",
        },
        daily_returns_60d: {
          type: "array",
          items: { type: "number" },
          description: "近60日每日收益率数组（用于计算 VaR）",
        },
      },
      required: ["symbol"],
    },
    handler: async (request: any) => {
      const args = request.params.arguments || {};
      const symbol = args.symbol?.toUpperCase();

      if (!symbol) {
        return {
          content: [{ type: "text", text: JSON.stringify({ error: "缺少 symbol 参数" }) }],
          isError: true,
        };
      }

      try {
        const vol20d = args.volatility_20d ?? null;
        const vol60d = args.volatility_60d ?? null;
        const currentPrice = args.current_price ?? null;
        const high52w = args.high_52w ?? null;
        const dailyReturns = args.daily_returns_60d ?? [];

        const warnings: string[] = [];
        let riskLevel: "low" | "medium" | "high" = "low";

        let vol20dPct: number | null = null;
        let vol60dPct: number | null = null;
        let drawdownPct: number | null = null;
        let var95: number | null = null;

        if (vol20d !== null) {
          vol20dPct = Math.round(vol20d * 10000) / 100;
          if (vol20dPct > 40) {
            warnings.push(`高波动率警告: ${vol20dPct}%（>40%）`);
            riskLevel = "high";
          } else if (vol20dPct > 25) {
            riskLevel = "medium";
          }
        }

        if (vol60d !== null) {
          vol60dPct = Math.round(vol60d * 10000) / 100;
        }

        if (currentPrice !== null && high52w !== null && high52w > 0) {
          drawdownPct = Math.round(((currentPrice - high52w) / high52w) * 10000) / 100;
          if (drawdownPct < -20) {
            warnings.push(`深度回撤警告: ${drawdownPct}%（<-20%）`);
            riskLevel = "high";
          } else if (drawdownPct < -15) {
            riskLevel = "medium";
          }
        }

        if (dailyReturns.length >= 20) {
          const sortedReturns = [...dailyReturns].sort((a, b) => a - b);
          const varIndex = Math.floor(sortedReturns.length * 0.05);
          var95 = Math.round(Math.abs(sortedReturns[varIndex] || 0) * 10000) / 100;
          if (var95 > 3) {
            warnings.push(`高 VaR 警告: ${var95}% 单日最大预期亏损`);
          }
        }

        if (riskLevel === "high") {
          warnings.push("风险等级: HIGH — 建议降低仓位或等待回调");
        } else if (riskLevel === "medium") {
          warnings.push("风险等级: MEDIUM — 建议轻仓试探");
        } else {
          warnings.push("风险等级: LOW — 正常操作范围");
        }

        const result: RiskMetrics = {
          symbol,
          timestamp: new Date().toISOString(),
          volatility_20d_pct: vol20dPct,
          volatility_60d_pct: vol60dPct,
          drawdown_from_52w_high_pct: drawdownPct,
          var_95_daily_pct: var95,
          risk_level: riskLevel,
          warnings,
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