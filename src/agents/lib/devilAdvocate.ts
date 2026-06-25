import { ToolRegistration, AgentSignal } from "./types.js";
import { getHistory } from "./dataHub.js";

// ── 类型定义 ─────────────────────────────────────────────

interface BlindSpot {
  assumption: string;
  reality_check: string;
  risk: string;
}

interface DangerousPattern {
  detected: boolean;
  pattern: string;
  historical_analog: string;
  key_difference: string;
}

interface DevilAdvocateResult {
  agent: string;
  symbol: string;
  timestamp: string;
  narrative_audit: {
    dominant_narrative: string;
    narrative_sources: string[];
    narrative_strength: "强" | "中" | "弱";
  };
  blind_spots: BlindSpot[];
  dangerous_pattern: DangerousPattern;
  early_warnings: string[];
  data_quality: {
    agent_count: number;
    historical_samples: number;
    confidence: "high" | "medium" | "low";
  };
}

export function registerDevilAdvocate(): ToolRegistration {
  return {
    name: "devil_advocate",
    description: "危机看破者：理解叙事、识别盲点、检测危险模式、输出早期预警",
    inputSchema: {
      type: "object",
      properties: {
        symbol: { type: "string", description: "股票代码" },
        agent_signals: {
          type: "object",
          description: "各 agent 的信号（数量不定）",
          additionalProperties: {
            type: "object",
            properties: {
              distribution: {
                type: "object",
                properties: {
                  p_bullish: { type: "number" },
                  p_bearish: { type: "number" },
                  p_neutral: { type: "number" },
                },
              },
              assumptions: { type: "array", items: { type: "string" } },
              key_drivers: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    factor: { type: "string" },
                    weight: { type: "number" },
                    direction: { type: "string" },
                  },
                },
              },
              timeframe: { type: "string" },
              details: { type: "string" },
            },
          },
        },
        counter_evidence: {
          type: "object",
          description: "LLM 搜集的反证（news_sentiment, fundamental_scan 等工具的输出）",
        },
      },
      required: ["symbol", "agent_signals"],
    },
    handler: async (request: any) => {
      const args = request.params.arguments || {};
      const { symbol, agent_signals, counter_evidence } = args;

      try {
        // 1. 分析叙事
        const narrativeAudit = analyzeNarrative(agent_signals);

        // 2. 识别盲点
        const blindSpots = identifyBlindSpots(agent_signals);

        // 3. 检测危险模式
        const dangerousPattern = detectDangerousPattern(agent_signals, counter_evidence);

        // 4. 生成早期预警
        const earlyWarnings = generateEarlyWarnings(agent_signals, dangerousPattern);

        // 5. 计算数据质量
        const agentCount = Object.keys(agent_signals).length;
        let historicalSamples = 0;
        try {
          const history = getHistory(symbol, 20);
          historicalSamples = history.length;
        } catch (e) { console.error("[devilAdvocate] getHistory failed:", e); }

        const confidence = agentCount >= 5 && historicalSamples >= 5 ? "high" :
                          agentCount >= 3 || historicalSamples >= 3 ? "medium" : "low";

        const result: DevilAdvocateResult = {
          agent: "devil-advocate",
          symbol,
          timestamp: new Date().toISOString(),
          narrative_audit: narrativeAudit,
          blind_spots: blindSpots,
          dangerous_pattern: dangerousPattern,
          early_warnings: earlyWarnings,
          data_quality: {
            agent_count: agentCount,
            historical_samples: historicalSamples,
            confidence,
          },
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

// ── 分析叙事 ──────────────────────────────────────────────
function analyzeNarrative(signals: Record<string, AgentSignal>): DevilAdvocateResult["narrative_audit"] {
  const sources: string[] = [];
  let bullishCount = 0;
  let bearishCount = 0;
  const allAssumptions: string[] = [];
  const allDrivers: string[] = [];

  for (const [agent, signal] of Object.entries(signals)) {
    sources.push(agent);
    if (signal.distribution?.p_bullish != null && signal.distribution.p_bullish > 0.5) bullishCount++;
    if (signal.distribution?.p_bearish != null && signal.distribution.p_bearish > 0.5) bearishCount++;
    if (signal.assumptions) allAssumptions.push(...signal.assumptions);
    if (signal.key_drivers) {
      allDrivers.push(...signal.key_drivers.map(d => d.factor));
    }
  }

  // 提取主导叙事
  const dominantNarrative = extractDominantNarrative(allAssumptions, allDrivers, bullishCount > bearishCount);

  // 判断叙事强度
  const total = bullishCount + bearishCount;
  const agreement = Math.max(bullishCount, bearishCount) / Math.max(1, total);
  const narrativeStrength = agreement > 0.7 ? "强" : agreement > 0.5 ? "中" : "弱";

  return {
    dominant_narrative: dominantNarrative,
    narrative_sources: sources,
    narrative_strength: narrativeStrength,
  };
}

function extractDominantNarrative(assumptions: string[], drivers: string[], isBullish: boolean): string {
  // 从假设和驱动因素中提取核心叙事
  const narratives: string[] = [];

  // 分析关键词
  const hasGrowth = assumptions.some(a => a.includes("增长") || a.includes("盈利"));
  const hasRateCut = assumptions.some(a => a.includes("降息") || a.includes("宽松"));
  const hasAI = assumptions.some(a => a.includes("AI") || a.includes("人工智能"));
  const hasTrend = assumptions.some(a => a.includes("趋势") || a.includes("延续"));

  if (isBullish) {
    if (hasAI) narratives.push("AI革命推动增长");
    if (hasRateCut) narratives.push("降息预期支撑估值");
    if (hasGrowth) narratives.push("盈利增长支撑股价");
    if (hasTrend) narratives.push("趋势延续");
  } else {
    if (hasGrowth) narratives.push("增长放缓担忧");
    if (hasRateCut) narratives.push("紧缩预期压制估值");
    narratives.push("风险规避情绪");
  }

  return narratives.length > 0 ? narratives.join(" + ") : "无明确叙事";
}

// ── 识别盲点 ──────────────────────────────────────────────
function identifyBlindSpots(signals: Record<string, AgentSignal>): BlindSpot[] {
  const blindSpots: BlindSpot[] = [];
  const allAssumptions: string[] = [];

  for (const signal of Object.values(signals)) {
    if (signal.assumptions) allAssumptions.push(...signal.assumptions);
  }

  // 检查常见盲点
  const uniqueAssumptions = [...new Set(allAssumptions)];

  for (const assumption of uniqueAssumptions) {
    if (assumption.includes("降息") || assumption.includes("宽松")) {
      blindSpots.push({
        assumption: "降息/宽松预期",
        reality_check: "通胀可能具有粘性，央行可能推迟降息",
        risk: "如果降息不及预期，高估值股票将承压",
      });
    }

    if (assumption.includes("增长") || assumption.includes("盈利")) {
      blindSpots.push({
        assumption: "盈利增长预期",
        reality_check: "经济周期可能转向，增长可能放缓",
        risk: "如果盈利不及预期，股价将回调",
      });
    }

    if (assumption.includes("趋势") || assumption.includes("延续")) {
      blindSpots.push({
        assumption: "趋势延续假设",
        reality_check: "趋势反转往往突然发生，没有预警",
        risk: "如果趋势反转，可能快速下跌",
      });
    }

    if (assumption.includes("AI") || assumption.includes("人工智能")) {
      blindSpots.push({
        assumption: "AI投资回报预期",
        reality_check: "AI收入占比仍低，大部分是资本开支",
        risk: "如果AI回报不及预期，估值将大幅回调",
      });
    }
  }

  // 如果没有识别到盲点，添加通用盲点
  if (blindSpots.length === 0) {
    blindSpots.push({
      assumption: "市场共识",
      reality_check: "市场共识往往在转折点出错",
      risk: "如果共识错误，可能出现意外波动",
    });
  }

  return blindSpots;
}

// ── 检测危险模式 ──────────────────────────────────────────
function detectDangerousPattern(
  signals: Record<string, AgentSignal>,
  counterEvidence?: any
): DangerousPattern {
  const patterns: string[] = [];
  let historicalAnalog = "";
  let keyDifference = "";

  // 收集所有信号的方向
  const directions = Object.values(signals).map(s => ({
    bullish: s.distribution?.p_bullish ?? 0,
    bearish: s.distribution?.p_bearish ?? 0,
  }));

  if (directions.length === 0) {
    return {
      detected: false,
      pattern: "无明显危险模式",
      historical_analog: "无直接历史类比",
      key_difference: "需要更多数据判断",
    };
  }

  const avgBullish = directions.reduce((sum, d) => sum + (d.bullish ?? 0), 0) / directions.length;


  // 检测模式1：极端一致性
  const allBullish = directions.filter(d => (d.bullish ?? 0) > 0.6).length;
  const allBearish = directions.filter(d => (d.bearish ?? 0) > 0.6).length;

  if (allBullish >= directions.length * 0.7) {
    patterns.push("极端看多一致性");
    historicalAnalog = "2021年加密货币泡沫";
    keyDifference = "这次可能有基本面支撑，但估值仍然过高";
  }

  if (allBearish >= directions.length * 0.7) {
    patterns.push("极端看空一致性");
    historicalAnalog = "2020年3月新冠恐慌";
    keyDifference = "这次可能有实际风险，但恐慌可能过度";
  }

  // 检测模式2：高估值 + 高增长预期
  const hasHighGrowthExpectation = Object.values(signals).some(s =>
    s.assumptions?.some(a => a.includes("增长") || a.includes("盈利")) ?? false
  );

  if (hasHighGrowthExpectation && avgBullish > 0.6) {
    patterns.push("高估值 + 高增长预期");
  }

  // 检测模式3：杠杆上升
  const hasLeverage = counterEvidence?.fundamental?.debt_ratio > 0.6;
  if (hasLeverage) {
    patterns.push("杠杆上升");
  }

  // 检测模式4：散户涌入
  const hasRetailFrenzy = counterEvidence?.news?.some((n: any) =>
    n.title?.includes("散户") || n.title?.includes("开户")
  );
  if (hasRetailFrenzy) {
    patterns.push("散户涌入");
  }

  const detected = patterns.length >= 2;

  return {
    detected,
    pattern: patterns.length > 0 ? patterns.join(" + ") : "无明显危险模式",
    historical_analog: historicalAnalog || "无直接历史类比",
    key_difference: keyDifference || "需要更多数据判断",
  };
}

// ── 生成早期预警 ──────────────────────────────────────────
function generateEarlyWarnings(
  signals: Record<string, AgentSignal>,
  dangerousPattern: DangerousPattern
): string[] {
  const warnings: string[] = [];

  // 基于危险模式生成预警
  if (dangerousPattern.detected) {
    if (dangerousPattern.pattern.includes("极端看多")) {
      warnings.push("如果出现利空消息，可能引发快速回调");
      warnings.push("关注财报是否符合预期");
    }

    if (dangerousPattern.pattern.includes("极端看空")) {
      warnings.push("如果出现利好消息，可能引发快速反弹");
      warnings.push("关注是否超卖");
    }

    if (dangerousPattern.pattern.includes("高估值")) {
      warnings.push("如果增长不及预期，估值将大幅回调");
      warnings.push("关注盈利增速是否放缓");
    }
  }

  // 基于假设生成预警
  for (const signal of Object.values(signals)) {
    if (signal.assumptions) {
      for (const assumption of signal.assumptions) {
        if (assumption.includes("降息")) {
          warnings.push("关注美联储讲话和通胀数据");
        }
        if (assumption.includes("增长")) {
          warnings.push("关注财报和经济数据");
        }
      }
    }
  }

  // 去重
  return [...new Set(warnings)];
}
