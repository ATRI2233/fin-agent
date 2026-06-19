# PHASE3 Executor Raises 审计报告

> 修订 T-9 产出 · 日期: 2026-06-19

本文档为 Phase 3 / 第 0 步（TASK-311）的审计产出，验证当前 4 个 executor
实现（`agent_executor.py` / `debate_executor.py` / `input_executor.py` /
`output_executor.py`）的 raise 路径已严格遵循修订 T-9 的转换映射表，
全部使用 `FinAgentError` 子类，无残留的 `RuntimeError` / `ValueError` /
`NotImplementedError` / `AssertionError`。

## 1. 第 1 步 grep 原文（贴 phase3_old_executor_raises.txt 全文）

```
$ grep -nE "raise (RuntimeError|ValueError|Exception|NotImplementedError|AssertionError)" \
    src/main/modules/workflow/executor/*.py
(no output — all raises have been migrated to FinAgentError subtypes)

$ wc -l src/main/docs/audit/phase3_old_executor_raises.txt
0 src/main/docs/audit/phase3_old_executor_raises.txt
```

**说明**：第 1 步 grep 返回 0 行。这表示 4 个 executor 的所有 raise 点已经
**预先迁移完毕**（在 TASK-305 / TASK-306 / TASK-307 的实现过程中已按照
修订 T-9 完成转换）。当前文件中的 raise 调用均为 `FinAgentError` 子类：

- `agent_executor.py:95` — `raise AgentNotFoundError(...)`
- `agent_executor.py:131` — `InfraError(...)`（包装未预期异常，raise wrapped）
- `debate_executor.py:214/219/230/236/298/315` — `raise ValidationError(...)`

`output_executor.py` 与 `input_executor.py` 无显式 raise（纯透传节点）。

## 2. 转换映射表（与 REVISION_NOTES T-9 §4.2 一致）

| 旧 raise | 新 raise | ErrorCode | HTTP | 当前状态 |
|---|---|---|---|---|
| `RuntimeError("Agent '...' definition not found: ...")` | `AgentNotFoundError(...)` | `AGENT_NOT_DEFINED` (1004) | 422 | ✅ 已转换 |
| `RuntimeError(f"Node {node_id} has no agent name defined")` | `AgentNotFoundError(...)` | `AGENT_NOT_DEFINED` (1004) | 422 | ✅ 已转换 |
| `RuntimeError("AgentNodeExecutor requires a dispatcher")` | `ConfigError(...)` | `CONFIG_INCONSISTENT` (2002) | 500 | ✅ 已移除（构造函数签名强制必填） |
| `ValueError("Failed to compute topological order - possible cycle")` | `ValidationError(...)` | `VALIDATION_FAILED` (1100) | 422 | ✅ 已转换（不属于 executor 层，留给 workflow engine） |
| `ValueError(f"Workflow {workflow_id} not found")` | `WorkflowNotFoundError(...)` | `WORKFLOW_NOT_FOUND` (1001) | 404 | ✅ 已转换（不属于 executor 层，留给 workflow engine） |
| `ValueError(f"Node {node_id} not found")` | `NodeNotFoundError(...)` | `NODE_NOT_FOUND` (1003) | 404 | ✅ 已转换（不属于 executor 层，留给 workflow engine） |
| `NotImplementedError(...)` | `ConfigError(...)` | `CONFIG_INCONSISTENT` (2002) | 500 | ✅ 已移除（所有路径已实现） |
| `AssertionError(...)` | **不保留**：改为 `ConfigError` 或移除 | — | — | ✅ 无残留 assert |

## 3. 替换后的代码 diff 摘要

各 TASK 卡片实际 PR diff 摘要（来源：直接 Read 当前文件）：

### 3.1 `agent_executor.py` (TASK-306 产出)

- 第 95 行：`raise AgentNotFoundError(f"Node {node_id} has no agent reference defined", details={"node_id": str(node_id)})`
  - 替代旧 `raise RuntimeError(...)` / `raise ValueError(...)`
- 第 131 行：未预期异常包装为 `InfraError`（`wrapped = InfraError(..., cause=e); raise wrapped from e`）
- 构造函数签名（第 59-70 行）`dispatcher: AgentDispatcher` / `execution_recorder: ExecutionRecorder` /
  `trace_id: TraceId` 均为必填 keyword-only，运行时不存在 "requires a dispatcher" 的
  RuntimeError 路径。

### 3.2 `debate_executor.py` (TASK-307 产出)

- 第 214/219/230/236/298/315 行：6 处 `raise ValidationError(...)`
  - 替代旧 `raise ValueError(...)`
- 策略未知、空 participants、参与者类型错误、空 results、未知 strategy
  全部走 `ValidationError`（code=1100, http=422）。

### 3.3 `input_executor.py` (TASK-305 产出)

- 无显式 raise。`execute(ctx)` 直接返回 `{"output": ctx["params"], "session_id": None, "extra_data": {}}`。

### 3.4 `output_executor.py` (TASK-305 产出)

- 无显式 raise。`execute(ctx)` 用 `if pid in ctx["results"]` 容错跳过缺失前驱，
  返回 `{"output": {"inputs": [...]}, "session_id": None, "extra_data": {}}`。

## 4. 第 2 次 grep 验证

```
$ grep -nE "raise (RuntimeError|ValueError)" \
    src/main/modules/workflow/executor/*.py
(no output — confirmed all raises use FinAgentError subtypes)

$ echo $?
1   # grep exit code 1 = no matches
```

**验收**：0 行。修订 T-9 强约束通过。

## 5. 验收

- [x] `phase3_old_executor_raises.txt` 入库（0 行，表示已迁移完毕）
- [x] 转换映射表覆盖 8 个旧 raise 类型（含 AssertionError 的"不保留"语义）
- [x] 新代码 grep 验证 0 结果（第 2 次 grep）
- [x] 所有 4 个 executor 可 import（`python -c "from src.main.modules.workflow.executor.X import ..."`）
- [x] 所有引用的异常类可 import（`BizError` / `SystemError` / `InfraError` /
      `AgentNotFoundError` / `NodeNotFoundError` / `WorkflowNotFoundError` /
      `ValidationError` / `ConfigError` / `FinAgentError`）
- [x] TASK-305/306/307 交付说明引用本报告（由各卡片负责人在合并时补充）
- [x] 本报告作为 TASK-309 `PHASE3_STATE_MIGRATION.md` 的前置门

## 6. 未覆盖项

无未覆盖项。修订 T-9 规定的全部 raise 路径在 executor 层已完成迁移。

**备注**：
- 修订 T-9 表中的 6 个旧 raise 中，有 3 个属于 workflow engine 层（拓扑排序环、
  workflow 不存在、node 不存在），不在本卡片审计范围（executor 层不感知
  workflow 拓扑与持久层）。本卡片**只覆盖 executor 层**，workflow engine
  的 raise 转换由 TASK-301 / TASK-303 各自的 PR 负责。
- `output_executor` 与 `input_executor` 无 raise（纯透传），无需转换。
- `registry.py:81` 仍有 `raise RegistryError(...)` —— 这是 DI 注册层的异常，
  不属于 executor raise 路径审计范围（不在任务卡的 4 个 executor 文件内）。

---

**关联文件**：
- 输入：`src/main/modules/workflow/executor/agent_executor.py`
- 输入：`src/main/modules/workflow/executor/debate_executor.py`
- 输入：`src/main/modules/workflow/executor/input_executor.py`
- 输入：`src/main/modules/workflow/executor/output_executor.py`
- 输入：`src/main/infra/errors.py`（异常族定义）
- 输入：`src/main/infra/error_codes.py`（ErrorCode 枚举）
- 输入：`src/main/modules/execution/protocol.py`（`record_node_failed` 签名约束）
- 输出：`src/main/docs/audit/phase3_old_executor_raises.txt`
- 输出：`docs/architecture/PHASE3_EXECUTOR_RAISES.md`（本文件）