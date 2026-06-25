import { ToolRegistration } from '../../types.js';
import { MCPClientManager } from '../../mcp/mcpClientManager.js';
import { extractData } from "../shared/extractData.js";

const SECTOR_MAP: Record<string, string> = {
  XLK: "科技", XLF: "金融", XLE: "能源", XLV: "医疗",
  XLY: "可选消费", XLP: "必需消费", XLI: "工业", XLU: "公用事业",
  XLB: "材料", XLRE: "房地产", XLC: "通信",
};

interface SectorScore {
  ticker: string;
  name: string;
  price: number;
  change_pct_1d: number;
  change_pct_5d: number;
  change_pct_20d: number;
  relative_strength: number;
  volume_ratio: number;
  money_flow_signal: "inflow" | "outflow" | "neutral";
}

export function registerSectorRotation(
  mcpManager: MCPClientManager
): ToolRegistration {
  return {
    name: "sector_rotation",
    description: "板块轮动分析：通过 TradingView 获取行业板块实时表现，计算相对强度和资金流向信号，输出强弱势板块排名并判断轮动阶段。",
    inputSchema: {
      type: "object",
      properties: {
        benchmark: {
          type: "string",
          description: "基准指数，默认SPX（标普500）",
          default: "SPX",
        },
        lookback_days: {
          type: "number",
          description: "回看天数，默认20",
          default: 20,
        },
      },
    },
    handler: async (request: any) => {
      const args = request.params.arguments || {};
      const benchmark = args.benchmark || "SPX";
      const lookback = args.lookback_days || 20;

      try {
        // ── 获取板块表现数据 ──────────────────────────────────
        let sectorPerf: any[] = [];
        try {
          const rawPerf = await mcpManager.callTool(
            "stock-scanner", "tradingview_sector_performance", {}, 20000
          );
          sectorPerf = extractData(rawPerf);
        } catch { /* fallback to empty */ }

        const sectorScores: SectorScore[] = [];

        for (const item of sectorPerf) {
          const ticker = (item.symbol || "").replace("AMEX:", "");
          const sectorName = SECTOR_MAP[ticker];
          if (!sectorName) continue;

          const data = item.data || {};
          const price = data.close || 0;
          const change1d = data.change ?? 0;
          const perfW = data.Perf_W ?? data["Perf.W"] ?? 0;
          const perf1M = data.Perf_1M ?? data["Perf.1M"] ?? 0;

          // TradingView sector perf 不含 Volume Ratio，用保守默认�?
          const volumeRatio = 1.0;

          sectorScores.push({
            ticker,
            name: sectorName,
            price,
            change_pct_1d: Math.round(change1d * 100) / 100,
            change_pct_5d: Math.round(perfW * 100) / 100,
            change_pct_20d: Math.round(perf1M * 100) / 100,
            relative_strength: Math.round(perf1M * 100) / 100,
            volume_ratio: Math.round(volumeRatio * 100) / 100,
            money_flow_signal:
              change1d > 0 ? "inflow"
              : change1d < 0 ? "outflow"
              : "neutral",
          });
        }

        const byRS = [...sectorScores].sort((a, b) => b.relative_strength - a.relative_strength);
        const top3 = byRS.slice(0, 3);
        const bottom3 = byRS.slice(-3).reverse();

        const rotationSignal = detectRotationSignal(sectorScores);

        return {
          content: [{ type: "text", text: JSON.stringify({
            timestamp: new Date().toISOString(),
            benchmark,
            lookback_days: lookback,
            top_sectors: top3,
            bottom_sectors: bottom3,
            all_sectors: byRS,
            rotation_signal: rotationSignal,
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

function detectRotationSignal(scores: SectorScore[]): {
  phase: string;
  description: string;
  confidence: number;
} {
  const inflowCount = scores.filter((s) => s.money_flow_signal === "inflow").length;
  const outflowCount = scores.filter((s) => s.money_flow_signal === "outflow").length;
  const avgRS = scores.length > 0
    ? scores.reduce((a, s) => a + s.relative_strength, 0) / scores.length
    : 0;

  if (inflowCount >= 5 && avgRS > 0) {
    return { phase: "broad_rally", description: "普涨格局，资金广泛流入，风险偏好上升", confidence: 75 };
  } else if (inflowCount >= 3 && avgRS > 0) {
    return { phase: "sector_rotation_up", description: "板块轮动上行，资金从防御转向进攻", confidence: 65 };
  } else if (outflowCount >= 5) {
    return { phase: "broad_sell_off", description: "普跌格局，资金广泛流出，避险情绪升温", confidence: 75 };
  } else if (outflowCount >= 3) {
    return { phase: "sector_rotation_down", description: "板块轮动下行，资金从进攻转向防御", confidence: 65 };
  } else {
    return { phase: "mixed", description: "板块分化，无明显轮动方向", confidence: 40 };
  }
}
