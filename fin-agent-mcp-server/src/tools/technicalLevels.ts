import { ToolRegistration } from "../types.js";
import { MCPClientManager } from "../mcp/mcpClientManager.js";

function extractData(raw: any): any[] {
  if (Array.isArray(raw)) return raw;
  if (raw?.content && Array.isArray(raw.content)) {
    const texts = raw.content
      .filter((c: any) => c.type === "text" && c.text != null)
      .map((c: any) => c.text);
    const results: any[] = [];
    for (const t of texts) {
      try { results.push(JSON.parse(t)); }
      catch { if (t) results.push(t); }
    }
    return results;
  }
  return [];
}

interface TechnicalResult {
  symbol: string;
  current_price: number;
  pivot_points: {
    pp: number; r1: number; r2: number; r3: number;
    s1: number; s2: number; s3: number;
  };
  moving_averages: Record<string, number>;
  indicators: {
    rsi_14: number;
    macd: { value: number; signal: number; histogram: number };
    bollinger: { upper: number; middle: number; lower: number; bandwidth: number };
  };
  key_levels: Array<{
    price: number;
    type: "support" | "resistance";
    strength: "strong" | "moderate" | "weak";
    reason: string;
  }>;
  trend: "uptrend" | "downtrend" | "sideways";
  volume_anomaly: boolean;
  action_points: Array<{
    price: number;
    action: "buy" | "sell" | "stop_loss" | "take_profit";
    confidence: number;
    reason: string;
  }>;
}

export function registerTechnicalLevels(
  mcpManager: MCPClientManager
): ToolRegistration {
  return {
    name: "technical_levels",
    description:
      "技术位计算：通过 TradingView 获取 RSI/MACD/布林带/均线系统/枢轴点，自动标注支撑阻力位和操作建议。支持股票和指数。",
    inputSchema: {
      type: "object",
      properties: {
        symbol: {
          type: "string",
          description: "股票代码或指数代码，如 AAPL, SPX",
        },
      },
      required: ["symbol"],
    },
    handler: async (request: any) => {
      const args = request.params.arguments || {};
      const symbol = args.symbol;

      if (!symbol) {
        return {
          content: [{ type: "text", text: JSON.stringify({ error: "缺少 symbol 参数" }) }],
          isError: true,
        };
      }

      try {
        // ── 并行获取技术指标和报价 ────────────────────────────
        const [techData, quoteData] = await Promise.allSettled([
          mcpManager.callTool("stock-scanner", "tradingview_technicals", { tickers: [symbol] }, 30000),
          mcpManager.callTool("stock-scanner", "tradingview_quote", { tickers: [symbol] }, 20000),
        ]);

        const rawTech = techData.status === "fulfilled" ? techData.value : null;
        const rawQuote = quoteData.status === "fulfilled" ? quoteData.value : null;

        const techItems = extractData(rawTech);
        const quoteItems = extractData(rawQuote);

        const tech = techItems[0]?.data || techItems[0] || null;
        const quote = quoteItems[0]?.data || quoteItems[0] || null;

        if (!tech) {
          throw new Error("无法获取技术指标数据");
        }

        const currentPrice = quote?.close ?? quote?.last ?? tech.SMA20 ?? 0;
        if (!currentPrice) throw new Error("无法获取当前价格");

        // ── 枢轴点 ──────────────────────────────────────────
        const pp = tech["Pivot.M.Classic.Middle"] || currentPrice;
        const r1 = tech["Pivot.M.Classic.R1"] || pp;
        const s1 = tech["Pivot.M.Classic.S1"] || pp;
        const hMinusL = r1 - s1;
        const r2 = pp + hMinusL;
        const s2 = pp - hMinusL;
        const r3 = r1 + hMinusL;
        const s3 = s1 - hMinusL;

        // ── 均线系统 ─────────────────────────────────────────
        const movingAverages: Record<string, number> = {};
        const maKeys: [string, string][] = [
          ["SMA20", "SMA20"], ["SMA50", "SMA50"], ["SMA200", "SMA200"],
          ["EMA20", "EMA20"], ["EMA50", "EMA50"], ["EMA200", "EMA200"],
        ];
        for (const [key, field] of maKeys) {
          if (tech[field] != null) movingAverages[key] = Math.round(tech[field] * 100) / 100;
        }

        // ── RSI ────────────────────────────────────────────
        const rsi = tech.RSI ?? 50;

        // ── MACD ────────────────────────────────────────────
        const macdValue = tech["MACD.macd"] ?? 0;
        const macdSignal = tech["MACD.signal"] ?? 0;
        const macdHist = macdValue - macdSignal;

        // ── 布林带 ──────────────────────────────────────────
        const bbUpper = tech["BB.upper"] ?? currentPrice * 1.05;
        const bbLower = tech["BB.lower"] ?? currentPrice * 0.95;
        const bbMiddle = tech.SMA20 ?? currentPrice;
        const bbBandwidth = bbMiddle ? ((bbUpper - bbLower) / bbMiddle) * 100 : 0;

        // ── 趋势判断 ────────────────────────────────────────
        const trend = determineTrend(currentPrice, movingAverages);

        // ── 关键价位 ────────────────────────────────────────
        const keyLevels = identifyKeyLevels(
          currentPrice,
          { pp, r1, r2, r3, s1, s2, s3 },
          movingAverages
        );

        // ── 成交量异常 (无法获取时不判断) ──────────────────────
        const volumeAnomaly = false;

        // ── 操作建议 ────────────────────────────────────────
        const actionPoints = generateActionPoints(
          currentPrice,
          { pp, r1, r2, r3, s1, s2, s3 },
          movingAverages,
          rsi,
          { macd: macdValue, signal: macdSignal, histogram: macdHist },
          { upper: bbUpper, middle: bbMiddle, lower: bbLower },
          trend,
          keyLevels
        );

        const result: TechnicalResult = {
          symbol,
          current_price: Math.round(currentPrice * 100) / 100,
          pivot_points: {
            pp: Math.round(pp * 100) / 100,
            r1: Math.round(r1 * 100) / 100,
            r2: Math.round(r2 * 100) / 100,
            r3: Math.round(r3 * 100) / 100,
            s1: Math.round(s1 * 100) / 100,
            s2: Math.round(s2 * 100) / 100,
            s3: Math.round(s3 * 100) / 100,
          },
          moving_averages: movingAverages,
          indicators: {
            rsi_14: Math.round(rsi * 100) / 100,
            macd: {
              value: Math.round(macdValue * 1000) / 1000,
              signal: Math.round(macdSignal * 1000) / 1000,
              histogram: Math.round(macdHist * 1000) / 1000,
            },
            bollinger: {
              upper: Math.round(bbUpper * 100) / 100,
              middle: Math.round(bbMiddle * 100) / 100,
              lower: Math.round(bbLower * 100) / 100,
              bandwidth: Math.round(bbBandwidth * 100) / 100,
            },
          },
          key_levels: keyLevels,
          trend,
          volume_anomaly: volumeAnomaly,
          action_points: actionPoints,
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

function determineTrend(
  price: number,
  ma: Record<string, number>
): "uptrend" | "downtrend" | "sideways" {
  const ma20 = ma.SMA20;
  const ma50 = ma.SMA50;

  if (!ma20 || !ma50) return "sideways";

  if (price > ma20 && ma20 > ma50) return "uptrend";
  if (price < ma20 && ma20 < ma50) return "downtrend";
  return "sideways";
}

function identifyKeyLevels(
  price: number,
  pivots: { pp: number; r1: number; r2: number; r3: number; s1: number; s2: number; s3: number },
  ma: Record<string, number>
): Array<{ price: number; type: "support" | "resistance"; strength: "strong" | "moderate" | "weak"; reason: string }> {
  const levels: Array<{ price: number; type: "support" | "resistance"; strength: "strong" | "moderate" | "weak"; reason: string }> = [];

  // 枢轴点位
  const pivotLevels: [number, string, string][] = [
    [pivots.r3, "resistance", "R3 枢轴阻力"],
    [pivots.r2, "resistance", "R2 枢轴阻力"],
    [pivots.r1, "resistance", "R1 枢轴阻力"],
    [pivots.s1, "support", "S1 枢轴支撑"],
    [pivots.s2, "support", "S2 枢轴支撑"],
    [pivots.s3, "support", "S3 枢轴支撑"],
  ];
  for (const [p, type, reason] of pivotLevels) {
    if (p > 0) {
      levels.push({ price: Math.round(p * 100) / 100, type: type as "support" | "resistance", strength: "moderate", reason });
    }
  }

  // 均线系统
  const maLevels: [string, string][] = [
    ["EMA20", "EMA20 均线"],
    ["SMA20", "SMA20 均线"],
    ["EMA50", "EMA50 均线"],
    ["SMA50", "SMA50 均线"],
    ["EMA200", "EMA200 均线"],
    ["SMA200", "SMA200 均线"],
  ];
  for (const [key, reason] of maLevels) {
    const val = ma[key];
    if (val && val > 0) {
      levels.push({
        price: Math.round(val * 100) / 100,
        type: val > price ? "resistance" : "support",
        strength: key.includes("200") ? "strong" : "moderate",
        reason,
      });
    }
  }

  // 整数关口
  const magnitude = Math.pow(10, Math.floor(Math.log10(price)));
  for (let i = -3; i <= 3; i++) {
    const rn = Math.round(price / magnitude) * magnitude + i * magnitude;
    if (rn > 0 && Math.abs(rn - price) / price < 0.1) {
      levels.push({
        price: rn,
        type: rn > price ? "resistance" : "support",
        strength: "weak",
        reason: "整数心理关口",
      });
    }
  }

  // 去重 + 按距离排序
  const unique = new Map<number, typeof levels[0]>();
  for (const l of levels) {
    const key = Math.round(l.price * 100);
    if (!unique.has(key) || unique.get(key)!.strength === "weak") {
      unique.set(key, l);
    }
  }
  return [...unique.values()]
    .sort((a, b) => Math.abs(a.price - price) - Math.abs(b.price - price))
    .slice(0, 12);
}

function generateActionPoints(
  price: number,
  pivots: { pp: number; r1: number; r2: number; r3: number; s1: number; s2: number; s3: number },
  ma: Record<string, number>,
  rsi: number,
  macd: { macd: number; signal: number; histogram: number },
  boll: { upper: number; middle: number; lower: number },
  trend: string,
  keyLevels: Array<{ price: number; type: string; strength: string; reason: string }>
): Array<{ price: number; action: "buy" | "sell" | "stop_loss" | "take_profit"; confidence: number; reason: string }> {
  const points: Array<{ price: number; action: "buy" | "sell" | "stop_loss" | "take_profit"; confidence: number; reason: string }> = [];

  if (rsi < 30) {
    points.push({
      price: Math.round(pivots.s1 * 100) / 100,
      action: "buy",
      confidence: 70,
      reason: `RSI=${rsi.toFixed(1)} 超卖，关注S1支撑位${pivots.s1.toFixed(2)}`,
    });
  }

  if (rsi > 70) {
    points.push({
      price: Math.round(pivots.r1 * 100) / 100,
      action: "sell",
      confidence: 70,
      reason: `RSI=${rsi.toFixed(1)} 超买，关注R1阻力位${pivots.r1.toFixed(2)}`,
    });
  }

  if (macd.histogram > 0 && macd.macd > macd.signal) {
    points.push({
      price: Math.round(price * 100) / 100,
      action: "buy",
      confidence: 65,
      reason: `MACD金叉，柱状图=${macd.histogram.toFixed(3)}`,
    });
  }

  if (macd.histogram < 0 && macd.macd < macd.signal) {
    points.push({
      price: Math.round(price * 100) / 100,
      action: "sell",
      confidence: 65,
      reason: `MACD死叉，柱状图=${macd.histogram.toFixed(3)}`,
    });
  }

  if (price <= boll.lower * 1.01) {
    points.push({
      price: Math.round(boll.lower * 100) / 100,
      action: "buy",
      confidence: 60,
      reason: `价格触及布林带下轨${boll.lower.toFixed(2)}`,
    });
  }

  if (price >= boll.upper * 0.99) {
    points.push({
      price: Math.round(boll.upper * 100) / 100,
      action: "sell",
      confidence: 60,
      reason: `价格触及布林带上轨${boll.upper.toFixed(2)}`,
    });
  }

  if (trend === "uptrend" && ma.SMA20) {
    points.push({
      price: Math.round(ma.SMA20 * 100) / 100,
      action: "stop_loss",
      confidence: 75,
      reason: `上升趋势中，SMA20=${ma.SMA20.toFixed(2)}作为跟踪止损`,
    });
  }

  for (const level of keyLevels) {
    if (level.type === "support" && level.strength !== "weak") {
      points.push({
        price: level.price,
        action: "buy",
        confidence: level.strength === "strong" ? 70 : 55,
        reason: `关键支撑位: ${level.reason}`,
      });
    } else if (level.type === "resistance" && level.strength !== "weak") {
      points.push({
        price: level.price,
        action: "take_profit",
        confidence: level.strength === "strong" ? 70 : 55,
        reason: `关键阻力位: ${level.reason}`,
      });
    }
  }

  return points.sort((a, b) => b.confidence - a.confidence).slice(0, 8);
}
