# 风控 + 仓位层 设计 QA 记录

> 生成日期: 2026-06-21
> 用途: 记录 `modules/portfolio` 新功能模块的需求对齐过程与关键架构决策。
> 遵循现有 DDD + Clean Architecture 约定（详见 TARGET_ARCHITECTURE_v2 与各 module protocol）。

## 背景与定位

12 个 agent 的"AI 投研委员会"目前是**开环**的：决策产出 `NodeResult.output` 被
`ExecutionRecorder.record_node_completed()` 落库后就结束。没有"账户"在委员会里的实体存在
——没有持仓状态、没有决策记录、没有经验迭代反思。

本次新增 `modules/portfolio` 模块补这条闭环，核心交付是**数据底座 + 接口契约**：

1. **仓位管理 (Position)** —— 系统的"事实数据库"。流水是真相，持仓是投影。
2. **决策迭代学习 (Decision)** —— 只占表结构，service 不实现（append-only 账本的"写"留给未来）。
3. **风控 (Risk)** —— 只占 Protocol 接口 + 空实现，业务逻辑留待未来。

未来模块（实时信息获取/任务派发/记忆学习/决策算法）都是这个数据底座的**消费者**，
通过本次预留的 Protocol 接入，不动既有代码。

---

## QA 决策记录

### Q-A：定位对齐

**问**: 这次的核心是"算法"还是"数据系统"？
**答**: 数据系统。仓位管理 + 决策迭代学习的偏数据库端设计，不是算法。
**决策**: 核心交付是 schema + domain dataclass + service 接口契约，不做交易/风控算法。

---

### Q-1：账户维度

**问**: Position 的"账户"维度是单账户还是多账户？
**答**: 单账户。
**决策**:
- 整个系统一个"我的账户"，`transactions` / `positions` 表不带 `account_id` 外键。
- 不建 `accounts` 表。

---

### Q-2：流水 vs 快照（最关键分叉）

**问**: Position 是"当前快照表"还是"流水事件表"？
**答**: 流水。
**决策**:
- `transactions` 表是真相（source of truth），append-only，不可改不可删。
- `positions` 表是从流水投影出来的物化缓存视图。
- 写路径双写（append 流水 + 更新 positions），在**同一个 UoW 事务**内完成
  （复用现有 `SqlAlchemyUoWFactory.begin()`）。
- 提供维护接口"按流水重建 positions"，应对投影漂移/手动改库/存量导入。

**投影机制选 (c) 混合方案**（物化缓存 + 重建接口），不用 (a) 纯实时计算
（读侧消费者多，SUM 流水性能不够），也不用 (b) 纯物化（无重建接口会成灾难）。

---

### Q-3：行情/价格解耦

**问**: Position 表要不要存"当前价/浮盈"？
**答**: 行情是未来的"实时信息获取"模块职责，本次要把接口留好。
**决策**:
- `positions` 表存 `cost_price`（成本基价，内部记账产出）+ `quantity`，**不存** `last_price`。
- 浮盈/市值等"实时金额"字段**不入库**，由未来行情模块在查询时拼接。
- 在 `PositionReader` Protocol 预留 `attach_market_price(positions, snapshot)` 接口，
  供未来行情模块实现；本次返回纯持仓快照。

---

### Q-4：Decision 占位边界

**问**: Decision 这次的"占位"颗粒度？
**答**: (a) 只占表结构。
**决策**:
- 建 `decisions` 表 + domain dataclass，**不写 service / router**。
- 字段：`id / agent / intent / payload / trace_id / created_at`（见 schema 段）。
- 未来决策模块落地时，service 通过 `decision_id` 外键把 `transactions.decision_id` 填上。

---

### Q-5：风控占位边界

**问**: 风控完全不碰，还是建空壳接口？
**答**: 和 Q-3 一样，留好接口。
**决策**:
- 建 `RiskService` Protocol + 空实现 `PassThroughRiskService`（review 永远返回通过）。
- 接口签名钉死，未来填业务逻辑时不动既有调用方。

---

### Q-6：流水 schema

**问**: `transactions` 表字段？
**答**: 按我提议的方案。不预留 DIVIDEND / SPLIT。
**决策**:

```
transactions 表（append-only）
├─ id              TEXT PK (UUID4 字符串)
├─ symbol          TEXT NOT NULL          标的代码
├─ action          TEXT NOT NULL          枚举: BUY | SELL | ADJUST
├─ quantity        REAL NOT NULL          数量,恒正,方向由 action 决定
├─ price           REAL NOT NULL          成交单价
├─ occurred_at     DATETIME NOT NULL      业务时间(非写入时间)
├─ trace_id        TEXT NOT NULL          审计贯穿
├─ decision_id     TEXT NULL              可选 FK -> decisions.id
├─ memo            TEXT NULL              备注
└─ created_at      DATETIME NOT NULL      写入时间
```

约定：
- `action` 枚举仅 3 种：`BUY`（买入）/ `SELL`（卖出）/ `ADJUST`（人工强行覆盖持仓的兜底口）。
- 不预留 `DIVIDEND` / `SPLIT`。
- `quantity` 恒正，方向由 `action` 决定（可读性优先，与券商对账单一?致）。
- `ADJUST` 是逃生口：系统算不准/历史数据错/初始导入存量持仓时用。
- append-only：service 层不提供 update / delete 方法。

---

### Q-7：成本核算边界（记账 vs 算法）

**问**: 移动加权平均成本算"记账"还是"算法"？
**答**: 按我的决策（记账）。
**决策**:

| 算"记账"（本次做） | 算"算法"（本次不做） |
|--------------------|---------------------|
| 移动加权平均成本（qty 加权） | FIFO / LIFO 成本核算 |
| 简单持仓数量累加 | 税务核算（印花税/红利税） |
| 浮盈公式预留（现价留接口） | 手续费分摊到成本 |

- 移动加权平均在 `BUY` 时重算 `cost_price`，在 `SELL` 时不变（只减数量）。
- `ADJUST` 直接覆盖 `quantity` 和 `cost_price`（人工兜底）。

---

### Q-8：写入入口

**问**: transactions 谁来写？
**答**: 按我的决策。
**决策**:
- 建 `PortfolioService.record_transaction(...)` 单一写入入口。
- 建 `/api/v1/portfolio/transactions` router，支持 POST（手动录入）+ GET（查询）。
- 未来 decision 模块通过调用同一 `PortfolioService.record_transaction` 写入，
  而非绕过 service 直接写库（保证双写一致性）。

---

## 模块边界

**单 module**: `modules/portfolio`（不拆 risk + portfolio）。

理由：风控是仓位数据的**读侧消费者**（PositionReader + RiskService 都查同一份持仓），
紧耦合；单 module 减少跨模块 Protocol。未来若风控膨胀，再拆出 `modules/risk` 不迟
（届时 risk import portfolio 的 Protocol，依赖方向清晰）。

---

## 第二轮 QA（2026-06-21 续）

### Q-1：双写一致性策略

**问**: 流水和持仓双写失败/漂移时如何处理？
**答**: (a) 信任双写 + (b) 留重建接口。
**决策**:
- 日常信任 positions 表为权威读源，双写在同一 UoW 事务内保证原子性。
- 提供维护接口 `rebuild_positions(...)`：按 transactions 全量重算 positions。
- 定期校验 job（reconciliation）**不实现**，留接口位给未来。

### Q-2：纠错机制（红冲）

**问**: 录入错误的交易如何纠正？
**答**: (a) 红冲。
**决策**:
- append-only 不可改不可删，纠错通过"新增反向冲销流水"完成。
- transactions 表新增 `reversal_of: TEXT NULL` 字段，指向被冲销的原 transaction_id。
- 红冲笔本身的 `action` 用反向动作（原 BUY → 红 SELL；原 SELL → 红 BUY）。
- 投影逻辑：红冲笔正常参与 SUM（反向动作天然抵消），无需特殊跳过。
- 一笔原交易**只能被红冲一次**（service 校验 `reversal_of` 唯一性）。

### Q-3：ADJUST 取消 + 初始导入方式

**问**: ADJUST 兜底要不要？存量怎么导入？
**答**: (b) 用 BUY 伪造初始导入，不要 ADJUST。
**决策**:
- **取消 ADJUST action**。`TransactionAction` 枚举仅 2 种：`BUY` / `SELL`。
- 存量导入：录一笔 `action=BUY, memo="初始导入"` 伪造历史。
- 纠错严格性：系统**永远不允许直接写持仓绝对值**，所有持仓变动必须通过
  BUY/SELL 的增减推导。出错时只能通过红冲 + 正确流水纠正。
- **副作用**: Q-6 schema 修订——`action` 枚举从 3 种改为 2 种，去掉 ADJUST。

### Q-4：零持仓状态

**问**: 标的全部卖出后 positions 行怎么办？
**答**: (c) 保留行 + closed_at 时间戳。
**决策**:
- `positions` 表新增 `closed_at: DATETIME NULL` 字段。
- quantity 归零时**不删行**，置 `closed_at = now()`。
- 重新建仓时清空 `closed_at`（恢复为 NULL）。
- 该字段支持"我曾经持有过什么"查询，供未来决策学习层消费。
- **副作用**: Q-6 schema 修订——positions 表追加 `closed_at` 字段。

### Q-5：读侧查询范围

**问**: 这次支持哪些查询？
**答**: (a) 全量 + (b) 单标的 + (c) 历史流水。盈亏信息要更详尽。
**决策**:
- 读侧 Protocol 暴露 3 个查询：
  - `list_positions(open_only=True)` —— 全量持仓一览（可过滤已关闭）。
  - `get_position(symbol)` —— 单标的当前持仓。
  - `list_transactions(symbol=None, time_range=None)` —— 历史流水查询。
- **时间旅行查询（"某时刻持仓快照"）本次不做**，实现成本高，留接口位。
- 盈亏详尽度（realized_pnl / unrealized_pnl / market_value）见 **Q-盈亏（未决）**。

### Q-6：标的元信息

**问**: 要不要建 instruments 表？
**答**: 不建表，但 symbol 加轻量 kind 字段。
**决策**:
- **不建** `instruments` 表。标的元信息属于行情/交易模块职责。
- `positions` 表和 `transactions` 表都加 `kind: TEXT NOT NULL` 字段，
  枚举值：`stock` / `fund` / `crypto`（先 3 种，枚举可扩展）。
- `symbol` 仍是裸字符串，portfolio 不解释其含义。
- **副作用**: Q-6 schema 修订——两张表都追加 `kind` 字段。

### Q-7：decision_id 回填

**问**: 流水写完后能否补 decision_id？
**答**: (b) 支持回填。
**决策**:
- transactions 表的 `decision_id` 可在写入时填，也可后续回填。
- service 暴露 `link_decision(transaction_id, decision_id)` 方法，**仅允许回填
  decision_id 这一个字段**，其他字段（含 memo）仍不可改。
- append-only 纯粹性让步：承认"先交易后补决策"是常见业务时序。
- 回填操作的审计由 trace_id 贯穿。

---

## schema 修订汇总（吸收第二轮决策）

### transactions 表（最终版）

```
transactions（append-only）
├─ id              TEXT PK
├─ symbol          TEXT NOT NULL
├─ kind            TEXT NOT NULL          ← Q-6 新增
├─ action          TEXT NOT NULL          枚举: BUY | SELL（Q-3 去掉 ADJUST）
├─ quantity        REAL NOT NULL          恒正
├─ price           REAL NOT NULL
├─ occurred_at     DATETIME NOT NULL
├─ trace_id        TEXT NOT NULL
├─ decision_id     TEXT NULL              可回填（Q-7）
├─ reversal_of     TEXT NULL              红冲指向（Q-2 新增）
├─ memo            TEXT NULL
└─ created_at      DATETIME NOT NULL
```

### positions 表（最终版）

```
positions（物化缓存）
├─ id              TEXT PK
├─ symbol          TEXT NOT NULL UNIQUE
├─ kind            TEXT NOT NULL          ← Q-6 新增
├─ quantity        REAL NOT NULL          当前持有数量（0 = 已清仓）
├─ cost_price      REAL NOT NULL          移动加权平均成本
├─ realized_pnl    REAL NOT NULL          累计已实现盈亏（Q-5 字段增减）
├─ opened_at       DATETIME NOT NULL      首次建仓时间
├─ last_transaction_at  DATETIME NOT NULL  最近一笔交易（Q-5 新增）
├─ closed_at       DATETIME NULL          清仓时间（Q-4 新增）
└─ updated_at      DATETIME NOT NULL
```

注意：`last_price` / `unrealized_pnl` / `market_value` **不入库**（见 Q-3 行情解耦），
读侧由调用方传入行情拼接（具体方式见 Q-盈亏，未决）。

### decisions 表（占位，本次不建 service/router）

```
decisions（占位 schema）
├─ id              TEXT PK
├─ agent           TEXT NOT NULL          Agent 引用（committee member）
├─ intent          TEXT NOT NULL          决策意图摘要
├─ payload         TEXT NOT NULL          结构化决策内容 JSON
├─ trace_id        TEXT NOT NULL
└─ created_at      DATETIME NOT NULL
```

---

## 第三轮 QA：盈亏归属（2026-06-21 续，方案 II 敲定）

### Q-盈亏-1：盈亏的"输出"边界

**问**: "输出现价"的"输出"到底指哪一层不输出？
**答**: 任何层都不输出 last_price。
**决策**:
- portfolio **永不对外返回 last_price**（API、service、domain 三层都不含）。
- portfolio 内部用现价算 unrealized_pnl，但只**输出盈亏结果**，不回吐输入的现价。
- 决策/分析端需要现价时，**自己找行情模块要**，不指望 portfolio 喂。

### Q-盈亏-2：盈亏持久化策略

**问**: unrealized_pnl 读时算还是持久化？
**答**: 持久化。读时算会增加时间。
**决策**: `unrealized_pnl` 入 positions 表，是**持久化的派生字段（缓存值）**。

### Q-盈亏-3：盈亏的更新时机 —— 方案 II

**问**: 盈亏何时刷新？三种解读 (I) 仅交易时 / (II) 交易时 + 预留 refresh 接口 / (III) 完全交行情模块。
**答**: (II)。
**决策**（方案 II 完整语义）:

#### 两字段写入责任

| 字段 | 写入者 | 何时写 | 数据来源 | 语义 |
|------|--------|--------|---------|------|
| `realized_pnl` | `record_transaction` | 每次 SELL 累加 | 流水自身 `(sell_price - cost_price) * qty` | 已落袋盈亏，纯记账 |
| `unrealized_pnl` | `record_transaction` **和** `refresh_pnl` | 交易时用成交价刷；未来行情调 refresh 用市场价刷 | 交易时=成交价；refresh=外部价 | 浮盈快照 |

#### 交易时刷新规则（record_transaction 内部）

- BUY 后：`unrealized_pnl = (买入价 - 新成本) × 新持仓 ≈ 0`（刚买入浮盈本就是 0，正确）。
- SELL 后：`unrealized_pnl = (卖出价 - 成本) × 剩余持仓`（按成交价算剩余持仓浮盈）。
- `pnl_updated_at = 该笔交易的 occurred_at`。

#### 未来行情刷新规则（refresh_pnl 接口，本次建好签名）

- 行情模块调 `refresh_pnl({symbol: market_price})`，用最新市场价重算 unrealized_pnl。
- `pnl_updated_at = refresh 调用时刻`。
- 不写流水（纯盈亏刷新，不是交易）。

#### 时序矛盾解决

- 行情变化不伴随交易 → 由未来 refresh_pnl 兜底刷新。
- 本次行情模块未接入 → unrealized_pnl 停在"最后一笔交易时的价格"，pnl_updated_at 标注新鲜度。
- 前端看 pnl_updated_at 判断盈亏新鲜度，不会误以为是实时。

#### 并发写约束（已知风险，本次不引入额外锁）

- record_transaction 和 refresh_pnl 都通过 UoW 写 positions。
- SQLite WAL + busy_timeout 模式下天然单写者序列化，单行 `WHERE symbol=?` 更新足够。
- 未来迁移 PostgreSQL 时再考虑显式行锁。
- **此项作为已知约束记录，不阻塞本次实现。**

### Q-盈亏-4：realized_pnl 在交易视图里的展示

**问**: "买卖历史算盈亏"指什么？
**答**: 每笔 SELL 当时的 realized_pnl（纯记账，不依赖行情）。
**决策**:
- `TransactionView`（读侧 DTO）的 SELL 笔带 `realized_pnl` 字段（该笔产生的已实现盈亏）。
- BUY 笔 `realized_pnl = None`（买入不产生已实现盈亏）。
- 计算纯从流水：`(sell_price - 当时cost_price) * qty`。

---

## schema 第三次修订（盈亏字段最终版）

### positions 表（含盈亏）

```
positions（物化缓存）
├─ id                  TEXT PK
├─ symbol              TEXT NOT NULL UNIQUE
├─ kind                TEXT NOT NULL          stock | fund | crypto
├─ quantity            REAL NOT NULL          当前持有数量（0=已清仓）
├─ cost_price          REAL NOT NULL          移动加权平均成本
├─ realized_pnl        REAL NOT NULL DEFAULT 0  累计已实现盈亏（SELL 累加）
├─ unrealized_pnl      REAL NULL              浮盈快照（方案 II，可被 refresh 刷）
├─ opened_at           DATETIME NOT NULL      首次建仓时间
├─ last_transaction_at DATETIME NOT NULL      最近一笔交易
├─ pnl_updated_at      DATETIME NULL          盈亏刷新时间（标注新鲜度）
├─ closed_at           DATETIME NULL          清仓时间
└─ updated_at          DATETIME NOT NULL
```

注：`last_price` **永不入库**（不输出现价原则）。unrealized_pnl 是计算结果缓存，
不回吐现价。

---

## 全部决策汇总（进 plan 前的最终态）

### 模块结构

- 单 module `modules/portfolio`，按现有 DDD 分层：
  `domain/` (protocol.py + dataclass) + `repo/` (orm.py + repository) + `service/`
- 对外 Protocol 集中在 `modules/portfolio/protocol.py`。

### 写侧（PortfolioService，async）

- `record_transaction(...)` —— 单一写入入口，双写流水+持仓，同时刷新 unrealized_pnl。
- `link_decision(transaction_id, decision_id)` —— 仅回填 decision_id。
- `rebuild_positions(...)` —— 维护接口，按 transactions 全量重算 positions。
- `refresh_pnl(market_prices)` —— 盈亏刷新接口，未来行情模块调用。

### 读侧（PositionReader，sync）

- `list_positions(open_only=True)` —— 全量持仓（可过滤已关闭）。
- `get_position(symbol)` —— 单标的当前持仓。
- `list_transactions(symbol=None, time_range=None)` —— 历史流水（含每笔 realized_pnl）。

### 占位（Protocol + 空实现，无业务逻辑）

- `RiskService.review(intent)` —— 永远返回通过。
- `decisions` 表 —— 只建表 + domain dataclass，无 service/router。

### 接入点

- 独立服务层（不侵入 workflow/execution）。
- `/api/v1/portfolio/transactions` router —— POST 录入 + GET 查询。
- `/api/v1/portfolio/positions` router —— GET 查询持仓。

---

## 未决项（未来模块负责，本次不实现）

- 实时行情获取（接入 `refresh_pnl` 接口）
- 任务派发（决策触发后调 `record_transaction`）
- 决策学习/迭代（消费 `decisions` 表）
- 风控规则业务逻辑（实现 `RiskService.review`）

本次为上述所有未来模块预留接口，接入时不动既有代码。
