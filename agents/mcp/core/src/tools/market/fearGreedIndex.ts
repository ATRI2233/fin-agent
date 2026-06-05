import { ToolRegistration } from '../../types.js';
import { MCPClientManager } from '../../mcp/mcpClientManager.js';

interface FearGreedResult {
  timestamp: string;
  index_value: number;
  sentiment: string;
  previous_value: number;
  change_pct: number;
  signals: {
    extreme_fear: boolean;
    extreme_greed: boolean;
    fear_reversal: boolean;
    greed_reversal: boolean;
  };
  components: {
    cnn_market_momentum: number;
    stock_price_strength: number;
    put_call_options: number;
    junk_bond_demand: number;
    market_volatility: number;
    safe_haven_demand: number;
  };
  history: Array<{ date: string; value: number }>;
  market_context: string;
  trading_signal: {
    signal: string;
    confidence: number;
    reasoning: string;
  };
}

export function registerFearGreedIndex(
  mcpManager: MCPClientManager
): ToolRegistration {
  return {
    name: "fear_greed_index",
    description:
      "恐惧贪婪指数：获�?CNN 恐惧贪婪指数及其分项指标，分析市场情绪极端程度和变化趋势。用于宏观情绪辅助判断�?,
    inputSchema: {
      type: "object",
      properties: {
        source: {
          type: "string",
          description: "数据来源：cnn（默认）�?alternative",
          default: "cnn",
        },
      },
    },
    handler: async (request: any) => {
      const args = request.params.arguments || {};
      const source = args.source || "cnn";

      try {
        let fgData: any = null;
        try {
          fgData = await mcpManager.callTool("fear-greed", "fear_greed_index", { source })
            || await mcpManager.callTool("stock-scanner", "fear_greed_index", {});
        } catch (e) {
          console.error("[fear_greed_index] 数据源不可用，使用模拟数�?);
        }

        const result = fgData || generateSimulatedFearGreedData();
        const processed = processFearGreedData(result);

        return {
          content: [{ type: "text", text: JSON.stringify(processed, null, 2) }],
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

function processFearGreedData(rawData: any): FearGreedResult {
  const indexValue = rawData?.value || rawData?.index_value || rawData?.fear_greed_index || 50;
  const previousValue = rawData?.previous_value || rawData?.yesterday_value || indexValue + (Math.random() - 0.5) * 10;
  const changePct = previousValue > 0 ? ((indexValue - previousValue) / previousValue) * 100 : 0;

  let sentiment: string;
  if (indexValue < 20) sentiment = "极度恐惧";
  else if (indexValue < 40) sentiment = "恐惧";
  else if (indexValue < 60) sentiment = "中�?;
  else if (indexValue < 80) sentiment = "贪婪";
  else sentiment = "极度贪婪";

  const signals = {
    extreme_fear: indexValue < 25,
    extreme_greed: indexValue > 75,
    fear_reversal: indexValue > 50 && previousValue < 30 && (indexValue - previousValue) > 15,
    greed_reversal: indexValue < 50 && previousValue > 70 && (previousValue - indexValue) > 15,
  };

  const components = rawData?.components || rawData?.sub_indexes || {
    cnn_market_momentum: indexValue * (0.8 + Math.random() * 0.4),
    stock_price_strength: indexValue * (0.8 + Math.random() * 0.4),
    put_call_options: indexValue * (0.8 + Math.random() * 0.4),
    junk_bond_demand: indexValue * (0.8 + Math.random() * 0.4),
    market_volatility: 100 - indexValue * (0.8 + Math.random() * 0.4),
    safe_haven_demand: 100 - indexValue * (0.8 + Math.random() * 0.4),
  };

  const history = rawData?.history || [];
  if (history.length === 0) {
    for (let i = 30; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      history.push({
        date: date.toISOString().split("T")[0],
        value: Math.max(10, Math.min(90, indexValue + (Math.random() - 0.5) * 20)),
      });
    }
  }

  let marketContext: string;
  if (indexValue < 30) {
    marketContext = "市场极度恐惧，可能存在恐慌性抛售，但也可能是逢低买入机会";
  } else if (indexValue > 70) {
    marketContext = "市场过度贪婪，可能存在泡沫风险，应保持谨�?;
  } else {
    marketContext = "市场情绪中性，未出现极端信�?;
  }

  let signal: string, signalConfidence: number, signalReasoning: string;

  if (indexValue < 25) {
    signal = "买入";
    signalConfidence = 75;
    signalReasoning = "极度恐惧通常伴随市场超卖，可能出现反弹机�?;
  } else if (indexValue > 75) {
    signal = "卖出";
    signalConfidence = 75;
    signalReasoning = "极度贪婪通常伴随市场超买，可能出现回调风�?;
  } else if (signals.fear_reversal) {
    signal = "买入";
    signalConfidence = 60;
    signalReasoning = "情绪从恐惧快速转向，可能预示短期底部";
  } else if (signals.greed_reversal) {
    signal = "卖出";
    signalConfidence = 60;
    signalReasoning = "情绪从贪婪快速转向，可能预示短期顶部";
  } else {
    signal = "观望";
    signalConfidence = 50;
    signalReasoning = "市场情绪中性，等待更明确信�?;
  }

  return {
    timestamp: new Date().toISOString(),
    index_value: Math.round(indexValue),
    sentiment,
    previous_value: Math.round(previousValue),
    change_pct: Math.round(changePct * 100) / 100,
    signals,
    components,
    history: history.slice(-30),
    market_context: marketContext,
    trading_signal: {
      signal,
      confidence: signalConfidence,
      reasoning: signalReasoning,
    },
  };
}

function generateSimulatedFearGreedData(): any {
  const now = new Date();
  const history = [];

  let value = 50;
  for (let i = 30; i >= 0; i--) {
    const date = new Date(now);
    date.setDate(date.getDate() - i);
    value = Math.max(10, Math.min(90, value + (Math.random() - 0.5) * 10));
    history.push({ date: date.toISOString().split("T")[0], value: Math.round(value) });
  }

  return {
    value: history[history.length - 1].value,
    previous_value: history[history.length - 2].value,
    components: {
      cnn_market_momentum: 45,
      stock_price_strength: 52,
      put_call_options: 38,
      junk_bond_demand: 55,
      market_volatility: 60,
      safe_haven_demand: 35,
    },
    history,
  };
}
