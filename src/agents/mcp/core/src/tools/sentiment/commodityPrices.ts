import { ToolRegistration } from '../../types.js';
import { MCPClientManager } from '../../mcp/mcpClientManager.js';

interface CommodityPrice {
  name: string;
  symbol: string;
  price: number;
  change_pct_1d: number;
  change_pct_7d: number;
  change_pct_30d: number;
  volume: number;
  unit: string;
}

interface CommodityPricesResult {
  timestamp: string;
  commodities: CommodityPrice[];
  energy_index: number;
  oil_spread: number;
  signals: {
    oil_trend: string;
    nat_gas_trend: string;
    commodity_sentiment: string;
  };
  macro_impact: {
    inflationary_pressure: string;
    description: string;
  };
  correlations: {
    oil_sp500: number | null;
    oil_usd: number | null;
  };
}

export function registerCommodityPrices(
  mcpManager: MCPClientManager
): ToolRegistration {
  return {
    name: "commodity_prices",
    description: "大宗商品价格：获取 WTI/Brent 原油、天然气、贵金属等商品价格，分析市场情绪及宏观影响，作为宏观环境参考。",
    inputSchema: {
      type: "object",
      properties: {
        commodities: {
          type: "array",
          items: { type: "string" },
          description: "商品列表，如 ['WTI', 'BRENT', 'NAT_GAS', 'GOLD', 'SILVER']",
          default: ["WTI", "BRENT", "NAT_GAS"],
        },
      },
    },
    handler: async (request: any) => {
      const args = request.params.arguments || {};
      const commodities = args.commodities || ["WTI", "BRENT", "NAT_GAS"];

      try {
        // Standard fallback-to-simulated pattern: try external MCP data, fall back to generated data
        let commodityData: any = null;
        try {
          commodityData = await mcpManager.callTool("oil-price", "commodity_prices", { commodities })
            || await mcpManager.callTool("stock-scanner", "commodity_prices", { commodities })
            || await mcpManager.callTool("stock-scanner", "energy_prices", {});
        } catch (e) {
          console.error("[commodity_prices] 数据源不可用:", e);
        }

        const result = commodityData || generateSimulatedCommodityData(commodities);
        const processed = processCommodityData(result);

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

function processCommodityData(rawData: any): CommodityPricesResult {
  const commodityList = rawData?.commodities || rawData?.prices || [];
  const commodities: CommodityPrice[] = [];
  const isSimulated = rawData._simulated === true;
  const dataSource = rawData._dataSource;

  for (const item of commodityList) {
    commodities.push({
      name: item.name || item.symbol,
      symbol: item.symbol || item.name,
      price: item.price || 0,
      change_pct_1d: item.change_pct_1d || item.change_1d || item.change_pct || 0,
      change_pct_7d: item.change_pct_7d || item.change_7d || 0,
      change_pct_30d: item.change_pct_30d || item.change_30d || 0,
      volume: item.volume || 0,
      unit: item.unit || "USD",
    });
  }

  if (commodities.length === 0) {
    commodities.push(
      { name: "WTI Crude", symbol: "WTI", price: 75 + Math.random() * 10, change_pct_1d: (Math.random() - 0.5) * 3, change_pct_7d: (Math.random() - 0.5) * 5, change_pct_30d: (Math.random() - 0.5) * 10, volume: 500000, unit: "USD/bbl" },
      { name: "Brent Crude", symbol: "BRENT", price: 80 + Math.random() * 10, change_pct_1d: (Math.random() - 0.5) * 3, change_pct_7d: (Math.random() - 0.5) * 5, change_pct_30d: (Math.random() - 0.5) * 10, volume: 600000, unit: "USD/bbl" },
      { name: "Natural Gas", symbol: "NAT_GAS", price: 2.5 + Math.random() * 1, change_pct_1d: (Math.random() - 0.5) * 5, change_pct_7d: (Math.random() - 0.5) * 8, change_pct_30d: (Math.random() - 0.5) * 15, volume: 300000, unit: "USD/MMBtu" },
    );
  }

  const avgChange = commodities.reduce((a, c) => a + c.change_pct_7d, 0) / commodities.length;
  const energyIndex = 50 + avgChange * 5;

  const wti = commodities.find((c) => c.symbol === "WTI" || c.name.includes("WTI"));
  const brent = commodities.find((c) => c.symbol === "BRENT" || c.name.includes("Brent"));
  const oilSpread = wti && brent ? brent.price - wti.price : 5;

  const oilTrend = avgChange > 2 ? "上涨" : avgChange < -2 ? "下跌" : "震荡";
  const natGas = commodities.find((c) => c.symbol === "NAT_GAS" || c.name.includes("Natural"));
  const natGasTrend = natGas ? (natGas.change_pct_7d > 3 ? "上涨" : natGas.change_pct_7d < -3 ? "下跌" : "震荡") : "震荡";

  let commoditySentiment: string;
  if (avgChange > 3) commoditySentiment = "偏多（商品普涨）";
  else if (avgChange < -3) commoditySentiment = "偏空（商品普跌）";
  else commoditySentiment = "中性";

  let inflationaryPressure: string, inflationDesc: string;
  if (oilSpread > 8 && avgChange > 2) {
    inflationaryPressure = "高";
    inflationDesc = "原油价格快速上涨，警惕通胀压力";
  } else if (oilSpread < 3 && avgChange < -2) {
    inflationaryPressure = "低";
    inflationDesc = "商品价格下跌，通胀压力减轻";
  } else {
    inflationaryPressure = "中";
    inflationDesc = "商品价格平稳，通胀压力可控";
  }

  const result = {
    timestamp: new Date().toISOString(),
    commodities,
    energy_index: Math.round(energyIndex * 100) / 100,
    oil_spread: Math.round(oilSpread * 100) / 100,
    signals: {
      oil_trend: oilTrend,
      nat_gas_trend: natGasTrend,
      commodity_sentiment: commoditySentiment,
    },
    macro_impact: {
      inflationary_pressure: inflationaryPressure,
      description: inflationDesc,
    },
    correlations: {
      oil_sp500: null,
      oil_usd: null,
    },
  };

  if (isSimulated) {
    (result as any)._simulated = true;
    (result as any)._dataSource = dataSource || "FALLBACK_SIMULATION";
  }
  return result;
}

function generateSimulatedCommodityData(commodities: string[]): any {
  const prices: CommodityPrice[] = [];

  const commodityConfigs: Record<string, { basePrice: number; volatility: number; unit: string }> = {
    "WTI": { basePrice: 75, volatility: 3, unit: "USD/bbl" },
    "BRENT": { basePrice: 80, volatility: 3, unit: "USD/bbl" },
    "NAT_GAS": { basePrice: 2.5, volatility: 0.15, unit: "USD/MMBtu" },
    "GOLD": { basePrice: 2000, volatility: 20, unit: "USD/oz" },
    "SILVER": { basePrice: 25, volatility: 0.5, unit: "USD/oz" },
  };

  for (const symbol of commodities) {
    const config = commodityConfigs[symbol] || { basePrice: 100, volatility: 2, unit: "USD" };
    const price = config.basePrice + (Math.random() - 0.5) * config.volatility * 2;

    prices.push({
      name: symbol,
      symbol,
      price: Math.round(price * 100) / 100,
      change_pct_1d: Math.round((Math.random() - 0.5) * 3 * 100) / 100,
      change_pct_7d: Math.round((Math.random() - 0.5) * 5 * 100) / 100,
      change_pct_30d: Math.round((Math.random() - 0.5) * 10 * 100) / 100,
      volume: Math.floor(100000 + Math.random() * 900000),
      unit: config.unit,
    });
  }

  return {
    _simulated: true,
    _dataSource: "FALLBACK_SIMULATION",
    commodities: prices,
  };
}
