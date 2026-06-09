# 补充 sentiment-decoder：大盘 + 行业情绪

## TL;DR

> **目标**：为 sentiment-decoder 增加大盘（market-wide）和行业（sector）情绪能力
> 
> **发现**：
> - `fear_greed_index` 已在 opencode.json 中分配给 sentiment-decoder，但 agent prompt 没有记录
> - A 股没有大盘情绪工具（只有指数价格数据）
> - US/CN 都没有行业情绪工具
> - sector-rotator 明确说"不做新闻情绪独立评分（sentiment-decoder 的事）"
>
> **方案**：4 个任务，2 个波次

---

## Context

### 现有工具

| 工具 | 市场 | 范围 | 分配给 |
|------|------|------|--------|
| `news_sentiment` | US | 个股 | sentiment-decoder ✅ |
| `ashare_news_sentiment` | CN | 个股 | sentiment-decoder ✅ |
| `fear_greed_index` | US | 大盘 | sentiment-decoder ✅（已配置但 prompt 未记录） |
| `market_snapshot` | US | 大盘 | macro-scout |
| `ashare_market_snapshot` | CN | 大盘 | macro-scout |
| `sector_rotation` | US | 行业 | sector-rotator |

### 缺口

| 缺口 | 说明 |
|------|------|
| A 股大盘情绪 | 无（只有指数价格，无情绪评分） |
| US 行业情绪 | 无（sector-rotator 只做资金流+价格动量） |
| CN 行业情绪 | 无（无行业级新闻/情绪工具） |

### 与现有 agent 的分工

| 维度 | macro-scout | sector-rotator | sentiment-decoder（新增） |
|------|-------------|----------------|--------------------------|
| 大盘情绪 | 用 fear_greed 作为宏观输入 | — | 用 fear_greed 作为情绪信号 |
| 大盘指数价格 | ✅ market_snapshot | — | ❌ 不做 |
| 行业资金流 | — | ✅ 核心 | ❌ 不做 |
| 行业价格动量 | — | ✅ 核心 | ❌ 不做 |
| 行业轮动阶段 | — | ✅ 核心 | ❌ 不做 |
| **行业情绪** | — | ❌ 明确不做 | ✅ **新增** |

---

## Work Objectives

### Core Objective
为 sentiment-decoder 增加大盘和行业情绪能力，填补当前信息源缺口。

### Concrete Deliverables
1. 更新 sentiment-decoder.md，记录 fear_greed_index 为第 3 个可用工具
2. 新增 `ashare_market_sentiment` 工具（A 股大盘情绪）
3. 新增 `sector_news_sentiment` 工具（US 行业情绪）
4. 新增 `ashare_sector_news_sentiment` 工具（CN 行业情绪）
5. 更新 sentiment-decoder.md 的输出格式和分析流程
6. 更新 opencode.json 注册新工具

### Must Have
- 所有新工具必须有实际数据源（不臆造字段）
- 输出格式必须可被 Fusion Brain 直接消费
- 不与其他 agent 功能重叠

### Must NOT Have
- 不做大盘指数价格（macro-scout 的事）
- 不做行业资金流/价格动量（sector-rotator 的事）
- 不做宏观经济数据（macro-scout 的事）

---

## Execution Strategy

### Wave 1（立即开始 — 配置修复 + 大盘情绪）

- [ ] 1. 更新 sentiment-decoder.md — 记录 fear_greed_index

  **What to do**:
  - 在"可用工具"表格中添加 `fear_greed_index` 行
  - 更新"自描述元数据"中的 data_sources
  - 添加"大盘情绪分析"流程：当 symbol 是"大盘"或"market"时调用
  - 添加 US 大盘输出格式（fear_greed_score, fear_greed_rating）

  **Must NOT do**:
  - 不修改 fear_greed_index 工具本身的代码
  - 不添加 market_snapshot（那是 macro-scout 的）

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Task 2)
  - **Blocks**: Task 5
  - **Blocked By**: None

  **References**:
  - `.opencode/agents/sentiment-decoder.md` — 当前 agent 定义
  - `.opencode/opencode.json` — fear_greed_index 已配置在 sentiment-decoder 的 tools 中
  - `agents/mcp/core/src/tools/market/fearGreedIndex.ts` — fear_greed_index 工具实现

  **Acceptance Criteria**:
  - [ ] sentiment-decoder.md 的"可用工具"表格包含 3 个工具
  - [ ] 大盘情绪分析流程已定义
  - [ ] US 大盘输出格式已定义

  **QA Scenarios**:
  ```
  Scenario: sentiment-decoder.md 包含 fear_greed_index
    Tool: Read
    Steps:
      1. 读取 .opencode/agents/sentiment-decoder.md
      2. 搜索 "fear_greed_index"
    Expected: 找到，且在"可用工具"表格中
    Evidence: .omo/evidence/task-1-fear-greed-doc.md
  ```

  **Commit**: YES
  - Message: `docs(sentiment-decoder): add fear_greed_index as 3rd tool`
  - Files: `.opencode/agents/sentiment-decoder.md`

- [ ] 2. 新增 ashare_market_sentiment 工具（A 股大盘情绪）

  **What to do**:
  - 在 `agents/mcp/ashare/ashare_mcp_server.py` 中添加 `get_market_sentiment()` 函数
  - 数据源：
    - 涨跌家数比（via ak.stock_market_activity_legu() 或东方财富 API）
    - 涨停/跌停家数
    - 北向资金净流入（via ak.stock_hsgt_north_net_flow_in_em()）
  - 输出格式：
    ```json
    {
      "market": "CN",
      "timestamp": "...",
      "sentiment_score": 65,
      "sentiment_label": "偏多",
      "advance_decline_ratio": 1.8,
      "limit_up_count": 45,
      "limit_down_count": 12,
      "northbound_flow": 15.6
    }
    ```
  - 注册为 MCP tool

  **Must NOT do**:
  - 不做指数价格数据（macro-scout 的 ashare_market_snapshot 已有）
  - 不做个股情绪（ashare_news_sentiment 已有）

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Task 1)
  - **Blocks**: Task 5
  - **Blocked By**: None

  **References**:
  - `agents/mcp/ashare/ashare_mcp_server.py` — 现有 A 股 MCP server，添加新函数
  - `agents/mcp/ashare/ashare_mcp_server.py:get_news_sentiment()` — 参考现有实现模式
  - akshare 文档：`stock_market_activity_legu()` — 涨跌家数
  - akshare 文档：`stock_hsgt_north_net_flow_in_em()` — 北向资金

  **Acceptance Criteria**:
  - [ ] `get_market_sentiment()` 函数已添加
  - [ ] 已注册为 MCP tool
  - [ ] 返回 sentiment_score [0, 100]
  - [ ] 包含涨跌家数比、涨停/跌停家数、北向资金

  **QA Scenarios**:
  ```
  Scenario: 调用 ashare_market_sentiment 获取大盘情绪
    Tool: Bash
    Steps:
      1. cd agents/mcp/ashare
      2. python -c "import json; from ashare_mcp_server import get_market_sentiment; print(json.dumps(get_market_sentiment(), ensure_ascii=False, indent=2))"
    Expected: 返回包含 sentiment_score 的 JSON
    Evidence: .omo/evidence/task-2-market-sentiment.json

  Scenario: 错误处理 — 网络异常
    Tool: Bash
    Steps:
      1. 断网或 mock 网络错误
      2. 调用 get_market_sentiment()
    Expected: 返回 error 字段，不崩溃
    Evidence: .omo/evidence/task-2-market-sentiment-error.json
  ```

  **Commit**: YES
  - Message: `feat(ashare): add market sentiment tool`
  - Files: `agents/mcp/ashare/ashare_mcp_server.py`

---

### Wave 2（Wave 1 完成后 — 行业情绪）

- [ ] 3. 新增 sector_news_sentiment 工具（US 行业情绪）

  **What to do**:
  - 在 `agents/mcp/core/src/tools/sentiment/` 中创建 `sectorNewsSentiment.ts`
  - 使用 Finnhub `finnhub_company_news` + 行业 ETF 代码（XLK, XLF, XLE, XLV, XLY, XLP, XLI, XLU, XLB, XLRE, XLC）
  - 复用 newsSentiment.ts 的情绪评分逻辑（关键词+源可信度+时间衰减）
  - 输出格式：
    ```json
    {
      "market": "US",
      "timestamp": "...",
      "sectors": [
        {
          "ticker": "XLK",
          "name": "科技",
          "sentiment_score": 0.35,
          "news_count": 8,
          "top_positive": [...],
          "top_negative": [...]
        }
      ]
    }
    ```
  - 注册到 index.ts 和 opencode.json

  **Must NOT do**:
  - 不做行业资金流/价格动量（sector-rotator 的事）
  - 不修改现有 newsSentiment.ts

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Task 4)
  - **Blocks**: Task 5
  - **Blocked By**: Task 1 (需要 sentiment-decoder.md 更新后才能注册)

  **References**:
  - `agents/mcp/core/src/tools/sentiment/newsSentiment.ts` — 复用情绪评分逻辑
  - `agents/mcp/core/src/tools/market/sectorRotation.ts:20-24` — SECTOR_MAP（11 个 GICS 行业 ETF）
  - `agents/mcp/core/src/index.ts` — 注册新工具
  - `.opencode/opencode.json` — 注册到 sentiment-decoder

  **Acceptance Criteria**:
  - [ ] `sectorNewsSentiment.ts` 已创建
  - [ ] 已注册到 index.ts
  - [ ] 已注册到 opencode.json
  - [ ] 返回 11 个行业的 sentiment_score
  - [ ] 每个行业包含 news_count 和 top_positive/negative

  **QA Scenarios**:
  ```
  Scenario: 调用 sector_news_sentiment 获取行业情绪
    Tool: Bash
    Steps:
      1. cd agents/mcp/core
      2. npx ts-node -e "import('./src/tools/sentiment/sectorNewsSentiment.ts').then(m => { const tool = m.registerSectorNewsSentiment({callTool: async () => ({content: [{type: 'text', text: '[]'}]})}); return tool.handler({params: {arguments: {hours: 72}}}); }).then(r => console.log(JSON.stringify(r, null, 2)))"
    Expected: 返回包含 sectors 数组的 JSON
    Evidence: .omo/evidence/task-3-sector-sentiment.json
  ```

  **Commit**: YES
  - Message: `feat(sentiment): add US sector news sentiment tool`
  - Files: `agents/mcp/core/src/tools/sentiment/sectorNewsSentiment.ts`, `agents/mcp/core/src/index.ts`, `.opencode/opencode.json`

- [ ] 4. 新增 ashare_sector_news_sentiment 工具（CN 行业情绪）

  **What to do**:
  - 在 `agents/mcp/ashare/ashare_mcp_server.py` 中添加 `get_sector_sentiment()` 函数
  - 数据源：东方财富行业新闻 API
  - 使用 akshare 的 `stock_board_industry_name_em()` 获取行业列表
  - 使用 akshare 的 `stock_board_industry_cons_em()` 获取行业成分股
  - 对每个行业的成分股调用 `get_news_sentiment()` 并聚合
  - 输出格式：
    ```json
    {
      "market": "CN",
      "timestamp": "...",
      "sectors": [
        {
          "name": "白酒",
          "sentiment_score": 65,
          "news_count": 15,
          "top_news": [...]
        }
      ]
    }
    ```

  **Must NOT do**:
  - 不做行业资金流（sector-rotator 的事）
  - 不修改现有 get_news_sentiment()

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Task 3)
  - **Blocks**: Task 5
  - **Blocked By**: Task 2 (需要 ashare_market_sentiment 完成后才能复用模式)

  **References**:
  - `agents/mcp/ashare/ashare_mcp_server.py:get_news_sentiment()` — 复用情绪评分逻辑
  - akshare 文档：`stock_board_industry_name_em()` — 行业列表
  - akshare 文档：`stock_board_industry_cons_em()` — 行业成分股

  **Acceptance Criteria**:
  - [ ] `get_sector_sentiment()` 函数已添加
  - [ ] 已注册为 MCP tool
  - [ ] 返回主要行业的 sentiment_score
  - [ ] 每个行业包含 news_count 和 top_news

  **QA Scenarios**:
  ```
  Scenario: 调用 ashare_sector_sentiment 获取行业情绪
    Tool: Bash
    Steps:
      1. cd agents/mcp/ashare
      2. python -c "import json; from ashare_mcp_server import get_sector_sentiment; print(json.dumps(get_sector_sentiment(), ensure_ascii=False, indent=2))"
    Expected: 返回包含 sectors 数组的 JSON
    Evidence: .omo/evidence/task-4-sector-sentiment.json
  ```

  **Commit**: YES
  - Message: `feat(ashare): add sector sentiment tool`
  - Files: `agents/mcp/ashare/ashare_mcp_server.py`

---

### Wave FINAL（所有任务完成后）

- [ ] 5. 更新 sentiment-decoder.md — 完整重写

  **What to do**:
  - 更新"可用工具"表格：5 个工具（news_sentiment, ashare_news_sentiment, fear_greed_index, sector_news_sentiment, ashare_sector_news_sentiment）
  - 更新"市场识别"：支持"大盘"和"行业"作为一级分析模式
  - 更新"输出格式"：添加大盘情绪和行业情绪的输出结构
  - 更新"协作接口"：说明如何将大盘/行业情绪传递给 Fusion Brain

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **References**:
  - `.opencode/agents/sentiment-decoder.md` — 当前版本
  - Task 1-4 的产出 — 新工具的输出格式

  **Acceptance Criteria**:
  - [ ] 5 个工具都在"可用工具"表格中
  - [ ] 大盘和行业分析流程已定义
  - [ ] 输出格式包含大盘和行业部分

  **Commit**: YES
  - Message: `docs(sentiment-decoder): add market and sector sentiment`
  - Files: `.opencode/agents/sentiment-decoder.md`

---

## Dependency Matrix

| Task | Depends On | Blocks |
|------|------------|--------|
| 1 | None | 5 |
| 2 | None | 5 |
| 3 | 1 | 5 |
| 4 | 2 | 5 |
| 5 | 1, 2, 3, 4 | None |

## Agent Dispatch Summary

- **Wave 1**: 2 tasks — T1 → `quick`, T2 → `unspecified-high`
- **Wave 2**: 2 tasks — T3 → `unspecified-high`, T4 → `unspecified-high`
- **Wave FINAL**: 1 task — T5 → `quick`

## Commit Strategy

| Task | Message | Files |
|------|---------|-------|
| 1 | `docs(sentiment-decoder): add fear_greed_index as 3rd tool` | `.opencode/agents/sentiment-decoder.md` |
| 2 | `feat(ashare): add market sentiment tool` | `agents/mcp/ashare/ashare_mcp_server.py` |
| 3 | `feat(sentiment): add US sector news sentiment tool` | `agents/mcp/core/src/tools/sentiment/sectorNewsSentiment.ts`, `index.ts`, `opencode.json` |
| 4 | `feat(ashare): add sector sentiment tool` | `agents/mcp/ashare/ashare_mcp_server.py` |
| 5 | `docs(sentiment-decoder): add market and sector sentiment` | `.opencode/agents/sentiment-decoder.md` |
