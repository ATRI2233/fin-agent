# 扩展 sentiment-decoder：2 层结构 + 大盘上下文

## TL;DR

> **目标**：扩展 sentiment-decoder，支持"个股+大盘上下文"的 2 层分析结构
> 
> **核心改动**：
> - news_sentiment (US)：加 `finnhub_market_news` 作为浅度上下文
> - ashare_news_sentiment (CN)：换用 `stock_news_em` + 加 `stock_info_global_em` 作为浅度上下文
> - sentiment-decoder.md：更新 prompt，教 agent 按 2 层结构调用
>
> **改动量**：约 80 行代码 + 1 个 prompt 更新

---

## Context

### 现状
- news_sentiment (US)：只调 `finnhub_company_news`（个股新闻），无大盘上下文
- ashare_news_sentiment (CN)：只调 `np-anotice-stock`（公司公告），无大盘上下文
- sentiment-decoder.md：只记录 2 个工具，无大盘分析流程

### 目标
- 个股分析时，同时看大盘上下文（浅度）
- 大盘分析时，看全量市场新闻（深度）
- 主题/行业分析时，从新闻中过滤关键词

### 2 层决策树

```
用户输入
│
├── 第一层：US 还是 CN？
│
├── US
│   ├── 个股 → company_news(深度) + market_news(浅度) + quote + fear_greed
│   └── 大盘 → market_news(深度) + fear_greed
│
└── CN
    ├── 个股 → stock_news_em(深度) + global_em(浅度) + announcement
    └── 大盘 → global_em(深度) + global_cls(辅助)
```

---

## Work Objectives

### Core Objective
扩展 sentiment-decoder，支持"个股+大盘上下文"的 2 层分析结构。

### Concrete Deliverables
1. 扩展 newsSentiment.ts：加 `finnhub_market_news` 调用
2. 扩展 ashare_mcp_server.py：换用 `stock_news_em` + 加 `stock_info_global_em`
3. 更新 sentiment-decoder.md：教 agent 按 2 层结构调用

### Must Have
- 个股分析时，必须同时获取大盘上下文
- 大盘上下文权重：0.3（个股情绪 = 0.7 × 个股 + 0.3 × 大盘）
- 所有接口必须有错误处理

### Must NOT Have
- 不修改 fear_greed_index 工具
- 不修改 finnhub_quote 工具
- 不新增 MCP 工具（只扩展现有）

---

## Execution Strategy

### Wave 1（并行 — 代码扩展）

- [ ] 1. 扩展 newsSentiment.ts — 加 finnhub_market_news

  **What to do**:
  - 在 `newsSentiment.ts` 的 `Promise.allSettled` 块中，加第 4 个调用：
    ```typescript
    mcpManager.callTool("stock-scanner", "finnhub_market_news", { category: "general", minId: 0 }, 20000)
    ```
  - 解析 `marketNewsResult`，提取新闻列表
  - 对市场新闻做情绪评分（复用现有 `analyzeSentimentSimple`）
  - 计算加权情绪：
    ```typescript
    const stockSentiment = // 来自 company_news
    const marketSentiment = // 来自 market_news
    const finalSentiment = 0.7 * stockSentiment + 0.3 * marketSentiment
    ```
  - 输出中加 `market_sentiment` 字段

  **Must NOT do**:
  - 不修改现有的 company_news 逻辑
  - 不修改 fear_greed 逻辑
  - 不修改 quote 逻辑

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Task 2)
  - **Blocks**: Task 3
  - **Blocked By**: None

  **References**:
  - `agents/mcp/core/src/tools/sentiment/newsSentiment.ts` — 当前实现，加第 4 个并行调用
  - `agents/mcp/core/src/mcp/mcpClientManager.ts` — stock-scanner MCP 配置，finnhub 模块已启用
  - `agents/mcp/core/src/tools/sentiment/newsSentiment.ts:analyzeSentimentSimple` — 复用情绪评分函数

  **Acceptance Criteria**:
  - [ ] `finnhub_market_news` 调用已添加
  - [ ] 市场新闻情绪已计算
  - [ ] 加权公式：`0.7 × stock + 0.3 × market`
  - [ ] 输出包含 `market_sentiment` 字段

  **QA Scenarios**:
  ```
  Scenario: 个股情绪包含大盘上下文
    Tool: Bash
    Steps:
      1. cd agents/mcp/core
      2. 用 mock 调用 news_sentiment，检查输出是否包含 market_sentiment
    Expected: 输出包含 market_sentiment 字段，值在 [-1, 1] 范围
    Evidence: .omo/evidence/task-1-market-context.json
  ```

  **Commit**: YES
  - Message: `feat(sentiment): add market context to news_sentiment`
  - Files: `agents/mcp/core/src/tools/sentiment/newsSentiment.ts`

- [ ] 2. 扩展 ashare_mcp_server.py — 换用 stock_news_em + 加 stock_info_global_em

  **What to do**:
  - 修改 `get_news_sentiment()` 函数：
    - 把 `np-anotice-stock` 换成 `ak.stock_news_em(symbol)`（获取真正新闻，不只是公告）
    - 加 `ak.stock_info_global_em()` 调用（获取大盘上下文）
  - 计算加权情绪：
    ```python
    stock_sentiment = # 来自 stock_news_em
    market_sentiment = # 来自 stock_info_global_em
    final_sentiment = 0.7 * stock_sentiment + 0.3 * market_sentiment
  - 输出中加 `market_sentiment` 字段

  **Must NOT do**:
  - 不修改现有的 quote 逻辑
  - 不修改现有的 fund_flow 逻辑

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Task 1)
  - **Blocks**: Task 3
  - **Blocked By**: None

  **References**:
  - `agents/mcp/ashare/ashare_mcp_server.py:get_news_sentiment()` — 当前实现，修改数据源
  - AKShare 文档：`stock_news_em(symbol)` — 个股新闻（100条）
  - AKShare 文档：`stock_info_global_em()` — 全球快讯（200条）

  **Acceptance Criteria**:
  - [ ] `get_news_sentiment()` 使用 `stock_news_em` 替代 `np-anotice-stock`
  - [ ] `get_news_sentiment()` 调用 `stock_info_global_em` 获取大盘上下文
  - [ ] 加权公式：`0.7 × stock + 0.3 × market`
  - [ ] 输出包含 `market_sentiment` 字段

  **QA Scenarios**:
  ```
  Scenario: 个股情绪包含大盘上下文
    Tool: Bash
    Steps:
      1. cd agents/mcp/ashare
      2. python -c "import json; from ashare_mcp_server import get_news_sentiment; r = get_news_sentiment('600519'); print(json.dumps(r, ensure_ascii=False, indent=2))"
    Expected: 输出包含 market_sentiment 字段
    Evidence: .omo/evidence/task-2-market-context.json
  ```

  **Commit**: YES
  - Message: `feat(ashare): add market context to news_sentiment`
  - Files: `agents/mcp/ashare/ashare_mcp_server.py`

---

### Wave 2（Wave 1 完成后 — 更新 prompt）

- [ ] 3. 更新 sentiment-decoder.md — 教 agent 按 2 层结构调用

  **What to do**:
  - 更新"市场识别"：加"大盘"作为一级分析模式
  - 更新"分析流程"：教 agent 按 2 层结构调用
    ```
    1. 判断市场：US 还是 CN
    2. 判断范围：个股还是大盘
    3. 调用对应接口：
       - US个股：finnhub_company_news(深度) + finnhub_market_news(浅度) + quote + fear_greed
       - US大盘：finnhub_market_news(深度) + fear_greed
       - CN个股：stock_news_em(深度) + stock_info_global_em(浅度)
       - CN大盘：stock_info_global_em(深度) + stock_info_global_cls(辅助)
    4. 计算加权情绪：0.7 × 个股 + 0.3 × 大盘
    ```
  - 更新"输出格式"：加 `market_sentiment` 字段
  - 更新"可用工具"：加 `finnhub_market_news` 和 `stock_info_global_em`

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 2 (sequential)
  - **Blocks**: None
  - **Blocked By**: Task 1, Task 2

  **References**:
  - `.opencode/agents/sentiment-decoder.md` — 当前 agent 定义
  - Task 1 和 Task 2 的产出 — 新的接口和输出格式

  **Acceptance Criteria**:
  - [ ] "市场识别"包含"大盘"模式
  - [ ] "分析流程"包含 2 层结构
  - [ ] "输出格式"包含 `market_sentiment` 字段
  - [ ] "可用工具"包含所有 8 个接口

  **QA Scenarios**:
  ```
  Scenario: sentiment-decoder.md 包含 2 层结构
    Tool: Read
    Steps:
      1. 读取 .opencode/agents/sentiment-decoder.md
      2. 搜索 "大盘" 和 "market_sentiment"
    Expected: 找到，且在"分析流程"和"输出格式"中
    Evidence: .omo/evidence/task-3-prompt-update.md
  ```

  **Commit**: YES
  - Message: `docs(sentiment-decoder): add 2-layer analysis structure`
  - Files: `.opencode/agents/sentiment-decoder.md`

---

## Dependency Matrix

| Task | Depends On | Blocks |
|------|------------|--------|
| 1 | None | 3 |
| 2 | None | 3 |
| 3 | 1, 2 | None |

## Agent Dispatch Summary

- **Wave 1**: 2 tasks — T1 → `unspecified-high`, T2 → `unspecified-high`
- **Wave 2**: 1 task — T3 → `quick`

## Commit Strategy

| Task | Message | Files |
|------|---------|-------|
| 1 | `feat(sentiment): add market context to news_sentiment` | `agents/mcp/core/src/tools/sentiment/newsSentiment.ts` |
| 2 | `feat(ashare): add market context to news_sentiment` | `agents/mcp/ashare/ashare_mcp_server.py` |
| 3 | `docs(sentiment-decoder): add 2-layer analysis structure` | `.opencode/agents/sentiment-decoder.md` |

## Success Criteria

1. ✅ news_sentiment 输出包含 `market_sentiment` 字段
2. ✅ ashare_news_sentiment 输出包含 `market_sentiment` 字段
3. ✅ sentiment-decoder.md 包含 2 层分析流程
4. ✅ 加权公式：`0.7 × 个股 + 0.3 × 大盘`
