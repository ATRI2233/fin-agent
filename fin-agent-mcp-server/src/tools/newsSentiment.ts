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

const SOURCE_CREDIBILITY: Record<string, number> = {
  "reuters": 0.95, "bloomberg": 0.93, "wsj": 0.90, "ft": 0.90,
  "cnbc": 0.80, "marketwatch": 0.75, "yahoo": 0.70,
  "seeking-alpha": 0.65, "benzinga": 0.60,
  "twitter": 0.30, "reddit": 0.25, "default": 0.50,
};

interface NewsItem {
  title: string;
  summary?: string;
  source: string;
  publishedAt: string;
  sentiment: "positive" | "negative" | "neutral";
  sentimentScore: number;
  relevance: number;
}

export function registerNewsSentiment(
  mcpManager: MCPClientManager
): ToolRegistration {
  return {
    name: "news_sentiment",
    description:
      "新闻情绪分析：获取指定标的的相关新闻及市场情绪评分。需要设置 FINNHUB_API_KEY 环境变量以获取实时新闻数据。未设置时将返回基础市场情绪参考。",
    inputSchema: {
      type: "object",
      properties: {
        ticker: {
          type: "string",
          description: "股票代码，如 AAPL",
        },
        hours: {
          type: "number",
          description: "回看小时数，默认 72",
          default: 72,
        },
      },
      required: ["ticker"],
    },
    handler: async (request: any) => {
      const args = request.params.arguments || {};
      const ticker = args.ticker;
      const hours = args.hours || 72;

      if (!ticker) {
        return {
          content: [{ type: "text", text: JSON.stringify({ error: "缺少 ticker 参数" }) }],
          isError: true,
        };
      }

      try {
        // ── 并行获取各数据源 ──────────────────────────────────
        const [quoteResult, fgResult, newsResult] = await Promise.allSettled([
          mcpManager.callTool("stock-scanner", "tradingview_quote", { tickers: [ticker] }, 15000),
          mcpManager.callTool("stock-scanner", "sentiment_fear_greed", {}, 15000),
          mcpManager.callTool("stock-scanner", "finnhub_company_news", { symbol: ticker }, 20000),
        ]);

        const quoteResultRaw = quoteResult.status === "fulfilled" ? quoteResult.value : null;
        const fgResultRaw = fgResult.status === "fulfilled" ? fgResult.value : null;
        const newsResultRaw = newsResult.status === "fulfilled" ? newsResult.value : null;
        const quoteItems = extractData(quoteResultRaw);
        const fgItems = extractData(fgResultRaw);
        const newsItemsRaw = extractData(newsResultRaw);
        const quote = quoteItems[0]?.data || quoteItems[0] || null;
        const fg = fgItems[0] || null;
        const rawNews = newsItemsRaw;

        const currentPrice = quote?.close || 0;
        const priceChange = quote?.change || 0;

        // ── 新闻处理 ─────────────────────────────────────────
        const newsItems: NewsItem[] = [];
        if (Array.isArray(rawNews) && rawNews.length > 0) {
          const cutoff = Date.now() - hours * 3600000;

          for (const n of rawNews) {
            const pubTime = n.datetime
              ? new Date(n.datetime * 1000).getTime()
              : n.publishedAt ? new Date(n.publishedAt).getTime() : 0;
            if (pubTime > 0 && pubTime < cutoff) continue;

            const sentiment = analyzeSentimentSimple(n.headline || n.title || "");
            const source = (n.source || n.publisher || "").toLowerCase();

            newsItems.push({
              title: n.headline || n.title || "",
              summary: n.summary || "",
              source: n.source || n.publisher || "unknown",
              publishedAt: n.datetime
                ? new Date(n.datetime * 1000).toISOString()
                : n.publishedAt || new Date().toISOString(),
              sentiment: sentiment.direction,
              sentimentScore: sentiment.score,
              relevance: 0.8,
            });
          }
        }

        // ── 情绪计算 ─────────────────────────────────────────
        let rawSentiment = 0;
        let extremeFlag = false;

        if (newsItems.length > 0) {
          let weightedSum = 0;
          let totalWeight = 0;

          for (const item of newsItems) {
            const age = (Date.now() - new Date(item.publishedAt).getTime()) / 3600000;
            const timeDecay = Math.exp(-0.693 * age / 24);
            const sourceWeight = SOURCE_CREDIBILITY[item.source.toLowerCase()] ?? 0.5;
            const weight = timeDecay * sourceWeight * item.relevance;

            weightedSum += item.sentimentScore * weight;
            totalWeight += weight;
          }

          rawSentiment = totalWeight > 0 ? weightedSum / totalWeight : 0;

          extremeFlag = Math.abs(rawSentiment) > 0.7;
        }

        const extremeDampening = extremeFlag ? 0.5 : 1.0;
        const adjustedSentiment = rawSentiment * extremeDampening;

        const sentimentDirection = rawSentiment > 0.1 ? "bullish" : rawSentiment < -0.1 ? "bearish" : "neutral";
        const priceDirection = priceChange > 0.5 ? "bullish" : priceChange < -0.5 ? "bearish" : "neutral";
        const divergenceFlag = sentimentDirection !== "neutral" && sentimentDirection !== priceDirection;

        const result: Record<string, any> = {
          symbol: ticker,
          timestamp: new Date().toISOString(),
          current_price: currentPrice,
          price_change_pct: priceChange,
          raw_sentiment: Math.round(rawSentiment * 1000) / 1000,
          adjusted_sentiment: Math.round(adjustedSentiment * 1000) / 1000,
          news_count: newsItems.length,
          top_positive: newsItems.filter((n) => n.sentimentScore > 0.3).slice(0, 3),
          top_negative: newsItems.filter((n) => n.sentimentScore < -0.3).slice(0, 3),
          max_weight_in_fusion: 0.15,
        };

        // 市场情绪上下文
        if (fg) {
          result.market_fear_greed = {
            score: fg.score,
            rating: fg.rating,
          };
        }

        if (divergenceFlag) {
          result.divergence_warning = `新闻情绪${sentimentDirection === "bullish" ? "看多" : "看空"}，但价格${priceDirection === "bullish" ? "上涨" : "下跌"}`;
        }

        if (newsItems.length === 0) {
          result._note = "未获取到实时新闻。设置 FINNHUB_API_KEY 环境变量可启用新闻情绪分析。当前仅提供基础市场情绪参考。";
          result.recommendation_signal = priceDirection;
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

function analyzeSentimentSimple(text: string): {
  direction: "positive" | "negative" | "neutral";
  score: number;
} {
  const positiveWords = [
    "surge", "rally", "beat", "exceed", "growth", "upgrade", "bullish",
    "strong", "record", "gain", "profit", "soar", "optimistic", "breakthrough",
    "上涨", "飙升", "突破", "利好", "增长", "盈利", "强劲",
  ];
  const negativeWords = [
    "crash", "plunge", "miss", "decline", "downgrade", "bearish", "weak",
    "loss", "fall", "pessimistic", "recession", "cut", "warning", "risk",
    "下跌", "暴跌", "利空", "亏损", "衰退", "风险", "警告",
  ];

  const lower = text.toLowerCase();
  let posCount = 0, negCount = 0;
  for (const w of positiveWords) if (lower.includes(w)) posCount++;
  for (const w of negativeWords) if (lower.includes(w)) negCount++;

  const total = posCount + negCount;
  if (total === 0) return { direction: "neutral", score: 0 };
  const score = (posCount - negCount) / total;
  return {
    direction: score > 0.2 ? "positive" : score < -0.2 ? "negative" : "neutral",
    score: Math.max(-1, Math.min(1, score)),
  };
}
