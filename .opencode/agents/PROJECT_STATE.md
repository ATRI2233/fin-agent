# fin-agent 项目状态存档
> 最后更新: 2026-06-06 17:00:00
>
> **维护规则**: 每次修改 agent、tool、数据库 schema 后必须更新此文件

## 目录结构

```
fin-agent/
├── .opencode/
│   ├── agents/              # 11 个 agent 定义
│   └── skills/              # 4 个技能(market-briefing, stock-deep, position-watch, fin-review)
├── agents/
│   ├── mcp/                 # MCP 服务
│   │   ├── core/            # 核心 MCP (14 tools)
│   │   ├── ashare/          # A股 MCP (7 tools)
│   │   ├── fred/            # FRED MCP (3 tools)
│   │   ├── risk/            # 风控 MCP (3 tools)
│   │   └── sec-edgar/       # SEC MCP (21 tools)
│   ├── lib/                 # 纯逻辑 MCP (9 tools)
│   │   └── dataHub.ts       # 统一数据访问层
│   ├── hapi-hub/            # 会话管理
│   └── opencode/            # OpenCode SDK
├── data/                    # SQLite 数据库
│   └── fin-agent.db
├── main/                    # Python FastAPI (工作流引擎)
└── webui/                   # React 前端
```

---

## Agent 清单 (11 个)

| # | Agent | 角色 | 模式 | 工具来源 |
|---|-------|------|------|----------|
| Orch | `fin-orchestrator` | 主编排器 | primary | 无(委派子agent) |
| 1 | `macro-scout` | 宏观环境 (利率/通胀/GDP) | subagent | core + fred + ashare |
| 2 | `sector-rotator` | 板块轮动 (资金流/赛道) | subagent | core + ashare |
| 3 | `sentiment-decoder` | 新闻情绪 (舆情/催化) | subagent | core + ashare |
| 4 | `technical-chartist` | 技术形态 (RSI/MACD) | subagent | core + ashare |
| 5 | `fundamental-auditor` | 基本面 (PE/PB/财报) | subagent | core + ashare + sec-edgar |
| 6 | `smart-money-hound` | 聪明钱 (机构/内部人) | subagent | core + ashare + risk + sec-edgar |
| 7 | `risk-gatekeeper` | 风控仓位 (VaR/凯利) | subagent | core + risk |
| 8 | `fusion-brain` | 信号融合/冲突仲裁 | subagent | core + lib |
| 9 | `devil-advocate` | 危机看破者 | subagent | core + lib + ashare |
| 10 | `memory-learner` | 经验学习/权重进化 | subagent | lib |

---

## MCP 工具清单 (57 个)

### fin-agent-mcp-server (核心, 14 tools)

| 分类 | 工具名 | 功能 |
|------|--------|------|
| Market | `market_snapshot` | 美股大盘指数 |
| Market | `sector_rotation` | 板块轮动分析 |
| Market | `fear_greed_index` | CNN 恐惧贪婪指数 |
| Technical | `technical_levels` | RSI/MACD/布林带 |
| Technical | `options_greeks` | 期权 Greeks |
| Fundamental | `fundamental_scan` | PE/ROE/负债率 |
| Fundamental | `analyst_ratings` | 分析师评级 |
| Fundamental | `earnings_calendar` | 财报日历 |
| Fundamental | `sec_filings` | SEC 文件摘要 |
| Sentiment | `news_sentiment` | 新闻情绪评分 |
| Sentiment | `commodity_prices` | 大宗商品价格 |
| Sentiment | `insider_trading` | 内部人交易 |
| Risk | `risk_gauge` | 波动率/VaR/夏普 |
| Fusion | `signal_fusion` | 概率分布融合 |

### lib-mcp-server (纯逻辑, 9 tools)

**数据访问**: 所有工具通过 `dataHub.ts` 统一访问数据库。

| 工具名 | 功能 |
|--------|------|
| `memory_recall` | 查询历史判断 |
| `memory_verify` | 验证历史判断 |
| `memory_save` | 保存分析结果 |
| `experience_summary` | 经验总结 |
| `rule_manage` | 规则增删改查 |
| `consistency_check` | 一致性校验 |
| `devil_advocate` | 危机看破者：叙事审计+危险模式检测 |
| `conflict_resolver` | 冲突检测+辩论触发 |
| `memory_learner` | 权重进化+模式提取 |

**dataHub 接口**:
```typescript
// 通用查询
query<T>(sql, ...params): T[]
queryOne<T>(sql, ...params): T | undefined
execute(sql, ...params): RunResult
transaction<T>(fn): T

// 业务方法
logAnalysis(result)
getHistory(symbol, limit)
verifyOutcome(analysisId, actualPrice)
getExperienceSummary(days)
addRule(rule, confidence)
updateRuleAccuracy(ruleId, wasCorrect)
listRules(activeOnly)
getSignalWeights()
getJudgments(symbol, limit)
getAllExperience(minConfidence)
```

### ashare-mcp-server (A股, 7 tools)

| 工具名 | 功能 |
|--------|------|
| `ashare_market_snapshot` | A股指数行情 |
| `ashare_technical_levels` | A股技术指标 |
| `ashare_quote` | A股实时行情 |
| `ashare_fundamental_scan` | A股基本面 |
| `ashare_fund_flow` | 主力资金流 |
| `ashare_lhb` | 龙虎榜 |
| `ashare_news_sentiment` | A股新闻情绪 |

### cn-macro-mcp-server (A股宏观, 7 tools) — 新增

| 工具名 | 功能 |
|--------|------|
| `cn_macro_credit` | 信贷数据：社融增量、M1/M2同比、M1-M2剪刀差 |
| `cn_macro_rates` | 利率数据：10年期国债收益率、LPR、MLF |
| `cn_macro_pmi` | PMI数据：官方制造业/非制造业PMI |
| `cn_macro_inflation` | 通胀数据：CPI同比、PPI同比 |
| `cn_macro_industry` | 工业数据：工业增加值、粗钢产量 |
| `cn_macro_northbound` | 北向资金净流入/流出 |
| `cn_macro_fx` | 人民币汇率：在岸CNY、离岸CNH |

### fred-mcp-server (美联储, 3 tools)

| 工具名 | 功能 |
|--------|------|
| `fred_series` | FRED 时序数据 |
| `fred_search` | 搜索 FRED 系列 |
| `fred_browse` | 浏览 FRED 分类 |

### risk-mcp-server (风控, 3 tools)

| 工具名 | 功能 |
|--------|------|
| `risk_gauge` | 风险指标 |
| `position_sizing` | 凯利公式仓位 |
| `institutional_flow` | 机构持仓分析 |

### sec-edgar-mcp (SEC, 21 tools)

| 工具名 | 功能 |
|--------|------|
| `get_cik_by_ticker` | ticker→CIK |
| `get_company_info` | 公司信息 |
| `search_companies` | 搜索公司 |
| `get_company_facts` | 财务事实 |
| `get_recent_filings` | 最近文件 |
| `get_filing_content` | 文件全文 |
| `get_filing_sections` | 文件章节 |
| `get_financials` | 三大报表 |
| `get_segment_data` | 分部数据 |
| `get_key_metrics` | 关键指标 |
| `compare_periods` | 跨期对比 |
| `discover_company_metrics` | 发现指标 |
| `get_xbrl_concepts` | XBRL 概念 |
| `discover_xbrl_concepts` | 发现概念 |
| `get_insider_transactions` | 内部人交易明细 |
| `get_insider_summary` | 内部人交易汇总 |
| `get_form4_details` | Form 4 详情 |
| `analyze_form4_transactions` | Form 4 分析 |
| `analyze_insider_sentiment` | 内部人情绪 |
| `analyze_8k` | 8-K 分析 |
| `sec_filings` | 文件摘要 |

---

## Agent 与 Tool 映射

```
fin-orchestrator
    └─ 委派给以下 10 个 subagent

macro-scout (7 tools)
    ├─ market_snapshot (core)
    ├─ ashare_market_snapshot (ashare)
    ├─ fred_series, fred_search, fred_browse (fred)
    ├─ commodity_prices (core)
    └─ fear_greed_index (core)

sector-rotator (4 tools)
    ├─ sector_rotation (core)
    ├─ ashare_fund_flow (ashare)
    ├─ ashare_market_snapshot (ashare)
    └─ ashare_news_sentiment (ashare)

sentiment-decoder (2 tools)
    ├─ news_sentiment (core)
    └─ ashare_news_sentiment (ashare)

technical-chartist (3 tools)
    ├─ technical_levels (core)
    ├─ ashare_technical_levels (ashare)
    └─ ashare_quote (ashare)

fundamental-auditor (20 tools)
    ├─ fundamental_scan (core)
    ├─ ashare_fundamental_scan (ashare)
    ├─ analyst_ratings, earnings_calendar (core)
    └─ sec_filings + 16个 SEC 工具 (sec-edgar)

smart-money-hound (9 tools)
    ├─ insider_trading (core)
    ├─ ashare_fund_flow, ashare_lhb (ashare)
    ├─ institutional_flow (risk)
    └─ get_insider_* + form4 系列 (sec-edgar)

risk-gatekeeper (3 tools)
    ├─ risk_gauge (core)
    ├─ position_sizing (risk)
    └─ options_greeks (core)

fusion-brain (3 tools)
    ├─ signal_fusion (core)
    ├─ consistency_check (lib)
    └─ conflict_resolver (lib) — 已实现

devil-advocate (8 tools) — 危机看破者
    ├─ devil_advocate (lib) — 核心推理
    ├─ memory_recall (lib) — 历史记录
    ├─ news_sentiment (core) — 搜集反证（按需）
    ├─ fundamental_scan (core) — 检查基本面（按需）
    ├─ technical_levels (core) — 检查技术面（按需）
    ├─ ashare_news_sentiment (ashare) — A股反证（按需）
    ├─ ashare_fundamental_scan (ashare) — A股基本面（按需）
    └─ ashare_technical_levels (ashare) — A股技术面（按需）

memory-learner (4 tools)
    ├─ memory_learner (lib) — 已实现
    ├─ memory_recall (lib)
    ├─ experience_summary (lib)
    └─ rule_manage (lib)
```

---

## 已知问题

### 缺失工具 (0 个 — 全部已实现)
| 工具 | 引用者 | 状态 |
|------|--------|------|
| `memory_learner` | memory-learner | ✅ 已实现 |
| `devil_advocate` | devil-advocate | ✅ 已实现 |
| `conflict_resolver` | fusion-brain | ✅ 已实现 |
| `memory_save` | fin-orchestrator | ✅ 已实现 |

### 待优化项

- [ ] Agent prompt 质量参差不齐
- [ ] 工具描述不够精确
- [ ] 输出格式未标准化
- [ ] 错误处理不完整
- [ ] 缺少重试/降级逻辑

---

## 数据库
**路径**: `D:\github_place\fin-agent\data\fin-agent.db`

**访问层**: `D:\github_place\fin-agent\agents\lib\dataHub.ts`

```sql
-- 分析记录
analysis_log (id, symbol, direction, confidence, key_prices, reasons, source_signals, created_at)

-- 验证结果
market_outcomes (id, analysis_id, check_date, actual_price, actual_direction, was_correct, price_deviation_pct)

-- 信号权重
signal_weights (id, signal_name, base_weight, accuracy_7d, accuracy_30d, sample_count, last_updated)

-- 经验规则
learned_rules (id, rule, confidence, source, hit_count, miss_count, active, created_at)
```

---

## 启动命令

```bash
# Windows
start.bat

# 或手动
# 1. HAPI Hub (port 3006)
# 2. FastAPI Framework (port 8000)
# 3. WebUI (port 5173)
```
