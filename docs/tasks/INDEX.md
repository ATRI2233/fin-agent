# Fin-Agent 重构任务卡索引

> 来源: `docs/architecture/TARGET_ARCHITECTURE_v2_2026-06-18.md` (v2.1)
> 参考修订: `docs/architecture/REVISION_NOTES_2026-06-18.md` (修订 A-1 / A-2 + T-1 至 T-12)
> 总卡片数: **56** + 本 INDEX + TEMPLATE = 58 个文件
> 周期: ~12 周（按 phase 顺序执行,跨切可并行;v2.1 + 修订 T-* 追加约 2 周工作量）
> **更新日期**: 2026-06-19（新增 TASK-014, TASK-500,详见 §10 修订摘要）

## 0. 修订日志（卡片索引跟随修订）

| 修订 ID | 触发卡片 | 备注 |
|---|---|---|
| 修订 A-1 | （仅文档） | CLAUDE.md 实际列出 `services/{core,patterns,queries}/`,漏标 shim；TASK-501 删除前必须扫描 |
| 修订 A-2 | TASK-007 / TASK-008 | `constants.py` 实际有 **6 条常量**,端口 4096 硬编码 **3 处**(settings + constants + container fallback) |
| 修订 T-1 | TASK-201 (删) + TASK-301 (加) | `CircuitBreaker` Protocol 从 execution 模块移到 workflow 模块 |
| 修订 T-2 | TASK-301 (docstring) + TASK-310 (实现) | 熔断器 key = `f"{execution_id}:{node_id}"`,严禁仅以 node_id |
| 修订 T-3 | TASK-108 | `AgentDispatcher.dispatch_parallel` 返回 `extra_session_ids` 是 debate 辅助 session,不与主 session 重叠 |
| 修订 T-4 | TASK-202 | CLEANED_UP 终态不可复活;新增 retry 必须开新 execution |
| 修订 T-5 | TASK-011 | `Registry.resolve_sync()` 给 Settings 等同步依赖使用 |
| 修订 T-6 | TASK-501（前置条件） | 删除 shim 前必须扫描 3 份 importer 清单 |
| 修订 T-7 | **Phase 1.5 / TASK-114** | 新增独立 Phase 1.5 trace_id 签名变更局部验证 |
| 修订 T-8 | **TASK-410** | webui envelope 破坏性变更需 `_legacy_compat.py` 兼容层 |
| 修订 T-9 | **TASK-311** | Phase 3 第 0 步:executor raise 路径全面审计 |
| 修订 T-10 | **TASK-013** | Phase 0 子任务 0.6:DBHealthProbe + `/api/v1/system/db_health` |
| 修订 T-11 | TASK-011 | `Registry.shutdown()` 显式 dispose SQLAlchemy engine |
| 修订 T-12 | TASK-CCC-04（grep） | 验收清单追加 14 项 grep 验证 |

## 1. 编号与命名

- 卡片 ID: `TASK-{NNN}-{slug}` 或 `TASK-CCC-NN-{slug}`(跨切)
- 前 3 位为全局顺序编号,**非优先级**(实际优先级看 §3)
- `slug` 为英文短描述,用于文件名
- 新增卡片一律**追加**在所属 phase 末尾(避免重编号破坏依赖引用)

## 2. 阶段汇总

| 阶段 | 卡片数 | 估时 | 路径 | 主交付 |
|---|---|---|---|---|
| **Phase 0** 基础设施 | 14 | ~1.5 周 | `phase-0-infrastructure/` | `infra/` 全层 + DBHealthProbe + retry 装饰器 |
| **Phase 1** agent + mcp | 9 | 2 周 | `phase-1-agent-mcp/` | mcp + agent 模块 |
| **Phase 1.5** tracing 验证 | 1 | 1 周 | `phase-1.5-tracing-validation/` | 单链路 trace_id 显式参数化试点 |
| **Phase 2** execution | 4 | 1.5 周 | `phase-2-execution/` | execution 模块 |
| **Phase 3** workflow | 11 | 3 周 | `phase-3-workflow/` | workflow 模块 + 2 份强制报告 |
| **Phase 4** conversation + API | 11 | ~2.5 周 | `phase-4-conversation-api/` | conversation + FastAPI + webui 兼容层 + build_registry |
| **Phase 5** cleanup | 2 | ~1.5 周 | `phase-5-cleanup/` | 切换 shim importer + 删 framework/ + 更新 CLAUDE.md |
| **跨切** | 4 | 与各阶段并行 | `cross-cutting/` | CONTRIBUTING / conftest / 关键测试 |

**子阶段命名说明**：本目录使用 "Phase 0.6" / "Phase 1.5" / "Phase 4 子任务 4.3" 等子阶段前缀仅用于排序/标识，**等同**于所属 Phase 的依赖与 Gate。卡片标题里若自称"Phase 0.6"或"Phase 4.3"，实际派发顺序与所属 Phase 完全一致，不要在 Gate 检查里把子阶段当作独立阶段。

## 3. 任务依赖图（高层）

```
Phase 0 内部:
  TASK-001 (scaffold)
    ├→ TASK-002 (domain)         ─┬→ TASK-003 (error_codes + errors)
    ├→ TASK-007 (settings) ──────┤
    │                              ├→ TASK-009 (db)
    │                              ├→ TASK-010 (uow)    ← 需要 TASK-009
    │                              └→ TASK-011 (di) ← 修订 T-5 + T-11
    ├→ TASK-004 (api_envelope)     ← 需要 TASK-003
    ├→ TASK-005 (tracing)          ← 需要 TASK-002
    └→ TASK-006 (logging)          ← 需要 TASK-005
  TASK-008 (constants)             ← 需要 TASK-007
  TASK-012 (auth + event_bus)      ← 需要 TASK-007
  TASK-013 (db_health probe) ← 修订 T-10,需 TASK-009 + TASK-011
  TASK-014 (infra/retry decorator) ← 需 TASK-002 + TASK-003

Phase 0 完成 (TASK-001~014) → Phase 1 全部可启动

Phase 1 内部:
  TASK-101 (mcp/protocol) → TASK-102 (mcp/domain) → TASK-103 (loader) → TASK-104 (service)
  TASK-105 (agent/protocol) → TASK-106 (domain+repo) → TASK-107 (serve_backend) → TASK-108 (dispatcher) → TASK-109 (session_manager)

Phase 1.5:
  TASK-114 (trace_id validation) ← 需 TASK-005 + TASK-105 + TASK-107 + TASK-108

Phase 1.5 完成 → Phase 2/3 可启动

Phase 2 内部:
  TASK-201 (execution/protocol) → TASK-202 (domain + state_machine) → TASK-203 (orm) → TASK-204 (service)

Phase 3 内部:
  TASK-301 (workflow/protocol) → TASK-302 (domain: node/edge/workflow/dag) → TASK-303 (orm+repo)
                                                              → TASK-304 (executor base+registry)
                                                                  ├→ TASK-305 (input/output_executors)
                                                                  ├→ TASK-306 (agent_executor) ← **state 审计关键卡**
                                                                  ├→ TASK-307 (debate_executor)
                                                                  └→ TASK-308 (prompt + query_service)
                                                                      → TASK-311 (executor raise audit) ← 修订 T-9,需 TASK-306/307
                                                                          → TASK-309 (workflow_runner + retry + scheduler + PHASE3_STATE_MIGRATION.md)
                                                                          → TASK-310 (PHASE3_EXECUTOR_RAISES.md,本卡仅引用 TASK-311 产出)

  注: TASK-311 是 TASK-309 的硬前置(Phase 3 第 0 步);TASK-310 是错误分类的独立报告卡。
  注: TASK-310 的 `retry_on_failure` 装饰器依赖 **TASK-014 (infra/retry.py)** —— 不再"顺带创建"。

Phase 4 内部:
  TASK-401 (conversation/protocol) → TASK-402 (domain) → TASK-403 (orm+repo) → TASK-404 (service)
  TASK-405 (api/deps)        ← 需 TASK-011
  TASK-406 (api trace middleware)   ← 需 TASK-005
  TASK-407 (api exception handlers) ← 需 TASK-003, TASK-004
  TASK-408 (api/v1 mcp + agents)    ← 需 TASK-405, TASK-103, TASK-108
  TASK-409 (api/app.py create_app + lifespan + middleware/router 装配) ← 需 TASK-405, TASK-406, TASK-407, TASK-408, TASK-410
  TASK-410 (webui envelope compat layer) ← 需 TASK-407, 修订 T-8
  TASK-411 (main.py build_registry + __main__ 入口) ← 需 TASK-011, TASK-013, **TASK-409** (create_app)

  注: TASK-409 与 TASK-411 共同拆分原"main.py"职责。TASK-409 拥有工厂; TASK-411 拥有进程入口。详见各卡片 §1 元数据 "范围说明" 字段。

Phase 5 内部:
  TASK-500 (shim importer 切换 + 3 份 txt 报告) ← 需 TASK-409 + TASK-410
  TASK-501 (删 framework/ + 占位目录 + 更新 CLAUDE.md) ← 需 TASK-500 + TASK-CCC-04 全绿

  注: 原"Phase 5 cleanup"被拆为 TASK-500(切换)+ TASK-501(删除)。3 份 importer 扫描/切换与"rm -rf framework/"分离,前者6h,后者4h。

跨切:
  TASK-CCC-01 (CONTRIBUTING.md)         ← 无依赖,随时可做
  TASK-CCC-02 (tests/conftest.py)        ← 需 TASK-409
  TASK-CCC-03 (tests/infra/test_tracing) ← 需 TASK-005 + TASK-411
  TASK-CCC-04 (tests/infra/test_di+uow)  ← 需 TASK-010, TASK-011, TASK-409
```

## 4. 关键里程碑（必须设硬关卡）

| Gate | 触发卡片 | 不通过则阻塞后续 |
|---|---|---|
| **Gate 0** | TASK-011 (DI + resolve_sync + engine dispose) + TASK-003 (errors) 完成 | Phase 1 不可启动 |
| **Gate 0.5** | TASK-013 (DBHealthProbe) 完成 | Phase 4 子任务 4.x 的 `/api/v1/system/*` 路由不可启动 |
| **Gate 1** | TASK-101, 105 (mcp/agent Protocol) 完成 | Phase 1 后续不可启动 |
| **Gate 1.5** | **TASK-114 (trace_id 验证) + test_serial_trace_passthrough 通过** | Phase 2/3 全链路 trace_id 改动不可启动 |
| **Gate 2** | TASK-201 (execution Protocol,无 CircuitBreaker) 完成 | Phase 2 后续不可启动 |
| **Gate 3** | TASK-301 (workflow Protocol + CircuitBreaker + composite key) + TASK-204 (execution service) 完成 | Phase 3 workflow_runner 不可启动 |
| **Gate 3.5** | **TASK-311 (executor raise audit) + PHASE3_EXECUTOR_RAISES.md 提交** | Phase 3 diff 校验不可启动 |
| **Gate 4** | **TASK-309 (PHASE3_STATE_MIGRATION.md 报告提交)** | Phase 4 不可启动,API 集成层不可写 |
| **Gate 4.5** | **TASK-410 (webui envelope 兼容层 + 双形状 e2e 通过)** | Phase 5 不可启动 |
| **Gate 5** | TASK-409 (api/app.py create_app + lifespan + middleware/router 装配) 完成 | TASK-411 (build_registry + __main__ 入口) 不可启动 |
| **Gate 5.5** | TASK-411 (main.py 进程入口 + 全链路集成测试) 完成 | Phase 5 不可启动 |
| **Gate 5.7** | **TASK-500 (shim importer 切换 + 3 份 txt 入库)** | TASK-501 (rm -rf) 不可启动 |
| **Gate 6** | TASK-501 (cleanup + CLAUDE.md 重写 + grep 全清) 完成 | 项目标记 done |

## 5. 每张卡片结构（参见 TEMPLATE.md）

```
1. 元数据 (ID/阶段/前置/估时)
2. 目标 (1-2 句)
3. 上下文范围 (输入文件 / 输出文件)
4. 详细步骤
5. Do Not 清单 (本卡片相关)
6. 验收标准 (可执行的检查)
7. 非目标 (明确不做)
```

## 6. 防呆约定（适用于所有卡片）

- 子代理必须**逐条**对照 Do Not 清单并在交付时声明已核对
- 验收标准里所有 grep / pytest 命令必须**实际执行**通过,粘贴输出到交付说明
- 若发现某卡片验收标准无法满足,子代理必须**停止**并升级,不得"标记完成绕过"
- 跨卡片依赖:若前置卡片尚未完成,本卡片必须等待,不得"借用旧代码"作为占位
- 所有 `Protocol` 类文件（`*/protocol.py`）必须用 `typing.Protocol`(runtime_checkable 可选),不得用 `abc.ABC` 混入实现细节
- **修订 T-* 触发的卡片**:实现前必须重读 `REVISION_NOTES_2026-06-18.md` 对应条目;完成后必须在交付说明引用修订 ID

### 6.1 Do Not 中央注册表（设计文档 §9 同步）

> **所有卡片 §5 Do Not 引用必须对齐本表**。漂移的描述由子代理在本表基础上统一;
> 若本表与设计文档 §9 冲突,以设计文档为准,本表同步更新。
>
> 子代理撰写卡片 §5 时,直接抄本表对应行,**不要**改写措辞。

| # | 规则 | 统一描述 | 验证 grep |
|---|---|---|---|
| 1 | 禁止跨模块 import 下划线开头的私有成员 | 跨模块 `from X import _xxx` 一律禁止;需要共享必须升 Protocol | `grep -rnE "from [^\s]+ import _" src/main/modules/` |
| 2 | 禁止 `hasattr(...)` + `setattr(...)` 反射修改其他类私有属性 | 接口没对齐时用反射修补 = 隐藏 bug;改 Protocol | `grep -rnE "hasattr.*setattr" src/main/` |
| 3 | 禁止 `except Exception: pass` 吞异常 | 任何吞掉的异常都会变成"线上诡异现象";必须向上抛或转 FinAgentError | `grep -rnE "except Exception: pass" src/main/` |
| 4 | 禁止字符串匹配异常文本做分类(如 `if "HTTP 5" in str(e)`) | 异常必须结构化(继承 FinAgentError + ErrorCode) | `grep -rnE 'if "HTTP 5"' src/main/` |
| 5 | 节点执行器直接操作 DB Session / commit / rollback | 事务边界 = UoW;执行器是纯函数 | `grep -rnE "self\._db\|Session\(\)" src/main/modules/workflow/executor/` |
| 6 | 保留双胞胎 / shim 模块 / 两条导入路径 | 重构期一次性切换;不允许共存 | `grep -rnE "shim\|legacy_compat" src/main/`(Phase 5 收尾时应为 0) |
| 7 | 业务代码读 `os.environ` / 直接拼 URL | 全部走 `settings.py`(pydantic-settings) | `grep -rnE "os\.environ\|os\.getenv" src/main/modules/` |
| 8 | 业务代码 inline 数值(端口/超时/重试次数/路径前缀) | 全部走 `settings.py` 或 `constants.py` | `grep -rnE "(4096\|600\|300)\b" src/main/modules/`(仅 settings/constants 允许) |
| 9 | 节点类型用字符串字面量(`"input"/"output"/"debate"`) | 必须用 `NodeType` 枚举 | `grep -rnE 'NodeType\("input"\)\|"input"\|"output"\|"debate"' src/main/modules/` |
| 10 | 状态用字符串字面量(`"pending"/"running"/"failed"`) | 必须用 `ExecutionStatus` 枚举 | `grep -rnE '"pending"\|"running"\|"completed"\|"failed"\|"skipped"' src/main/modules/` |
| 11 | 单例缓存的 Executor Registry | Executor 必须无状态,每次新建 | `grep -rnE "@lru_cache\|executor_cache" src/main/modules/workflow/` |
| 12 | 模块级全局变量保存服务实例(`_container`, `_db`, ...) | FastAPI `app.state` + DI Registry | `grep -rnE "^[A-Z_]+ *[:=] *[^=].*=\|_[a-z_]+ *=" src/main/modules/.*\.py \| grep -v "settings\|constants"` |
| 13 | `from X import _private_func` | 私有 = 私有;需要公开 → 升 Protocol(与 #1 同源,作为反例) | `grep -rnE "from [^\s]+ import _[a-z]" src/main/modules/` |
| 14 | 测试用单独的注册路径(`register("name", instance)`) | 必须 `app.dependency_overrides[service_dep(...)] = lambda: mock` | `grep -rnE 'register\("' tests/` |
| 15 | 日志用 `print()` / `%s` 拼接 | 必须 structlog JSON + contextvars | `grep -rnE "print\(\|logger\.[a-z]+\(.*%s\|f\"" src/main/modules/` |
| 16 | Agent 抛出非 FinAgentError 子类的异常 | 任何 agent 层异常必须 catch 后包成 `AgentTimeoutError`/`AgentHttp5xxError`/`McpServerError` 之一 | `grep -rnE "raise (httpx\|requests\|RuntimeError\|ValueError)" src/main/modules/agent/` |
| 17 | 注释 / 文档里出现 "N" / "P1 pilot" 等迭代标记 | 迭代历史走 git / CHANGELOG | `grep -rnE "Wave [0-9]\|P1 pilot\|pilot 阶段" docs/tasks/` |
| 18 | 依赖 `ContextVar` / `structlog.contextvars` 在 `asyncio.gather` 并行任务间隐式传递 `trace_id`;worker 必须显式接 `trace_id: TraceId` 参数并 `bind_contextvars` | ContextVar 在跨 Task 调度时只继承调度时刻快照,子 Task 的 set 不会回写;一旦污染,日志 trace_id 错乱且不可复现 | `grep -rnE "trace_id_var\.set\|trace_ctx_var\.set" src/main/modules/`(worker 体内应 0) |
| 19 | 执行器构造函数或类体内出现 `_results / _failed_nodes / _skipped_nodes / _chain_sessions / _db` 等可变状态字段 | 执行器必须无状态;所有跨调用持久化状态由 WorkflowRunner 独占,通过 `NodeContext` 只读快照传入。并行执行时任何共享实例字段 = 数据串读 | `grep -rnE "self\._(results\|failed_nodes\|skipped_nodes\|chain_sessions\|db)" src/main/modules/workflow/executor/` |

> **本表与 P1-P10 关系**:
> - P8「重试只一层」是**设计原则**(原则 #8),**不**对应 Do Not #8;卡片在 §5 引用重试限制时,应写"**P8 约束**"或"**重试只一层**",**不要**标 Do Not #8(避免与 inline 数值规则混淆)。
> - P6「DI 单一入口」与 Do Not #6「禁止保留 shim」也不同源;P6 对应 Do Not #11/12/14 三条,**不要**用 Do Not #6 描述 DI 边界。

## 7. 优先级排序（建议的派发顺序,跨阶段并行）

```
Week 1-1.5 (Phase 0):
  Day 1-2:  TASK-001 → 002 → 003 (串行)
  Day 2-3:  TASK-005, 007, 011 (并行,各 0.5d)
  Day 3-4:  TASK-009, 010, 006 (并行)
  Day 4:    TASK-004, 008, 012 (收尾) + TASK-CCC-01
  Day 5:    TASK-013 (DBHealthProbe) + TASK-008 修订 A-2 增补

Week 2-3 (Phase 1, 与 Phase 0 收尾并行启动):
  Week 2:   TASK-101, 105 (Protocol 优先) → 102, 106, 107
  Week 3:   TASK-103, 104, 108, 109

Week 3 (Phase 1.5, 串行插入):
  Week 3:   TASK-114 (trace_id 验证) + test_serial_trace_passthrough 跑通

Week 3-4 (Phase 2):
  Week 3:   TASK-201, 202
  Week 4:   TASK-203, 204

Week 4-6 (Phase 3, 最复杂):
  Week 4:   TASK-301, 302, 303, 304 (Protocol + 基础设施)
  Week 5:   TASK-305, 306, 307, 308, 311 (4 executor + query + raise audit)
           ↑ TASK-311 输出 PHASE3_EXECUTOR_RAISES.md 后才能进 TASK-309
  Week 6:   TASK-309 (runner + retry + scheduler + state migration 报告)

Week 7-8.5 (Phase 4):
  Week 7:   TASK-401, 402, 403, 404, 405, 406, 407 (并行 7 个)
  Week 8:   TASK-408, 409, 410 (router + app factory + webui compat)
  Week 8.5: TASK-411 (build_registry + __main__ 入口)

Week 8.5-9 (Phase 5 + 跨切):
  TASK-501 (含 shim importer 扫描), CCC-02, CCC-03, CCC-04

Week 10-12 (buffer + 全链路验收):
  pytest 全部 / curl 集成测试 / grep 验收清单(含修订 T-12 14 项 grep)
```

## 7.1 卡片估时 vs Phase 周数差距说明

> **重要**:卡片元数据 `估时` 字段记录的是 **纯编码小时数**(写代码 + 写最小自测)。
> Phase 周数包含**上下游协调 / 集成 / review / 重做**等开销,实际工时通常是卡片估时的 **2-3 倍**。
>
> 当前估时差距(2026-06-18):
>
> | Phase | INDEX 周数 | 卡片小时累计 | 折算周 (6h/d × 5d/w) | 差距倍数 |
> |---|---|---|---|---|
> | Phase 0 | 1.5 周 ≈ 45h | 59h | 2.0 周 | 0.76× 🔴 |
> | Phase 1 | 2 周 ≈ 60h | 28h | 0.9 周 | 2.0× buffer |
> | Phase 2 | 1.5 周 ≈ 45h | 11h | 0.4 周 | 3.8× buffer |
> | Phase 1.5 | 1 周 ≈ 30h | 30h | 1.0 周 | 1.0× ✅ |
> | Phase 3 | 3 周 ≈ 90h | 57h | 1.9 周 | 1.6× buffer |
> | Phase 4 | 2.5 周 ≈ 75h | 36h | 1.2 周 | 2.1× buffer |
> | Phase 5 | 1.5 周 ≈ 45h | 16h | 0.5 周 | 2.8× buffer |
>
> 结论: Phase 0 估时偏紧,无 buffer;Phase 1-4 卡片估时偏理想化,**实际工时 = 卡片小时 × 2~3**。
> 派发时若子代理报告"卡片估时偏差 > 50%",应触发 **修订 T-13** (后续,本轮未实现) 并重新评估 Phase 周数。

## 8. 风险与回滚点

| 风险卡片 | 缓解 |
|---|---|
| TASK-306 (agent_executor 迁移) | 必须产 PHASE3_STATE_MIGRATION.md,否则回滚整个 Phase 3 |
| TASK-309 (workflow_runner) | 单元测试覆盖所有 DAG 形态(线性 / 扇出 / 扇入 / 钻石) |
| TASK-311 (executor raise audit) | 转换映射表必须 100% 覆盖,否则回滚至 TASK-305~308 重写 |
| TASK-409 + TASK-411 (main.py / api/app.py) | 必须保留旧 `framework/` 路径双轨运行直到集成测试通过 |
| TASK-410 (webui compat) | 双形状 e2e 必须全绿;若失败 webui 旧代码立即回退 |
| TASK-501 (cleanup) | 3 份 importer 清单(phase0_shim_importers.txt / phase0_init_consumers.txt / phase0_reexport_consumers.txt)未清零,禁止 rm -rf |

---

## 9. TASK-409 ↔ TASK-411 范围划分（2026-06-18 拆分）

原"main.py 集成卡"被拆为 **TASK-409** 与 **TASK-411** 两张,各占独立文件:

| 卡片 | 输出文件 | 拥有职责 |
|---|---|---|
| **TASK-409** | `src/main/api/app.py` | `create_app()` 工厂(接收外部 registry 参数) + `lifespan` + middleware / router 装配 |
| **TASK-411** | `src/main/main.py` | `build_registry()` 全局装配 + `__main__` 入口(`uvicorn.run`) |

**依赖方向**: TASK-411 → TASK-409 (main.py 调 create_app,单向,**无环**)。
**测试方向**: TASK-409 可用 mock registry 独立测试; TASK-411 需 TASK-409 已交付才能跑集成测试。
**Gate**: Gate 5 = TASK-409 完成 → TASK-411 可启动; Gate 5.5 = TASK-411 完成 → Phase 5 可启动。

14 张曾引用"TASK-411"但实际不存在的元数据已全部修正:
- TASK-004 / 006 / 007 / 011 / 012 / 013 / 107 / 309 / 310 / 408 / 409 / 501 → 引用 TASK-411 (build_registry + __main__) ✓
- TASK-405 / 406 / 407 / 408 的"不实现 app factory"备注 → 改为 TASK-409 (create_app 工厂) ✓
- TASK-114 的"main.py lifespan — TASK-411 范围" → 改为 TASK-409 范围 ✓

---

## 10. INDEX 修订摘要

### 2026-06-18 第一轮：TASK-411 创建 + 子阶段命名 + 估时说明

| 项 | 修订前 | 修订后 |
|---|---|---|
| 总卡片数 | 55（声明）/ 53（实际） | **54**（声明与实际一致） |
| Phase 4 卡片数 | 10 | **11**（新增 TASK-411） |
| Gate | Gate 5 (TASK-409) | **Gate 5 (TASK-409) + Gate 5.5 (TASK-411)** |
| 卡片估时差距 | 未说明 | §7.1 新增(2-3 倍 buffer 说明) |
| 子阶段命名 | 不统一 | §2 表格后追加"等同所属 Phase"声明 |

### 2026-06-19 第二轮：TASK-014 抽出 + TASK-501 拆分 + 契约修正

| 项 | 修订前 | 修订后 |
|---|---|---|
| 总卡片数 | 54 | **56**（新增 TASK-014 + TASK-500） |
| Phase 0 卡片数 | 13 | **14**（新增 TASK-014 infra/retry.py） |
| Phase 5 卡片数 | 1 | **2**（拆分为 TASK-500 + TASK-501） |
| 卡片估时 | TASK-310 5h | **TASK-310 6h,2 文件**(原 3 文件拆为 TASK-014) |
| 卡片估时 | TASK-501 3h | **TASK-500 6h + TASK-501 4h** |
| Gate | Gate 6 (TASK-501) | **Gate 5.7 (TASK-500) + Gate 6 (TASK-501)** |
| TASK-009 SessionLocal 契约 | "本卡片不导出" | **改为"导出 get_session_local(engine) 工厂"** |
| TASK-411 build_registry | 漏 CircuitBreaker 注入 | **先注册 CircuitBreaker,再注入 RetryService** |
| TASK-411 14 个实现类 | 只列 Protocol | **§3.2 补全 import 路径** |
| TASK-310 跨阶段创建 infra | "本卡片顺带创建" | **改为依赖 TASK-014(分层归位)** |
| TASK-002 前置元数据 | 只标 TASK-001 | **补 TASK-003**（AgentReference.from_node 需 BizError） |
| TASK-501 修正日志 | §4.1/4.2 既有 importer 扫描又有删除 | **拆为 TASK-500 切换 + TASK-501 删除** |
| TASK-310 §3.2 笔误 | "TASK-305/006/007" | **改为 "TASK-305/306/307"** |

### 2026-06-19 第三轮：核心阻塞 + 规范层修复

**Wave 1（4 代理并行）— 解决实施阻塞**:
- **B-1**: TASK-002 ↔ TASK-003 循环依赖破除（删除 TASK-003 前置 TASK-002）
- **A-1**: AgentReference 路径统一（3 张卡改为 `infra.domain.AgentReference`）
- **E-2**: TASK-201 ExecutionRecorder 7 个方法全 async（避免与 TASK-309 await 调用冲突）
- **C-3**: TASK-107 删 `current_trace_id()` 隐式取，改用 `trace_id` 参数
- **D-1~3**: TASK-500 4 处虚构路径全修（service_dep / WorkflowReader / ExecutionService / create_app）
- **F-12**: TASK-411 §1 前置从 3 个扩到 22 个（按 Phase 分组）
- **G-9/G-10**: TASK-CCC-04 test_T12_02 改计数检查 / test_T12_03 改 static_check

**Wave 2（3 代理并行）— 规范层**:
- **F-1 (9 张)**: 9 张卡 §1 vs §3.2 前置补齐
- **H**: INDEX §6.1 新增 Do Not 中央注册表（19 条 + 验证 grep + Top 5 漂移热点）
- **I**: 7 张卡估时单位统一为 h（1.5d→9h, 1 周→30h, 偏紧值上调）

**Wave 3（3 代理并行）— 剩余项**:
- **F-1 (28 张)**: 28 张卡 §1 vs §3.2 前置补齐（覆盖 9 阶段 + 跨切）
- **A-1 余波**: TASK-003 §3.2/§4 改用前向引用（破循环后 §3.2 引用矛盾）
- **J 类**: 3 张卡 header 上下文窗口（6→9 / 1→2 输出）
- **G-7**: TASK-307 §6 grep 单行正则改两行独立 grep
- **G-1/3/4/5/8/12**: 6 个不达验收的 §6 grep/python 验证（next 查找 / import-only grep / 必填字段 / 1 参构造 / 表格分隔行 / pytest 文件说明）
- **5.4 §8 防伪**: 56 张卡 §8 模板前加 `> ⚠️ 实际执行命令后粘贴真实输出,禁止复制本节中的预期输出作伪。`
- **5.3 P0 粒度细化**: 35 张卡调整优先级（P0: 51→20, P1: 2→34, P2: 0→2）

### 优先级分布（Wave 3 后）

| 优先级 | 卡片数 | 说明 |
|---|---|---|
| **P0** | 20 | 阻塞后续 Phase / 在 Gate 关键路径 |
| **P1** | 34 | 内部重要但不阻塞 Phase 转换 |
| **P2** | 2 | TASK-001 / TASK-008 纯辅助卡（≤2h 无外部依赖） |

---

**下一步**: 翻到对应 phase 目录,按编号顺序派发子代理。每张卡片都是自包含的:把卡片内容 + 设计文档相应章节 + 修订条目 喂给子代理,即可独立完成。

---

## 11. 后续待办（高 ROI 但本轮未做）

按上轮正确性/可行性/性价比分析，下列修复建议由用户决定是否进入下一轮：

| 优先级 | 项 | 工作量 | 备注 |
|---|---|---|---|
| 🟡 P1 | F-1: 所有卡片 §3.2 "类型依赖"补完整 import 路径 | 2-3h | 涉及 30+ 卡片,需逐个审 |
| 🟡 P1 | C-8/C-12: TASK-202 ExecutionNode.agent 改 `AgentReference` 而非 `str` | 1h | 与 TASK-302 Node.agent 类型一致 |
| 🟡 P1 | C-7: TASK-108 dispatch_parallel 语义二义性(gather+return_exceptions vs Raises) | 30min | 二选一明确 |
| 🟡 P1 | F-4: TASK-310 §4.2 scheduler 完整伪代码 | 1h | APScheduler 关闭流程缺失 |
| 🟡 P1 | C-20: TASK-309 6 依赖注入爆炸 → 改 deps dataclass | 1h | 可读性 |
| 🟡 P1 | C-18: TASK-310 retry_workflow 缺 params 参数 | 30min | 协议错误 |
| 🟡 P1 | C-19: TASK-401 append_message 缺 agent 维度 | 30min | 与 TASK-109 SessionManager 联动 |
| 🟢 P2 | F-7: TASK-308 prompt_builder 完整语法规范 | 1h | 失败 case 缺失 |
| 🟢 P2 | F-8: TASK-202 transition 与 state_machine.validate_transition 合并 | 1h | 重复函数 |
| 🟢 P2 | F-9: TASK-309 execution_id=None 分支异常路径 | 30min | 漏 try/except |
| 🟢 P2 | 5.4 §8 交付模板 `<!-- 实际执行后粘贴 -->` 占位 | 30min | 防止子代理复制预期输出伪造证据 |
| 🟢 P2 | 5.3 P0/P1 优先级粒度细化（51 张 P0 太多） | 1h | 区分 P0-blocker vs P0-important |
| 🟢 P2 | §3.2 cross-cutting 实际串行而非并行的备注 | 10min | 文档澄清 |
| 🟢 P2 | TASK-CCC-04 §4.3 #3 占位测试替换/删除 | 1h | CI 信号质量 |
| 🟢 P2 | C-16: TASK-114 test_parallel_trace_isolation 与 §7.6 矛盾 | 30min | MockBackend 显式接 trace_id |
| 🟢 P2 | 任务列表清理（#11-#13 三个"分析"任务可删除） | 5min | 已 completed |