# Portfolio 模块设计理念

> 生成日期: 2026-06-21
> 作者: 需求对齐产物（三轮 QA，详见 `docs/refactor-decisions/portfolio-decisions-qa.md`）
> 定位: 本文件只讲"为什么这么设计"，不讲"怎么写代码"。具体实现见
> `docs/plans/portfolio-implementation-manual.md`。

---

## 1. 问题陈述：委员会的"开环"困境

fin-agent 现有 12 个 Agent 组成"AI 投研委员会"，由 `WorkflowRunner` 编排、
`NodeExecutor` 执行、`ExecutionRecorder` 落库。决策链路如下：

```
WorkflowRunner.run()
  └─ NodeExecutor.execute(ctx)         ← Agent 在这里产出"建议"
      └─ dispatcher.dispatch(agent)    ← 产出封装为 NodeResult.output: dict
                                       ← record_node_completed() 落库后即结束
```

这条链路是**开环**的——建议产出后被记录，但没有任何环节知道：

- **账户现在持有什么**（没有持仓状态）
- **历史做过哪些决策**（没有决策记录）
- **每次决策的结果如何**（没有经验沉淀）

换句话说，**"我"（账户/决策者）在投研委员会里没有实体存在**。委员会产出的是飘在空
中的建议，落不到账户这个"容器"里。

本次新增 `modules/portfolio` 模块，目的就是补这条闭环——让账户成为系统的一等公民。

---

## 2. 核心定位：账本优先的数据底座

经过需求对齐，portfolio 模块的定位被明确为：

> **一个偏数据库端的"账本 + 大脑成长记录"，不是算法引擎。**

这一句话包含三个关键判断：

### 2.1 它是"数据底座"，不是"业务逻辑"

portfolio 的核心交付是 **schema + 领域模型 + 接口契约**。本次不实现交易算法、不实现
风控规则、不实现决策推理。它只做一件事：**把账户的事实持久化好，让别人能查、能写、
能扩展。**

这与项目现有架构精神一致——`execution` 模块是"纯状态机 + 持久化"，不感知 DAG 拓扑
（修订 T-1 把熔断从 execution 移走正是这个精神）。portfolio 同样是一个**被动的、
中立的、可被多方消费的数据底座**。

### 2.2 它是"账本"，采用流水优先模型

账户的事实天然适合用**账本（ledger）**建模：

- **流水（transactions）是真相**：每一笔买卖都是不可篡改的历史事实。
- **持仓（positions）是投影**：当前持有什么，是从流水推导出来的当前态。

这是会计准则的标准做法（"不得删除原始凭证"），也是银行系统的通用模型（交易明细是
真相，账户余额是投影）。选择流水优先而非快照优先，是因为：

1. **可追溯**：账本能回答"发生过什么"，快照只能回答"现在是什么"。未来的决策学习层
   需要历史原料，流水天然满足。
2. **可纠错**：错误通过红冲（反向冲销）纠正，原始记录永远保留，审计完整。
3. **可重建**：只要流水在，持仓随时可重建。物化缓存即使损坏也不是灾难。

### 2.3 它为未来模块预留接缝

portfolio 不是一个自包含的封闭系统，而是**整个系统的数据枢纽**。本次实现时，必须为
以下未来模块预留接缝（接入时不动既有代码）：

| 未来模块 | 接入方式 | 本次预留 |
|---------|---------|---------|
| 实时行情获取 | 调 `refresh_pnl(market_prices)` 刷新浮盈 | Protocol 方法签名 |
| 任务派发 | 决策触发后调 `record_transaction()` | `decision_id` 外键 + 写入入口 |
| 决策学习/迭代 | 消费 `decisions` 表 + `transactions` 流水 | 占位表 + dataclass |
| 风控规则 | 实现 `RiskService.review()` | Protocol + 空实现 |
| 决策推理 | 写入 `decisions` 表，关联 `transactions` | 表结构 + `agent_name` 字段 |

这就是"接缝优先"的设计哲学——**先把数据底座和接口契约钉死，业务逻辑可以晚到，
但接口不能晚到**。

---

## 3. 三大设计支柱

### 支柱一：流水为真相，持仓为投影

**事实层（source of truth）**: `transactions` 表，append-only，不可改不可删。

**投影层（materialized view）**: `positions` 表，从流水推导的当前态缓存。

为什么需要物化投影，不直接每次查询都 SUM 流水？**性能**。持仓查询是高频读侧操作
（前端展示、风控判定、分析模块都要查），实时 SUM 流水的 O(N) 成本不可接受。物化投影
把读侧成本降到 O(1)，代价是引入"双写一致性"的维护负担。

**双写一致性策略**:

- 写路径：`record_transaction()` 在**同一个 UoW 事务**内 append 流水 + 更新持仓，
  保证原子性（复用现有 `SqlAlchemyUoWFactory.begin()`）。
- 漂移兜底：提供 `rebuild_positions()` 维护接口，按流水全量重算持仓。这是"核武器"，
  日常不用，只在 positions 与流水脱节时手动调。
- 不实现定期校验 job（reconciliation）——留接口位给未来，本次保持 scope 纯粹。

这个设计**承认 positions 是缓存，不假装它是事实**。positions 表的每一行必须能从
transactions 推导出来，否则就是数据 bug。

### 支柱二：行情解耦，盈亏持久化

账户系统天然需要回答"我赚了多少/亏了多少"。但盈亏计算依赖"现价"，而现价是高频外部
数据（行情）。如果让 portfolio 自己拉行情，它就不再是纯粹的"数据底座"，而是耦合了
外部数据源。

**解耦方案（方案 II，经三轮 QA 敲定）**:

- portfolio **永不对外输出 last_price**（API、service、domain 三层都不含现价字段）。
  决策/分析端需要现价时，自己找行情模块要。
- `realized_pnl`（已实现盈亏）：纯记账，SELL 时累加 `(sell_price - cost_price) * qty`，
  **不需要行情**，持久化在 positions 表。
- `unrealized_pnl`（浮动盈亏）：**持久化在 positions 表**，是带时间戳的快照值。
  - 交易时由 `record_transaction()` 用**成交价**刷新一次（`pnl_updated_at = occurred_at`）。
  - 未来行情模块通过 `refresh_pnl(market_prices)` 用**市场价**刷新
    （`pnl_updated_at = refresh 调用时刻`）。
  - 本次行情模块未接入，unrealized_pnl 停在"最后一笔交易时的价格"，
    靠 `pnl_updated_at` 标注新鲜度。

**时序矛盾的解决**：行情变化不伴随交易发生（周末/休市时持仓浮盈会变化，但没交易）。
方案 II 的答案是——交易时用成交价刷一次（至少保证"交易瞬间盈亏新鲜"），
未来行情模块通过 refresh 兜底。在行情模块接入前，盈亏的"过时"是已知约束，
靠时间戳透明地告知调用方。

**已知并发风险**：record_transaction 和 refresh_pnl 都是 positions 表的写入者。
SQLite WAL + busy_timeout 模式下天然单写者序列化，单行 `WHERE symbol=?` 更新足够。
本次不引入额外锁机制。未来迁移 PostgreSQL 时再考虑显式行锁。这个约束在实现手册中
明确标注。

### 支柱三：接缝优先，占位不实现

四个未来模块的功能本次都不实现业务逻辑，但**接口和表结构必须到位**：

- **decisions 表 + Decision dataclass**：只建表和领域模型，不写 service/router。
  字段含 `agent_name`（对标 conversations 表约定）、`intent`、`payload`（JSON）、
  `trace_id`、`created_at`。
- **RiskService Protocol + PassThroughRiskService 空实现**：`review(intent)` 永远
  返回通过。接口签名钉死，未来填业务逻辑时不动既有调用方。
- **TradeIntent / RiskVerdict 值对象**：风控审查的"对象"和"输出"抽象，既不绑定订单
  语义也不绑定建议语义。这是防腐层思路——风控的输入契约稳定，未来决策模块落地后
  能自然对接。
- **decision_id 外键 + link_decision 回填接口**：transactions 的 `decision_id` 可在
  写入时填，也可后续回填。承认"先交易后补决策"是常见业务时序。

---

## 4. 关键设计决策摘要

以下决策均在三轮 QA 中与需求方对齐，每条都附核心理由。

| 决策 | 选择 | 核心理由 |
|------|------|---------|
| 账户维度 | **单账户** | 委员会本身是给一个账户出谋划策；不建 accounts 表，schema 简化 |
| 持仓形态 | **流水 + 物化投影** | 流水可追溯/可纠错/可重建；投影解决读侧性能 |
| 双写一致性 | **信任双写 + 重建接口** | UoW 保证原子性；rebuild_positions 兜底漂移 |
| 纠错机制 | **红冲（reversal）** | 财务账本标准做法；保留原始记录，审计完整 |
| ADJUST 兜底 | **取消** | 严格性优先；所有变动必须从 BUY/SELL 推导 |
| 存量导入 | **伪造 BUY + memo** | 不引入"绝对值写入"口子，保持账本纯粹 |
| 零持仓状态 | **保留行 + closed_at** | 供未来决策学习层消费"曾经持有过什么" |
| 成本核算 | **移动加权平均（记账）** | 非 FIFO/LIFO（那属于算法）；SELL 时成本不变 |
| 行情耦合 | **解耦，永不输出 last_price** | portfolio 是数据底座，不是行情源 |
| 盈亏持久化 | **方案 II（交易时刷 + refresh 接口）** | 不依赖行情也能持久化；行情模块未来接入增强 |
| decision_id | **可回填（仅此一字段）** | 承认"先交易后补决策"业务时序 |
| 标的元信息 | **不建表，加 kind 字段** | 元信息属于行情/交易模块；portfolio 不解释 symbol |
| 风控接入点 | **独立服务层（不侵入 workflow）** | 遵守 execution "不感知业务决策"边界 |
| 模块边界 | **单 module portfolio** | 风控是仓位读侧消费者，紧耦合；未来膨胀再拆 |

---

## 5. 领域边界图

```
┌─────────────────────────────────────────────────────────────────┐
│                       现有 5 个 module                            │
│                                                                  │
│   workflow ──run()──> execution ──record──> DB                   │
│      │                   │                                       │
│      └─ NodeExecutor     └─ ExecutionRecorder                    │
│         dispatches agent     (append-only 日志)                  │
│                                                                  │
│   agent ──dispatch──> opencode                                   │
│   conversation ── CRUD 会话                                      │
│   mcp ── 工具目录                                                │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │  委员会建议产出 NodeResult.output
                              │  （目前到此为止，开环）
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                  本次新增: modules/portfolio                      │
│                                                                  │
│   ┌─────────────┐    record_transaction    ┌─────────────────┐   │
│   │ transactions │ ◄────────────────────── │ PortfolioService│   │
│   │  (流水真相)  │ ────双写 UoW──────────► │  (写入入口)      │   │
│   └─────────────┘                         └─────────────────┘   │
│           │                                      │               │
│           │ 投影                                  │ refresh_pnl   │
│           ▼                                      ▼               │
│   ┌─────────────┐    list_positions     ┌─────────────────┐     │
│   │  positions   │ ◄─────────────────── │ PositionReader  │     │
│   │ (物化缓存)   │ ──── PositionView ──► │  (读侧查询)     │     │
│   └─────────────┘                       └─────────────────┘     │
│                                                                  │
│   ┌─────────────┐  占位(无 service)                              │
│   │  decisions   │ ◄── 未来决策模块写入                          │
│   │  (占位表)    │ ── 未来学习模块消费                            │
│   └─────────────┘                                                │
│                                                                  │
│   ┌─────────────────────┐  占位(空实现)                          │
│   │ RiskService.review  │ ◄── 未来填规则                          │
│   │ (永远返回通过)       │                                       │
│   └─────────────────────┘                                       │
└─────────────────────────────────────────────────────────────────┘
                              ▲
                              │  未来模块通过预留 Protocol 接入:
                              │
            ┌─────────────────┼─────────────────┐
            │                 │                 │
    ┌───────────────┐ ┌───────────────┐ ┌───────────────┐
    │  行情模块      │ │  决策模块      │ │  学习模块      │
    │ (未来)         │ │ (未来)         │ │ (未来)         │
    │               │ │               │ │               │
    │ refresh_pnl() │ │ record_trans()│ │ 消费 decisions │
    │               │ │ 写 decisions  │ │ + transactions │
    └───────────────┘ └───────────────┘ └───────────────┘
```

**依赖方向（关键）**:

- portfolio **不依赖**任何现有业务 module（只依赖 infra: UoW / errors / domain）。
- 未来模块依赖 portfolio 的 Protocol（单向），portfolio 不反向依赖它们。
- RiskService 是 portfolio 的内部 Protocol，但实现是空壳——未来风控逻辑填进来即可。

---

## 6. 演进路径与未决项

### 6.1 行情模块接入（最先发生）

未来行情模块只需：

1. 拉取当前价 `{symbol: market_price}`。
2. 调 `PortfolioService.refresh_pnl(market_prices, trace_id)`。
3. portfolio 内部用市场价重算 `unrealized_pnl`，更新 `pnl_updated_at`。

**不动既有代码**——refresh_pnl 的 Protocol 本次就钉死。

### 6.2 决策模块接入

未来决策模块只需：

1. 委员会产出决策 → 写入 `decisions` 表（本次已建表）。
2. 决策触发交易 → 调 `PortfolioService.record_transaction(decision_id=...)`。
3. 若交易先于决策 → 事后调 `link_decision(transaction_id, decision_id)` 回填。

**不动既有代码**——record_transaction / link_decision / decisions 表本次都到位。

### 6.3 学习模块接入

未来学习/迭代模块只需：

1. 读 `decisions` 表（决策历史）+ `transactions` 流水（执行结果）。
2. 读 `positions.closed_at`（曾持有过的标的）。
3. 产出经验 → 写回某种"反思"结构（未来 schema）。

**本次为其准备原料**——流水完整、决策记录占位、清仓标的可追溯。

### 6.4 风控规则接入

未来风控规则只需：

1. 实现 `RiskService.review(intent) -> RiskVerdict`，替换 `PassThroughRiskService`。
2. 在 DI 注册处把空实现换成真实实现。

**不动既有调用方**——review 的签名本次钉死。

### 6.5 本次不实现的明确边界

- ❌ 不实现行情获取（只留 refresh_pnl 接口）
- ❌ 不实现决策 service/router（只建 decisions 表 + dataclass）
- ❌ 不实现风控规则（只留 RiskService 空实现）
- ❌ 不实现任务派发
- ❌ 不实现时间旅行查询（某时刻持仓快照）
- ❌ 不预留 DIVIDEND/SPLIT action
- ❌ 不建 accounts 表（单账户）
- ❌ 不建 instruments 表（symbol 裸字符串 + kind 字段）
- ❌ 不实现定期对账 job（只留 rebuild_positions 接口）

---

## 7. 与现有架构约定的一致性

本模块严格遵循现有 DDD + Clean Architecture 约定（详见 TARGET_ARCHITECTURE_v2 与各
module 的 protocol.py docstring）：

| 约定 | portfolio 的遵守方式 |
|------|---------------------|
| 对外只暴露 Protocol（§0 P2） | `modules/portfolio/protocol.py` 是唯一对外接口文件 |
| 写侧 async，读侧 sync | PortfolioService async / PositionReader sync（对标 ExecutionRecorder/ExecutionStateReader） |
| Protocol-based DI | Registry.register_singleton(Portocol, factory) |
| UoW 边界 | 所有 DB 写操作走 UoWFactory.begin()，不碰 Session/Engine |
| 三层异常树 | 所有 raise 落在 FinAgentError；新增 4 个 BizError 子类 |
| 共享值对象 | TraceId 复用 infra.domain；新增 InstrumentKind 等 |
| 统一信封 | router 返回 ApiResponse.success().to_dict() |
| trace_id 贯穿 | 写侧必传 trace_id，读侧不写审计 |
| 装配单一入口 | main.py:build_registry() 追加 portfolio 段 |
| Alembic 管理 schema | 新增 002_add_portfolio.py 迁移 |
| Do Not #1 | 禁止跨模块 `from X import _xxx` |
| Do Not #19 精神 | service 无跨调用持久化状态（状态都在 DB） |

---

## 8. 一句话总结

> **portfolio 是 fin-agent 系统的"账本底座"——流水是真相，持仓是投影，盈亏是带时间戳
> 的快照，决策/风控/学习都是未来挂在它上面的消费者。本次把数据模型和接口契约钉死，
> 让未来模块能无痛接入，而账户终于在投研委员会里有了自己的位置。**
