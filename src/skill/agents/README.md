# 多 Agent 角色配置（8 Agent 架构）

本目录定义了 8 个专用 agent 角色，每个 agent 聚焦单一分析维度，可被外部多 agent 框架（CrewAI、AutoGen、自建系统）消费。

## 分析框架

```
天时 → Agent 1 Macro Scout（宏观环境）
地利 → Agent 2 Sector Rotator（板块轮动）
人和 → Agent 3 Sentiment Decoder（新闻情绪）
时机 → Agent 4 Technical Chartist（技术形态）
质地 → Agent 5 Fundamental Auditor（基本面估值）
主力 → Agent 6 Smart Money Hound（聪明钱追踪）
安全 → Agent 7 Risk Gatekeeper（风控仓位）
融合 → Agent 8 Fusion Brain（投决融合）
```

## Agent 列表

| Agent | 名称 | 职责 | 工具数 |
|-------|------|------|--------|
| 1 | Macro Scout | 宏观环境侦察员 | 7 |
| 2 | Sector Rotator | 板块轮动雷达 | 4 |
| 3 | Sentiment Decoder | 新闻情绪解码器 | 2 |
| 4 | Technical Chartist | 技术形态绘图师 | 3 |
| 5 | Fundamental Auditor | 基本面估值审计师 | 20 |
| 6 | Smart Money Hound | 聪明钱追踪犬 | 9 |
| 7 | Risk Gatekeeper | 风控仓位守门员 | 3 |
| 8 | Fusion Brain | 投决融合大脑 | 6 |

## 协作流程

```
外部调度框架
  │
  ├── 并行调用 Agent 1-7（各自独立获取数据）
  │
  └── 收集结果 → 传入 Agent 8（Fusion Brain 做融合计算）→ 返回结果
```

Agent 1-7 是数据采集层，Agent 8 是计算引擎层。调度和决策权在外部框架。

## 共享工具说明

以下工具被多个 agent 共享，但使用维度不同：
- `ashare_market_snapshot` — Agent 1 看指数趋势，Agent 2 看板块涨跌
- `ashare_fund_flow` — Agent 2 看板块资金，Agent 6 看个股主力
- `ashare_news_sentiment` — Agent 2 看行业新闻，Agent 3 看个股舆情

## 工具到 Agent 映射

### Agent 1 — Macro Scout
`market_snapshot`, `ashare_market_snapshot`, `fred_series`, `commodity_prices`, `fear_greed_index`, `fred_search`, `fred_browse`

### Agent 2 — Sector Rotator
`sector_rotation`, `ashare_fund_flow`, `ashare_market_snapshot`, `ashare_news_sentiment`

### Agent 3 — Sentiment Decoder
`news_sentiment`, `ashare_news_sentiment`

### Agent 4 — Technical Chartist
`technical_levels`, `ashare_technical_levels`, `ashare_quote`

### Agent 5 — Fundamental Auditor
`fundamental_scan`, `ashare_fundamental_scan`, `analyst_ratings`, `earnings_calendar`, `sec_filings`, `get_cik_by_ticker`, `get_company_info`, `search_companies`, `get_company_facts`, `get_recent_filings`, `get_filing_content`, `analyze_8k`, `get_filing_sections`, `get_financials`, `get_segment_data`, `get_key_metrics`, `compare_periods`, `discover_company_metrics`, `get_xbrl_concepts`, `discover_xbrl_concepts`

### Agent 6 — Smart Money Hound
`ashare_fund_flow`, `ashare_lhb`, `insider_trading`, `institutional_flow`, `get_insider_transactions`, `get_insider_summary`, `get_form4_details`, `analyze_form4_transactions`, `analyze_insider_sentiment`

### Agent 7 — Risk Gatekeeper
`risk_gauge`, `position_sizing`, `options_greeks`

### Agent 8 — Fusion Brain（融合计算引擎，非调度者）
`signal_fusion`, `consistency_check`, `memory_recall`, `memory_verify`, `experience_summary`, `rule_manage`

## 暂未编入 Agent 的工具

- `get_recommended_tools` — 元工具（推荐用哪些工具），后续按需分配

## 使用方式

外部多 agent 框架可直接读取这些 `.md` 文件作为 agent 定义。每个文件包含 frontmatter（name/description/role）、System Prompt、工具白名单、输出格式、协作接口和职责边界。
