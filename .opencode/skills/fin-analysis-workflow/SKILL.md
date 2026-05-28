---
name: fin-analysis-workflow
description: 金融分析多代理协作工作流 - 8代理并行分析+融合引擎，覆盖宏观/板块/情绪/技术/基本面/聪明钱/风控七维度，输出结构化投资决策
author: financial_stock
status: published
updated: '2026-05-28'
version: 1.0.0
tag: skill
type: skill
---

# 金融分析多代理协作工作流（Fin Analysis Workflow）

8 个专业代理各司其职，并行采集数据，最后由融合引擎输出投资决策。

## When to Use

- 用户输入股票代码，要求分析或投资建议
- 用户问"现在能不能买""帮我看看这只股票"
- 用户要求多维度分析（技术面、基本面、情绪面等）
- 用户问大盘环境、板块轮动、市场情绪

## What It Does

1. 识别用户输入的股票代码和市场类型
2. 并行调用 Agent 1-7 收集七维度数据
3. 将结果传入 Agent 8（Fusion Brain）做加权融合
4. 输出结构化的投资分析报告

## Agent 架构

| Agent | 名称 | 职责 | 模式 |
|-------|------|------|------|
| Agent 1 | macro-scout | 宏观环境侦察 | subagent |
| Agent 2 | sector-rotator | 板块轮动雷达 | subagent |
| Agent 3 | sentiment-decoder | 新闻情绪解码 | subagent |
| Agent 4 | technical-chartist | 技术形态绘图 | subagent |
| Agent 5 | fundamental-auditor | 基本面估值审计 | subagent |
| Agent 6 | smart-money-hound | 聪明钱追踪 | subagent |
| Agent 7 | risk-gatekeeper | 风控仓位守门 | subagent |
| Agent 8 | fusion-brain | 融合计算引擎 | subagent |

## How to Use

### 触发方式

用户输入股票代码即触发完整分析流程：

```
分析 AAPL
帮我看看 600036
现在适合买特斯拉吗
```

### 市场识别逻辑

根据股票代码格式自动判断市场：

| 代码格式 | 市场 | 示例 |
|----------|------|------|
| 纯数字 | A 股（CN） | 600036、000001、300750 |
| 字母开头 | 美股（US） | AAPL、TSLA、MSFT |
| 无代码 | 询问用户 | "请输入股票代码" |

### 完整工作流

#### Step 1：识别输入

解析用户输入，提取股票代码和市场类型：

```
输入: "分析 600036"
→ symbol: "600036"
→ market: "CN"

输入: "帮我看看 AAPL"
→ symbol: "AAPL"
→ market: "US"
```

#### Step 2：并行调用 Agent 1-7

同时发起 7 个子代理调用。每个代理独立运行，互不依赖。

**task() 调用示例：**

```typescript
// 并行调用 7 个代理
task(subagent_type="macro-scout", prompt="分析当前宏观环境，股票代码: AAPL，市场: US", run_in_background=true)
task(subagent_type="sector-rotator", prompt="分析板块轮动，股票代码: AAPL，市场: US", run_in_background=true)
task(subagent_type="sentiment-decoder", prompt="分析新闻情绪，股票代码: AAPL，市场: US", run_in_background=true)
task(subagent_type="technical-chartist", prompt="分析技术形态，股票代码: AAPL，市场: US", run_in_background=true)
task(subagent_type="fundamental-auditor", prompt="分析基本面估值，股票代码: AAPL，市场: US", run_in_background=true)
task(subagent_type="smart-money-hound", prompt="追踪聪明钱动向，股票代码: AAPL，市场: US", run_in_background=true)
task(subagent_type="risk-gatekeeper", prompt="计算风控指标，股票代码: AAPL，市场: US", run_in_background=true)
```

**A 股示例：**

```typescript
task(subagent_type="macro-scout", prompt="分析当前宏观环境，股票代码: 600036，市场: CN", run_in_background=true)
task(subagent_type="sector-rotator", prompt="分析板块轮动，股票代码: 600036，市场: CN", run_in_background=true)
task(subagent_type="sentiment-decoder", prompt="分析新闻情绪，股票代码: 600036，市场: CN", run_in_background=true)
task(subagent_type="technical-chartist", prompt="分析技术形态，股票代码: 600036，市场: CN", run_in_background=true)
task(subagent_type="fundamental-auditor", prompt="分析基本面估值，股票代码: 600036，市场: CN", run_in_background=true)
task(subagent_type="smart-money-hound", prompt="追踪聪明钱动向，股票代码: 600036，市场: CN", run_in_background=true)
task(subagent_type="risk-gatekeeper", prompt="计算风控指标，股票代码: 600036，市场: CN", run_in_background=true)
```

#### Step 3：收集结果

等待所有 7 个代理返回结构化 JSON 数据。每个代理的输出格式见下方"代理输出格式"章节。

#### Step 4：调用 Fusion Brain

将收集到的 7 个信号整合为 Fusion Brain 的输入格式：

```typescript
task(subagent_type="fusion-brain", prompt=`融合以下信号数据：
{
  "symbol": "AAPL",
  "signals": {
    "macro": ${macro_result},
    "sector": ${sector_result},
    "sentiment": ${sentiment_result},
    "technical": ${technical_result},
    "fundamental": ${fundamental_result},
    "smart_money": ${smart_money_result},
    "risk": ${risk_result}
  }
}`, run_in_background=false)
```

#### Step 5：输出最终报告

将 Fusion Brain 的融合结果格式化后返回给用户。

## 代理输出格式

### Agent 1 - Macro Scout

```json
{
  "agent": "macro-scout",
  "market_regime": "bull|oscillation|bear",
  "trend": "bullish_alignment|bearish_alignment|no_trend",
  "macro_heatmap": {
    "interest_rate": {"value": 4.35, "signal": "tight|neutral|loose"},
    "inflation": {"cpi_yoy": 3.2, "signal": "high|moderate|low"},
    "employment": {"unemployment": 3.8, "signal": "strong|moderate|weak"},
    "commodities": {"oil_wti": 78.5, "gold": 2350, "signal": "inflationary|neutral|deflationary"}
  },
  "fear_greed": {"value": 65, "label": "Greed", "trend": "rising|falling|stable"},
  "trading_env_advice": "heavy|light|watch_only"
}
```

### Agent 2 - Sector Rotator

```json
{
  "agent": "sector-rotator",
  "rotation_phase": "launch|acceleration|climax|retreat|chaos",
  "style": "value|growth|cyclical|defensive|mixed",
  "top_sectors": [{"rank": 1, "name": "板块名", "change_pct": 2.5}],
  "bottom_sectors": [{"rank": 1, "name": "板块名", "change_pct": -1.5}],
  "recommended_tracks": ["推荐赛道"],
  "avoid_tracks": ["回避赛道"]
}
```

### Agent 3 - Sentiment Decoder

```json
{
  "agent": "sentiment-decoder",
  "sentiment_score": 45,
  "sentiment_range": "-100 ~ +100",
  "hot_events": [{"headline": "事件", "impact": "positive|negative|neutral", "urgency": "realtime|today|recent"}],
  "divergence_warning": {"has_divergence": false, "type": "情绪极值但价格未动"}
}
```

### Agent 4 - Technical Chartist

```json
{
  "agent": "technical-chartist",
  "trend_rating": "strong_bull|bull|oscillation|bear|strong_bear",
  "key_levels": {"resistance_2": 200, "resistance_1": 195, "pivot": 190, "support_1": 185, "support_2": 180},
  "indicators": {
    "rsi_14": 58.3,
    "macd": {"value": 1.2, "signal": 0.8, "histogram": 0.4, "cross": "golden|dead|none"},
    "bollinger": {"upper": 195, "middle": 188, "lower": 181, "state": "expanding|contracting|normal"},
    "ema": {"ema20": 187, "ema50": 182, "ema200": 175, "alignment": "bullish|bearish|mixed"}
  },
  "suggested_action": "buy|hold|reduce|sell",
  "trigger_condition": "突破195买入 / 跌破185止损"
}
```

### Agent 5 - Fundamental Auditor

```json
{
  "agent": "fundamental-auditor",
  "fundamental_score": 78,
  "radar_chart": {
    "profitability": 85,
    "growth": 72,
    "financial_safety": 80,
    "operational_efficiency": 75,
    "cash_flow": 70
  },
  "valuation": {"pe_ttm": 28.5, "pb": 45.2, "percentile": 55, "label": "合理（30-70%）"},
  "analyst_consensus": {"rating": "Buy", "target_price_median": 210, "upside_pct": 0.12},
  "earnings_alert": {"upcoming": false, "earnings_date": null}
}
```

### Agent 6 - Smart Money Hound

```json
{
  "agent": "smart-money-hound",
  "fund_flow": {"direction": "持续流入|间歇流入|流出|无方向", "net_inflow_5d": 500000000},
  "institutional": {"holding_pct": 0.62, "change_qoq": -0.02},
  "insider": {"signal": "强烈买入|中性|警示", "net_transactions": -2},
  "lhb": {"has_lhb": true, "pattern": "游资主导|机构主导|混合|无龙虎榜"}
}
```

### Agent 7 - Risk Gatekeeper

```json
{
  "agent": "risk-gatekeeper",
  "risk_level": "R1|R2|R3|R4|R5",
  "risk_metrics": {
    "volatility_20d_annualized": 0.25,
    "drawdown_from_52w_high": -0.08,
    "var_95_10d": -0.05,
    "sharpe_ratio": 1.2
  },
  "position_advice": {"kelly_fraction": 0.15, "half_kelly_pct": 8, "max_loss_per_trade_pct": 2},
  "stop_loss": {"technical": 185, "volatility": 178, "time": "持有超过30天未达目标则退出"},
  "hedge": {"needed": true, "suggestion": "买入保护性Put", "cost_pct": 1.5}
}
```

### Agent 8 - Fusion Brain 输出

```json
{
  "engine": "fusion-brain",
  "symbol": "AAPL",
  "composite_score": 45,
  "score_range": "-100 ~ +100",
  "direction": "strong_bull|bull|neutral|bear|strong_bear",
  "confidence_level": "high|medium|low",
  "signal_breakdown": {
    "macro": {"score": 60, "weight": 0.10, "contribution": 6.0},
    "sector": {"score": 55, "weight": 0.0, "contribution": 0},
    "sentiment": {"score": 45, "weight": 0.10, "contribution": 4.5},
    "technical": {"score": 70, "weight": 0.35, "contribution": 24.5},
    "fundamental": {"score": 78, "weight": 0.30, "contribution": 23.4},
    "smart_money": {"score": 50, "weight": 0.05, "contribution": 2.5},
    "risk": {"score": 60, "weight": 0.10, "contribution": 6.0}
  },
  "consistency": {
    "vs_last": "same|flipped|first_time",
    "last_direction": "bullish",
    "historical_match": "matches_success|matches_failure|no_reference"
  },
  "conflicts": {
    "has_conflict": false,
    "description": null,
    "degradation_applied": null
  },
  "position_suggestion": {
    "action": "buy|sell|hold|watch",
    "position_pct": 8,
    "stop_loss": 185,
    "reason": "多维度共振看多，技术面+基本面一致"
  }
}
```

## 最终输出格式

返回给用户的结构化报告：

```json
{
  "orchestrator": "fin-orchestrator",
  "timestamp": "2026-05-28T09:30:00Z",
  "symbol": "AAPL",
  "market": "US|CN",
  "analysis": {
    "macro": {},
    "sector": {},
    "sentiment": {},
    "technical": {},
    "fundamental": {},
    "smart_money": {},
    "risk": {}
  },
  "fusion": {},
  "summary": {
    "direction": "strong_bull|bull|neutral|bear|strong_bear",
    "confidence": "high|medium|low",
    "action": "buy|sell|hold|watch",
    "position_pct": 8,
    "stop_loss": 185,
    "reason": "多维度共振看多，技术面+基本面一致"
  }
}
```

## 融合权重（默认）

| 信号源 | 权重 |
|--------|------|
| technical | 35% |
| fundamental | 30% |
| sentiment | 10% |
| macro | 10% |
| risk (options) | 10% |
| smart_money | 5% |

权重可通过 Fusion Brain 的 `rule_manage` 工具动态调整。

## 信号冲突降级规则

| 冲突场景 | 降级 |
|---------|------|
| 技术看多 + 聪明钱看空 | 降级为"轻仓观望" |
| 技术看空 + 聪明钱看多 | 降级为"轻仓持有" |
| 72h 内方向翻转 >= 2 次 | 置信度 x 0.7 |
| 技术与聪明钱方向冲突 | 置信度上限 0.6 |

## 风险等级定义

| 等级 | 条件 | 仓位上限 |
|------|------|---------|
| R1（低） | 波动率 < 20%，回撤 < 5% | 15% |
| R2 | 波动率 20-30%，回撤 5-8% | 12% |
| R3 | 波动率 30-40%，回撤 8-15% | 8% |
| R4 | 波动率 40-50%，回撤 15-25% | 4% |
| R5（极高） | 波动率 > 50%，回撤 > 25% | 0%（建议空仓） |

## 错误处理

### 代理超时或失败

- 单个代理超时或失败 → 标记该维度为 `null`，继续执行
- 多于 3 个代理失败 → 终止分析，提示用户稍后重试
- Fusion Brain 失败 → 返回原始 7 个信号的汇总，不做融合

### 数据缺失

- 某个维度无数据 → 该维度权重按比例分配给其他维度
- 市场休市 → 使用最近交易日数据，标注数据日期

### 无效输入

- 无法识别股票代码 → 提示用户重新输入
- 股票代码不存在 → 提示用户检查代码

## 示例对话

### 示例 1：美股分析

```
用户: 分析 AAPL

系统:
1. 识别: symbol=AAPL, market=US
2. 并行调用 Agent 1-7
3. 收集结果，调用 Fusion Brain
4. 输出:

{
  "symbol": "AAPL",
  "market": "US",
  "summary": {
    "direction": "bull",
    "confidence": "high",
    "action": "buy",
    "position_pct": 8,
    "stop_loss": 185,
    "reason": "技术面金叉+基本面估值合理+聪明钱持续流入"
  }
}
```

### 示例 2：A 股分析

```
用户: 帮我看看 600036

系统:
1. 识别: symbol=600036, market=CN
2. 并行调用 Agent 1-7（使用 A 股工具）
3. 收集结果，调用 Fusion Brain
4. 输出:

{
  "symbol": "600036",
  "market": "CN",
  "summary": {
    "direction": "neutral",
    "confidence": "medium",
    "action": "hold",
    "position_pct": 5,
    "stop_loss": 35.2,
    "reason": "技术面震荡+基本面估值偏高+板块轮动不在主线"
  }
}
```

## 注意事项

- 每次分析必须走完 7+1 流程（7 个数据代理 + 1 个融合引擎）
- 代理之间不做数据传递，各自独立采集
- 融合引擎只做计算，不做数据获取
- 最终决策权在用户，系统只提供建议
- 所有代理已定义在 `.opencode/agents/` 目录，无需手动配置
