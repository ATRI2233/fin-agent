# fin-agent 项目状态存档
> 最后更新: 2026-06-08 10:00:00
>
> **维护规则**: 每次修改 agent、tool、数据库 schema 后必须更新此文件

## 目录结构

```
fin-agent/
├── .opencode/
│ ├── agents/ # 11 个 agent 定义
│ └── skills/ # 4 个技能(market-briefing, stock-deep, position-watch, fin-review)
├── agents/
│ ├── mcp/ # MCP 服务
│ │ ├── core/ # 核心 MCP (14 tools)
│ │ ├── ashare/ # A股 MCP (10 tools)
│ │ ├── fred/ # FRED MCP (3 tools)
│ │ ├── risk/ # 风控 MCP (3 tools)
│ │ ├── cn-macro/ # 中国宏观 MCP (7 tools)
│ │ └── sec-edgar/ # SEC MCP (5 tools)
│ ├── lib/ # 纯逻辑 MCP (9 tools)
│ │ └── dataHub.ts # 统一数据访问层
│ ├── hapi-hub/ # 会话管理
│ └── opencode/ # OpenCode SDK
├── data/ # SQLite 数据库
│ └── fin-agent.db
├── main/ # Python FastAPI (工作流引擎)
└── webui/ # React 前端
```

---


---

## MCP 工具清单 (51 个，按服务器分类)

### 1. ashare-mcp-server (A股数据，10 tools) — Python/akshare

| # | 分类 | 工具名 | 功能 | 状态 |
|---|------|--------|------|------|
| 1 | 行情 | `ashare_quote` | A股实时行情：价格/涨跌幅/成交量 | ✅ |
| 2 | 技术 | `ashare_technical_levels` | A股技术指标：RSI/EMA/布林带/MACD/枢轴点/波动率 | ✅ |
| 3 | 基本面 | `ashare_fundamental_scan` | A股基本面：ROE/净利润/营收/PE/PB/每股收益/股息率 | ✅ |
| 4 | 情绪 | `ashare_news_sentiment` | A股新闻及情绪评分（个股+市场加权） | ✅ |
| 5 | 行情 | `ashare_market_snapshot` | A股大盘指数（上证/深证/创业板/沪深300/科创50等） | ✅ |
| 6 | 资金 | `ashare_fund_flow` | 个股资金流向（超大单/大单/中单/小单净流入） | ✅ |
| 7 | 资金 | `ashare_lhb` | 龙虎榜数据（最近上榜股票） | ✅ |
| 8 | 轮动 | `ashare_sector_rotation` | A股板块轮动分析：行业板块涨跌幅排名、动量信号 | ✅ |
| 9 | 资金 | `ashare_fund_flow_real` | 个股实时资金流向：主力/超大单/大单/中单/小单净流入与净占比 | ✅ |
| 10 | 情绪 | `ashare_market_breadth` | A股市场广度：涨跌家数、涨停/跌停、市场情绪 | ✅ |

### 2. cn-macro-mcp-server (中国宏观，7 tools) — Python/akshare

| # | 分类 | 工具名 | 功能 | 状态 |
|---|------|--------|------|------|
| 1 | 宏观 | `cn_macro_credit` | 信贷数据：社融增量、M1/M2同比、M1-M2剪刀差 | ✅ |
| 2 | 宏观 | `cn_macro_rates` | 利率数据：10年期国债收益率、LPR、MLF、SHIBOR | ✅ |
| 3 | 宏观 | `cn_macro_pmi` | PMI数据：官方制造业/非制造业PMI、财新制造业PMI | ✅ |
| 4 | 宏观 | `cn_macro_inflation` | 通胀数据：CPI同比、PPI同比、CPI-PPI剪刀差 | ✅ |
| 5 | 宏观 | `cn_macro_industry` | 工业数据：工业增加值、粗钢产量 | ✅ |
| 6 | 资金 | `cn_macro_northbound` | 北向资金净流入/流出 | ✅ |
| 7 | 宏观 | `cn_macro_fx` | 人民币汇率：在岸CNY、离岸CNH | ✅ |

### 3. fin-agent-mcp-server (核心美股，14 tools) — TypeScript

| # | 分类 | 工具名 | 功能 | 状态 |
|---|------|--------|------|------|
| 1 | 行情 | `market_snapshot` | 美股大盘指数 | ✅ |
| 2 | 轮动 | `sector_rotation` | 板块轮动分析 | ✅ |
| 3 | 情绪 | `fear_greed_index` | CNN 恐惧贪婪指数 | ✅ |
| 4 | 技术 | `technical_levels` | RSI/MACD/布林带 | ✅ |
| 5 | 衍生品 | `options_greeks` | 期权 Greeks (Delta/Gamma/Theta/Vega/Rho) | ✅ |
| 6 | 基本面 | `fundamental_scan` | PE/ROE/负债率 | ✅ |
| 7 | 基本面 | `analyst_ratings` | 分析师评级/目标价 | ✅ |
| 8 | 基本面 | `earnings_calendar` | 财报日历 | ✅ |
| 9 | 基本面 | `sec_filings` | SEC 文件摘要 | ✅ |
| 10 | 情绪 | `news_sentiment` | 新闻情绪评分 | ✅ |
| 11 | 行情 | `commodity_prices` | 大宗商品价格 | ✅ |
| 12 | 资金 | `insider_trading` | 内部人交易 | ✅ |
| 13 | 风控 | `risk_gauge` | 波动率/VaR/夏普 | ✅ |
| 14 | 融合 | `signal_fusion` | 概率分布融合 | ✅ |

### 4. lib-mcp-server (纯逻辑，9 tools) — TypeScript

| # | 分类 | 工具名 | 功能 | 状态 |
|---|------|--------|------|------|
| 1 | 记忆 | `memory_recall` | 查询历史判断 | ✅ |
| 2 | 记忆 | `memory_verify` | 验证历史判断 | ✅ |
| 3 | 记忆 | `memory_save` | 保存分析结果 | ✅ |
| 4 | 记忆 | `experience_summary` | 经验总结 | ✅ |
| 5 | 记忆 | `rule_manage` | 规则增删改查 | ✅ |
| 6 | 分析 | `consistency_check` | 逻辑一致性检查 | ✅ |
| 7 | 分析 | `devil_advocate` | 魔鬼代言人：反方论点生成 | ✅ |
| 8 | 分析 | `conflict_resolver` | 冲突检测+辩论触发 | ✅ |
| 9 | 记忆 | `memory_learner` | 权重进化+模式提取 | ✅ |

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

### 5. fred-mcp-server (美联储宏观，3 tools) — TypeScript

| # | 分类 | 工具名 | 功能 | 状态 |
|---|------|--------|------|------|
| 1 | 宏观 | `fred_search` | 搜索 FRED 经济数据序列 | ✅ |
| 2 | 宏观 | `fred_get_series` | 获取 FRED 时序数据 | ✅ |
| 3 | 宏观 | `fred_browse` | 浏览 FRED 分类/发布/来源 | ✅ |

### 6. risk-mcp-server (风控计算，3 tools) — Python/yfinance

| # | 分类 | 工具名 | 功能 | 状态 |
|---|------|--------|------|------|
| 1 | 风控 | `risk_gauge` | 风险指标：20/60日波动率、52周回撤、95% VaR | ✅ |
| 2 | 风控 | `position_sizing` | 仓位计算：凯利公式+波动率目标 | ✅ |
| 3 | 风控 | `institutional_flow` | 机构持仓分析（13F数据） | ✅ |

### 7. sec-edgar-mcp (SEC财报，5 tools) — Python/edgartools

| # | 分类 | 工具名 | 功能 | 状态 |
|---|------|--------|------|------|
| 1 | 公司 | `sec_company_search` | 搜索 SEC EDGAR 公司信息 | ✅ |
| 2 | 文件 | `sec_filings_search` | 搜索 SEC 财报文件 | ✅ |
| 3 | 文件 | `sec_filing_content` | 获取 SEC 财报内容 | ✅ |
| 4 | 财务 | `sec_financial_data` | 获取 SEC 财务数据 | ✅ |
| 5 | 财务 | `sec_company_facts` | 获取公司 XBRL 财务事实数据 | ✅ |

---

## 按功能分类汇总 (51 tools)

### 行情类 (4 tools)
| 工具 | 服务器 | 功能 |
|------|--------|------|
| `ashare_quote` | ashare | A股实时行情 |
| `ashare_market_snapshot` | ashare | A股大盘指数 |
| `market_snapshot` | core | 美股大盘指数 |
| `commodity_prices` | core | 大宗商品价格 |

### 技术类 (3 tools)
| 工具 | 服务器 | 功能 |
|------|--------|------|
| `ashare_technical_levels` | ashare | A股技术指标 |
| `technical_levels` | core | 美股技术指标 |
| `options_greeks` | core | 期权Greeks |

### 基本面类 (8 tools)
| 工具 | 服务器 | 功能 |
|------|--------|------|
| `ashare_fundamental_scan` | ashare | A股基本面 |
| `fundamental_scan` | core | 美股基本面 |
| `analyst_ratings` | core | 分析师评级 |
| `earnings_calendar` | core | 财报日历 |
| `sec_filings` | core | SEC文件摘要 |
| `sec_company_search` | sec-edgar | 搜索SEC公司 |
| `sec_filings_search` | sec-edgar | 搜索SEC财报 |
| `sec_filing_content` | sec-edgar | SEC财报内容 |
| `sec_financial_data` | sec-edgar | SEC财务数据 |

### 情绪类 (5 tools)
| 工具 | 服务器 | 功能 |
|------|--------|------|
| `ashare_news_sentiment` | ashare | A股新闻情绪 |
| `ashare_market_breadth` | ashare | A股市场广度 |
| `news_sentiment` | core | 美股新闻情绪 |
| `fear_greed_index` | core | 恐惧贪婪指数 |
| `insider_trading` | core | 内部人交易追踪 |

### 资金/轮动类 (7 tools)
| 工具 | 服务器 | 功能 |
|------|--------|------|
| `ashare_fund_flow` | ashare | 个股资金流向 |
| `ashare_fund_flow_real` | ashare | 个股实时资金流向 |
| `ashare_lhb` | ashare | 龙虎榜 |
| `ashare_sector_rotation` | ashare | A股板块轮动 |
| `sector_rotation` | core | 美股板块轮动 |
| `cn_macro_northbound` | cn-macro | 北向资金 |

### 宏观类 (10 tools)
| 工具 | 服务器 | 功能 |
|------|--------|------|
| `cn_macro_credit` | cn-macro | 中国信贷数据 |
| `cn_macro_rates` | cn-macro | 中国利率数据 |
| `cn_macro_pmi` | cn-macro | 中国PMI |
| `cn_macro_inflation` | cn-macro | 中国通胀 |
| `cn_macro_industry` | cn-macro | 中国工业数据 |
| `cn_macro_fx` | cn-macro | 人民币汇率 |
| `fred_search` | fred | 搜索FRED序列 |
| `fred_get_series` | fred | FRED时序数据 |
| `fred_browse` | fred | 浏览FRED分类 |

### 风控类 (4 tools)
| 工具 | 服务器 | 功能 |
|------|--------|------|
| `risk_gauge` | core/risk | 波动率/VaR/回撤 |
| `position_sizing` | risk | 凯利公式仓位 |
| `institutional_flow` | risk | 机构持仓分析 |

### 融合/分析类 (4 tools)
| 工具 | 服务器 | 功能 |
|------|--------|------|
| `signal_fusion` | core | 多信号融合 |
| `consistency_check` | lib | 一致性检查 |
| `conflict_resolver` | lib | 冲突解决 |
| `devil_advocate` | lib | 魔鬼代言人 |

### 记忆类 (6 tools)
| 工具 | 服务器 | 功能 |
|------|--------|------|
| `memory_recall` | lib | 查询历史判断 |
| `memory_verify` | lib | 验证历史判断 |
| `memory_save` | lib | 保存分析结果 |
| `experience_summary` | lib | 经验总结 |
| `rule_manage` | lib | 规则管理 |
| `memory_learner` | lib | 权重进化+模式提取 |

### SEC-EDGAR 专用 (5 tools)
| 工具 | 功能 |
|------|------|
| `sec_company_search` | 搜索SEC公司 |
| `sec_filings_search` | 搜索SEC财报 |
| `sec_filing_content` | 财报内容 |
| `sec_financial_data` | 财务数据 |
| `sec_company_facts` | XBRL财务事实 |

---

## Agent 与 Tool 映射

### fin-orchestrator
- 可用工具: memory_recall, memory_save, memory_verify, experience_summary, rule_manage（均为记忆工具）
- 调用逻辑（3 步流程）:
  1. **数据收集**：先查记忆 memory_recall 看历史分析，灵活决定调用哪些子 agent（全面分析可调大部分，快速判断只调核心），多个子 agent 并行调用（run_in_background=true），有依赖关系时串行
  2. **分析判断**：从各子 agent 收集方向、置信度、narrative、key_points；与历史记忆对比；融合多 agent 信号形成综合判断
  3. **叙事输出**：输出 Markdown 格式的综合分析（含 #/##/### 层级、粗体、代码块、表格），调用 memory_save 存储结果；可选 experience_summary 总结经验，rule_manage 管理规则
- 决策权: 决定调用哪些 agent、是否查记忆、是否追问用户、输出详细程度、是否存记忆

### macro-scout
- 可用工具: market_snapshot（必用-美股）, ashare_market_snapshot（必用-A股）, fred_series（常用）, fred_search（常用）, fred_category（按需）, commodity_prices（常用）, fear_greed_index（常用）, cn_macro_credit（必用-A股）, cn_macro_rates（必用-A股）, cn_macro_pmi（常用）, cn_macro_inflation（常用）, cn_macro_industry（按需）, cn_macro_northbound（常用）, cn_macro_fx（按需）
- 市场路由:
  - 美股（字母代码如 AAPL）→ market_snapshot + fred_series + commodity_prices + fear_greed_index
  - A股（数字代码如 600519）→ ashare_market_snapshot + cn_macro_* 系列
  - 大盘/全局 → 两个都调用
- 调用逻辑（3 步流程）:
  1. **数据收集**：根据市场路由调用对应工具，获取大盘/经济/流动性/情绪/大宗等宏观数据
  2. **分析判断**：填入三维框架（流动性/盈利/风险偏好），分析边际变化，定位经济周期阶段
  3. **叙事输出**：输出 trading_env_advice、downstream_directives、narrative 字段，标注 macro_blind
- 错误处理: fred_series 失败时用 market_snapshot + fear_greed_index 推断；A股宏观数据缺失时输出 macro_blind: true，置信度上限 0.4

### sector-rotator
- 可用工具: sector_rotation（必用-美股）, ashare_fund_flow（必用-A股）, ashare_market_snapshot（常用）, ashare_news_sentiment（按需-验证用）
- 市场路由:
  - 美股 → sector_rotation
  - A股 → ashare_fund_flow + ashare_market_snapshot
  - 大盘/全局 → 两个都调用
- 调用逻辑（3 步流程）:
  1. **数据收集**：根据市场路由获取板块资金流向、涨跌幅、行业舆情等数据
  2. **分析判断**：判断轮动阶段（launch/acceleration/climax/retreat/chaos），识别资金流向因果（rotation / independent_divergence）
  3. **叙事输出**：输出 recommended_tracks、avoid_tracks（带理由）、narrative，标注 position（has_view/no_view）
- 错误处理: ashare_fund_flow 失败时用 ashare_market_snapshot 板块涨跌作 proxy，confidence 下调 0.2；多个工具失败时输出 regime: "chaos"，recommended_tracks: []

### sentiment-decoder
- 可用工具: finnhub_company_news（US个股深度）, finnhub_market_news（US大盘深度）, finnhub_quote（US个股实时价格）, fear_greed_index（US恐惧贪婪指数）, stock_news_em（CN个股深度）, np-anotice-stock（CN公司公告）, stock_info_global_em（CN大盘深度）, stock_info_global_cls（CN财联社快讯辅助）
- 市场路由:
  - US个股（字母代码）→ finnhub_company_news + finnhub_market_news + quote + fear_greed
  - US大盘 → finnhub_market_news + fear_greed
  - CN个股（数字代码）→ stock_news_em + stock_info_global_em
  - CN大盘 → stock_info_global_em + stock_info_global_cls
- 调用逻辑（3 步流程）:
  1. **数据收集**：第一层判断 US/CN，第二层判断个股/大盘，调用对应工具组合获取新闻、公告、情绪评分
  2. **分析判断**：加权情绪 = 0.7 × 个股情绪 + 0.3 × 大盘情绪，识别情绪与价格的分歧
  3. **叙事输出**：直接基于工具返回数据，输出 weighted_sentiment、divergence_warning、narrative 字段，**不补充未在工具中出现的字段**
- 错误处理: 工具失败或 news_count == 0 时输出 data_unavailable: true

### technical-chartist
- 可用工具（8 个）: technical_levels, ashare_technical_levels, ashare_quote, market_snapshot, ashare_market_snapshot, fear_greed_index, ashare_fund_flow, options_greeks
  - **核心 1 个**：`technical_levels` / `ashare_technical_levels`（核心指标）
  - **市场环境 2 个**：`market_snapshot`（美股大盘）、`ashare_market_snapshot`（A股大盘）
  - **情绪 1 个**：`fear_greed_index`
  - **量能 1 个**：`ashare_fund_flow`（A股资金流向）
  - **价格基础 1 个**：`ashare_quote`（A股实时行情）
  - **期权 1 个**：`options_greeks`（IV/PCR，美股 Deep 用）
  - **大盘指数 1 个**：同上
- 市场路由:
  - 纯数字代码（600036）→ ashare_technical_levels + ashare_quote
  - 字母代码（AAPL）→ technical_levels
- 深度级别:
  - **Quick**（~30秒）：只调核心指标（`technical_levels` / `ashare_technical_levels`），跳过大盘/情绪/量能/期权
  - **Standard**（~1分钟）：+ `market_snapshot` / `ashare_market_snapshot` + `fear_greed_index` + `ashare_fund_flow`
  - **Deep**（~2分钟）：全 8 个工具，含 `options_greeks`（美股期权 IV/PCR）
- 调用逻辑（3 步流程）:
  1. **数据收集**：按深度级别调用对应工具，所有工具并行调用，不分行
  2. **分析判断**：综合 RSI/MACD/EMA/布林带/枢轴点，结合大盘环境与情绪，定性判断趋势强度（strong_bull/bull/oscillation/bear/strong_bear）
  3. **叙事输出**：输出 trend_rating、key_levels、indicators、patterns、volume_confirmation、suggested_action、trigger_condition、narrative、confidence

### fundamental-auditor
- 可用工具（18 个，按维度分组）:
  - **快速扫描 4 个**：`fundamental_scan`（美股基本面 PE/PB/ROE/利润/营收/负债）、`ashare_fundamental_scan`（A股基本面）、`analyst_ratings`（分析师评级/目标价）、`earnings_calendar`（财报日历）
  - **SEC 深度 5 个**：`sec_company_search`（搜索SEC公司）、`sec_filings_search`（搜索SEC财报）、`sec_filing_content`（获取SEC财报内容）、`sec_financial_data`（获取SEC财务数据）、`sec_company_facts`（获取XBRL财务事实）
  - **宏观 4 个**：`cn_macro_pmi`（PMI数据）、`cn_macro_inflation`（通胀数据）、`cn_macro_credit`（信贷数据）、`cn_macro_rates`（利率数据）
  - **市场上下文 5 个**：`ashare_market_snapshot`（A股大盘指数）、`ashare_news_sentiment`（A股新闻情绪）、`market_snapshot`（美股大盘指数）、`fear_greed_index`（恐惧贪婪指数）、`ashare_quote`（A股实时行情）
- 市场路由:
  - 纯数字代码 → ashare_fundamental_scan + ashare_market_snapshot + ashare_news_sentiment + ashare_quote
  - 字母代码 → fundamental_scan + analyst_ratings + earnings_calendar + SEC 5 件套 + market_snapshot + fear_greed_index
  - A股宏观上下文 → cn_macro_pmi + cn_macro_inflation + cn_macro_credit + cn_macro_rates
- 深度级别:
  - **Quick**（~30秒）：只用快速扫描 4 个，看核心估值指标（PE、PB、ROE）
  - **Standard**（~1分钟）：+ 分析师评级 + 宏观（A股）/大盘情绪（美股）
  - **Deep**（~5分钟）：全 18 个工具，触发 SEC 条件（pe_ttm>行业平均 / debt_to_equity>行业平均 / earnings_quality==low / 7天内财报）时调 SEC 5 件套
- 调用逻辑（3 步流程）:
  1. **数据收集**：按深度级别并行调用所有工具，不分行——Quick 只调扫描 4 件套，Standard 加分析师/宏观，Deep 加 SEC 5 件套和市场上下文
  2. **分析判断**：四维定性评估（依据→分析→判断）：盈利能力 / 成长性 / 财务安全 / 现金流；计算 PE/PB 估值分位数；不构建五维雷达图
  3. **叙事输出**：输出 basis（实际数据）、analysis（数据含义）、judgment（结论+优缺点）、valuation、analyst_consensus、earnings_alert、macro_context / us_macro_context、narrative、confidence

### smart-money-hound
- 可用工具: ashare_fund_flow（A股主力资金）, ashare_lhb（龙虎榜）, insider_trading（美股内部人交易）, institutional_flow（机构持仓-13F）, get_insider_transactions, get_insider_summary, get_form4_details, analyze_form4_transactions, analyze_insider_sentiment
- 市场路由:
  - 纯数字代码 → ashare_fund_flow + ashare_lhb
  - 字母代码 → insider_trading + institutional_flow + SEC insider 系列
- 调用逻辑（3 步流程）:
  1. **数据收集**：根据市场路由调用对应工具，按频率分层（每次/每日/每周/每季度/按需），记录数据时间戳
  2. **分析判断**：提取 basis 关键数值（净流入、5日均值、超大单占比等），对比 5日/20日均值检测动量与异常（资金>20日均值2倍、内部人卖出>3倍买入等），检查数据陈旧度
  3. **叙事输出**：输出 signals（含 direction/intensity/trend/description/basis/comparison）、anomalies[]、momentum、narrative
- 数据陈旧处理: `institutional_flow` 超过60天 / `insider_trading` 超过2周 / `ashare_lhb` 超过3天 → 标记"数据陈旧"并降低置信度

### risk-gatekeeper
- 可用工具（3 个）: risk_gauge（风险指标：波动率/回撤/VaR/夏普比率）, position_sizing（凯利公式仓位计算）, options_greeks（按需-期权 Greeks，仅在 Deep 深度且需对冲时调用）
- 深度级别:
  - **Quick**（~30秒）：只调 `risk_gauge`，看风险指标，跳过仓位计算和期权对冲
  - **Standard**（~1分钟）：+ `position_sizing` 算凯利公式仓位，跳过期权 Greeks
  - **Deep**（~2分钟）：全 3 个工具，含 `options_greeks` 期权对冲
- 调用逻辑（3 步流程）:
  1. **数据收集**：按深度级别并行调用工具——Quick 只调 risk_gauge，Standard 加 position_sizing，Deep 加 options_greeks
  2. **分析判断**：综合波动率/回撤/VaR/夏普 定性评估风险等级（R1-R5），凯利公式折半（half_kelly）作为仓位上限，设置技术位/波动率位/时间止损
  3. **叙事输出**：输出 basis、analysis、judgment（含 risk_level + position_recommendation）、position_advice、stop_loss、hedge、narrative、confidence
- 风险等级: R1（低，指标全面健康）至 R5（极高，建议空仓或对冲），定性评估不依赖死板公式

### conflict-resolver
- 可用工具（3 个）: signal_fusion（必用-概率分布融合）, consistency_check（常用-与历史判断一致性校验）, conflict_resolver（按需-冲突检测+辩论触发+条件化结论）
- 深度级别: **无深度级别**（顶层仲裁 agent，按需调用 conflict_resolver 触发辩论）
- 调用逻辑（3 步流程）:
  1. **数据收集**：从各 agent 获取方向、置信度、叙事、关键点，调用 consistency_check 检查历史一致性
  2. **分析判断**：先做时间框架对齐检查（不一致则分层建议，不是冲突），再检测同时间框架内方向冲突（无冲突/表面分歧/根本性冲突）；根本性冲突时触发 3 轮辩论协议（陈述立场 → 质疑假设 → 调整立场），分析冲突根源（数据不同？逻辑不同？假设不同？）
  3. **叙事输出**：输出 conflicts[]（含 root_cause + severity）、narrative（冲突的叙事解释：谁更可信，为什么）、resolution（含 dominant_view / action / position_pct / entry_price / target_price / stop_loss / contingency）、confidence
- 信号权重: 技术35%/基本面30%/情绪10%/宏观10%/风险10%/聪明钱5%
- 降级规则: 1 个 agent 缺失 → confidence × 0.85；2 个 → × 0.6；3+ → confidence = 0；全部缺失 → resolution: null

### devil-advocate
- 可用工具: devil_advocate（必用-核心推理：叙事审计+危险模式检测）, memory_recall（常用-查历史共识陷阱）, news_sentiment（按需-搜集反证）, fundamental_scan（按需-检查基本面）, technical_levels（按需-检查技术面）, ashare_news_sentiment（按需-A股新闻）, ashare_fundamental_scan（按需-A股基本面）, ashare_technical_levels（按需-A股技术面）
- 调用逻辑（3 步流程）:
  1. **数据收集**：从上游 agent 获取信号和假设，识别主导叙事、叙事来源、叙事强度；觉得信息不够/有矛盾/需要验证时再调工具补充反证
  2. **分析判断**：识别盲点（被忽视的风险、可能错的假设），搜集反证（新闻/基本面/技术面），串联推理检测危险模式（如估值扩张+杠杆上升+散户涌入）
  3. **叙事输出**：输出 narrative_audit、blind_spots、counter_evidence、dangerous_pattern（含 historical_analog + key_difference）、early_warnings、recommendation（含 concern_level + key_assumptions_to_watch）
- 使用原则: 上游 agent 会提供相关信息，默认直接分析；觉得信息不够、有矛盾、需要验证时，再调用工具补充

### memory-learner
- 可用工具: memory_learner（必用-权重进化+模式提取+规则淘汰）, memory_recall（常用-查询历史记录）, experience_summary（按需-统计周期数据）, rule_manage（按需-管理规则）
- 调用逻辑（3 步流程）:
  1. **数据收集**：调用 memory_recall 获取历史判断记录，调用 experience_summary 获取统计周期数据，调用 rule_manage 管理规则
  2. **分析判断**：计算各 agent 准确率（按 agent / 按 market_condition），提取成功/失败模式，贝叶斯更新权重（`新权重 = 旧权重 × (准确率/平均准确率)`），归一化总和为 1
  3. **叙事输出**：输出 accuracy_report、weight_updates（含 old/new/reason）、pattern_alerts（含 condition + signal + action）、retired_rules、new_rules、next_review
- 规则淘汰: 连续失误≥3次自动淘汰；命中率<40%标记观察；样本<5次继续观察
- 规则生成: 有明确逻辑+命中率>55%+样本≥10 生成新规则；命中率>70%+样本≥20 升级为高置信度规则


## 数据库
**路径**: `D:\github_place\fin-agent\data\fin-agent.db`

**访问层**: `D:\github_place\fin-agent\agents\lib\dataHub.ts`
