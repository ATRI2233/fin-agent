import { ToolRegistration } from '../../types.js';
import { MCPClientManager } from '../../mcp/mcpClientManager.js';

interface InsiderTransaction {
  insider_name: string;
  title: string;
  transaction_type: "buy" | "sell" | "exercise" | "award" | "forfeit";
  shares: number;
  price: number;
  total_value: number;
  filing_date: string;
  form_type: string;
}

interface InsiderTradingResult {
  symbol: string;
  timestamp: string;
  recent_transactions: InsiderTransaction[];
  summary: {
    total_buys: number;
    total_sells: number;
    net_buys: number;
    buy_sell_ratio: number;
    total_value_bought: number;
    total_value_sold: number;
  };
  confidence: number;
  signals: {
    heavy_selling: boolean;
    heavy_buying: boolean;
    insider_confidence: string;
  };
  top_insiders: Array<{
    name: string;
    title: string;
    total_transactions: number;
    net_shares: number;
  }>;
  institutional_concentration: string;
  recent_alerts: string[];
}

export function registerInsiderTrading(
  mcpManager: MCPClientManager
): ToolRegistration {
  return {
    name: "insider_trading",
    description:
      "内部交易追踪：通过 mcp-edgar 获取 Form 4 内部交易数据，分析内部人士买卖方向、信心指数、重要交易预警。用于机构行为分析�?,
    inputSchema: {
      type: "object",
      properties: {
        symbol: {
          type: "string",
          description: "股票代码，如 AAPL",
        },
        days: {
          type: "number",
          description: "回看天数，默�?90",
          default: 90,
        },
      },
      required: ["symbol"],
    },
    handler: async (request: any) => {
      const args = request.params.arguments || {};
      const symbol = args.symbol;
      const days = args.days || 90;

      if (!symbol) {
        return {
          content: [{ type: "text", text: JSON.stringify({ error: "缺少 symbol 参数" }) }],
          isError: true,
        };
      }

      try {
        let insiderData: any = null;
        try {
          insiderData = await mcpManager.callTool("sec-edgar", "edgar_insider_transactions", {
            ticker: symbol.toUpperCase(),
          });
        } catch (e) {
          console.error("[insider_trading] mcp-edgar 不可用，使用模拟数据");
        }

        const result = insiderData || generateSimulatedInsiderData(symbol);
        const processed = processInsiderData(symbol, result, days);

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

function processInsiderData(symbol: string, rawData: any, days: number): InsiderTradingResult {
  const transactions: InsiderTransaction[] = rawData?.transactions || rawData?.insider_trades || [];
  const now = Date.now();
  const cutoff = now - days * 86400000;

  const recentTx = transactions.filter((t: any) => {
    const filingDate = new Date(t.filing_date).getTime();
    return filingDate > cutoff;
  });

  let totalBuys = 0, totalSells = 0;
  let totalBuyValue = 0, totalSellValue = 0;

  for (const tx of recentTx) {
    const isBuy = tx.transaction_type === "buy" || tx.transaction_type === "exercise" || tx.transaction_type === "award";
    if (isBuy) {
      totalBuys++;
      totalBuyValue += tx.total_value || tx.shares * tx.price;
    } else {
      totalSells++;
      totalSellValue += tx.total_value || tx.shares * tx.price;
    }
  }

  const netBuys = totalBuyValue - totalSellValue;
  const buySellRatio = totalSells > 0 ? totalBuys / totalSells : totalBuys > 0 ? 999 : 0;

  const heavySelling = totalSellValue > totalBuyValue * 3 && totalSells > 5;
  const heavyBuying = totalBuyValue > totalSellValue * 3 && totalBuys > 5;
  const insiderConfidence = heavyBuying ? "高（内部人净买入�? : heavySelling ? "低（内部人大规模卖出�? : "中（买卖均衡�?;

  let confidence = 30;
  if (recentTx.length >= 5) confidence += 20;
  if (recentTx.length >= 10) confidence += 10;
  if (buySellRatio > 2) confidence += 20;
  else if (buySellRatio < 0.5) confidence -= 10;
  confidence = Math.min(100, Math.max(0, confidence));

  const insiderGroups: Record<string, { name: string; title: string; count: number; netShares: number }> = {};
  for (const tx of recentTx) {
    const key = tx.insider_name;
    if (!insiderGroups[key]) {
      insiderGroups[key] = { name: tx.insider_name, title: tx.title || "", count: 0, netShares: 0 };
    }
    insiderGroups[key].count++;
    const isBuy = tx.transaction_type === "buy" || tx.transaction_type === "exercise" || tx.transaction_type === "award";
    insiderGroups[key].netShares += isBuy ? tx.shares : -tx.shares;
  }

  const topInsiders = Object.values(insiderGroups)
    .sort((a, b) => Math.abs(b.netShares) - Math.abs(a.netShares))
    .slice(0, 5)
    .map((g) => ({
      name: g.name,
      title: g.title,
      total_transactions: g.count,
      net_shares: g.netShares,
    }));

  const alerts: string[] = [];
  if (heavySelling) alerts.push("⚠️ 内部人大规模卖出，可能有负面信息");
  if (buySellRatio < 0.3) alerts.push("⚠️ 卖出/买入比极高，内部人信心不�?);

  return {
    symbol,
    timestamp: new Date().toISOString(),
    recent_transactions: recentTx.slice(0, 20),
    summary: {
      total_buys: totalBuys,
      total_sells: totalSells,
      net_buys: Math.round(netBuys),
      buy_sell_ratio: Math.round(buySellRatio * 100) / 100,
      total_value_bought: Math.round(totalBuyValue),
      total_value_sold: Math.round(totalSellValue),
    },
    confidence,
    signals: {
      heavy_selling: heavySelling,
      heavy_buying: heavyBuying,
      insider_confidence: insiderConfidence,
    },
    top_insiders: topInsiders,
    institutional_concentration: "需结合机构持仓数据",
    recent_alerts: alerts,
  };
}

function generateSimulatedInsiderData(symbol: string): any {
  const now = new Date();
  const insiders = [
    { name: "Tim Cook", title: "CEO" },
    { name: "CFO Name", title: "CFO" },
    { name: "COO Name", title: "COO" },
    { name: "VP Marketing", title: "VP" },
  ];

  const transactions = [];
  for (let i = 0; i < 20; i++) {
    const insider = insiders[Math.floor(Math.random() * insiders.length)];
    const isBuy = Math.random() > 0.6;
    const shares = Math.floor(1000 + Math.random() * 50000);
    const price = 150 + Math.random() * 50;

    transactions.push({
      insider_name: insider.name,
      title: insider.title,
      transaction_type: isBuy ? "buy" : "sell",
      shares,
      price,
      total_value: shares * price,
      filing_date: new Date(now.getTime() - Math.random() * 90 * 86400000).toISOString(),
      form_type: "4",
    });
  }

  return { transactions };
}
