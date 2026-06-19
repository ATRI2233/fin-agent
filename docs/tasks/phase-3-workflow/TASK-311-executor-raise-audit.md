# TASK-311: Phase 3 第 0 步 — Executor raise 路径全面审计 + PHASE3_EXECUTOR_RAISES.md

> **阶段**: Phase 3 / 第 0 步（在 TASK-309 state migration 之前必做） · **估时**: 6h · **优先级**: P0
> **上下文窗口**: 1 grep 命令 + 1 报告
> **关联修订**: REVISION_NOTES_2026-06-18.md 修订 **T-9**（executor 异常类型显式转换预算）
> **风险等级**: 🔴 高 — 这是 TASK-309 diff 校验的前置门,不完成无法进入 Phase 3 主体

## 1. 元数据

| 字段 | 值 |
|---|---|
| 任务 ID | `TASK-311` |
| 所属阶段 | Phase 3 / workflow (前置审计) |
| 前置任务 | TASK-003, TASK-306 (agent_executor 重写完毕), TASK-307 (debate_executor 重写完毕) |
| 后置任务 | TASK-309 (PHASE3_STATE_MIGRATION.md 报告) |
| 输出文件 | `src/main/docs/audit/phase3_old_executor_raises.txt`, `docs/architecture/PHASE3_EXECUTOR_RAISES.md` |

## 2. 目标

Phase 3 实施时不显式处理 executor 异常类型,签名匹配会失败（修订 T-9 指出 `ExecutionRecorder.record_node_failed(self, ..., error: FinAgentError, trace_id)` 要求 `FinAgentError`,但 executor 当前抛的是 `RuntimeError` / `ValueError`）。本卡片在 TASK-309 之前完成所有 executor 的 raise 路径审计,产出对照表与 grep 原文。

## 3. 上下文范围

### 3.1 输入文件

1. `docs/architecture/TARGET_ARCHITECTURE_v2_2026-06-18.md` §3.2 异常层级表, §3.3 错误码
2. `docs/architecture/REVISION_NOTES_2026-06-18.md` 修订 T-9
3. `src/main/modules/execution/protocol.py` (TASK-201) — `record_node_failed(error: FinAgentError, ...)`
4. 重写后的 executor 文件 (TASK-305/306/307):
   - `src/main/modules/workflow/executor/input_executor.py`
   - `src/main/modules/workflow/executor/output_executor.py`
   - `src/main/modules/workflow/executor/agent_executor.py`
   - `src/main/modules/workflow/executor/debate_executor.py`

### 3.2 类型依赖

- `infra.errors.*` 异常族(TASK-003): `BizError`, `SystemError`, `InfraError`, `AgentNotFoundError`, `NodeNotFoundError`, `WorkflowNotFoundError`, `ValidationError`, `ConfigError`
- `infra.error_codes.ErrorCode` 枚举

### 3.3 输出文件

1. **`src/main/docs/audit/phase3_old_executor_raises.txt`** — 第 1 步 grep 输出原文(纯文本,可粘贴);位于 `src/main/docs/audit/` 下以遵守 `src/` 布局约定
2. **`docs/architecture/PHASE3_EXECUTOR_RAISES.md`** — 转换映射表 + 第 1 步 grep 输出 + 新代码验证 + 第 2 步 grep 输出

## 4. 详细步骤

### 4.1 第 1 步：列出 executor 中的 raise 点（修订 T-9 第 0 步）

执行命令（在仓库根目录运行）:

```bash
# 列出所有 executor 中的 raise 点
grep -nE "raise (RuntimeError|ValueError|Exception|NotImplementedError|AssertionError)" \
    src/main/modules/workflow/executor/*.py \
    > src/main/docs/audit/phase3_old_executor_raises.txt
```

预期输出（保留在 `src/main/docs/audit/phase3_old_executor_raises.txt`）:
```
src/main/modules/workflow/executor/agent_executor.py:87:    raise RuntimeError(f"Agent '{agent_name}' definition not found: ...")
src/main/modules/workflow/executor/agent_executor.py:142:    raise ValueError(f"Node {node_id} has no agent name defined")
src/main/modules/workflow/executor/input_executor.py:34:    raise ValidationError(...)  # 例外:已是 FinAgentError
...
```

### 4.2 第 2 步：写出转换映射表（写入 PHASE3_EXECUTOR_RAISES.md）

| 旧 raise | 新 raise | ErrorCode | HTTP |
|---|---|---|---|
| `RuntimeError("Agent '...' definition not found: ...")` | `AgentNotFoundError(...)` | `AGENT_NOT_DEFINED` (1004) | 422 |
| `RuntimeError(f"Node {node_id} has no agent name defined")` | `AgentNotFoundError(...)` | `AGENT_NOT_DEFINED` (1004) | 422 |
| `RuntimeError("AgentNodeExecutor requires a dispatcher")` | `ConfigError(...)` | `CONFIG_INCONSISTENT` (2002) | 500 |
| `ValueError("Failed to compute topological order - possible cycle")` | `ValidationError(...)` | `VALIDATION_FAILED` (1100) | 422 |
| `ValueError(f"Workflow {workflow_id} not found")` | `WorkflowNotFoundError(...)` | `WORKFLOW_NOT_FOUND` (1001) | 404 |
| `ValueError(f"Node {node_id} not found")` | `NodeNotFoundError(...)` | `NODE_NOT_FOUND` (1003) | 404 |
| `NotImplementedError(...)` | `ConfigError(...)`(若为开发期缺失) | `CONFIG_INCONSISTENT` (2002) | 500 |
| `AssertionError(...)` | **不保留**:`assert` 不属于业务异常,改为 `ConfigError` 或移除(开发者用 type hint) | — | — |

### 4.3 第 3 步：修改 executor 代码

每个 executor 卡片（TASK-305/306/307）在实现时**必须**按上表替换 raise 类型。**禁止**保留 `RuntimeError` / `ValueError` 在业务路径上(框架自身如 typeguard 仍可)。

### 4.4 第 4 步：第 2 次 grep 验证

```bash
# 验证新代码已无 RuntimeError/ValueError
grep -nE "raise (RuntimeError|ValueError)" \
    src/main/modules/workflow/executor/*.py \
    > src/main/docs/audit/phase3_new_executor_raises.txt

# 应为 0 行(或仅有框架层 typeguard 调用)
```

### 4.5 PHASE3_EXECUTOR_RAISES.md 模板

```markdown
# PHASE3 Executor Raises 审计报告

> 修订 T-9 产出 · 日期: YYYY-MM-DD

## 1. 第 1 步 grep 原文（贴 phase3_old_executor_raises.txt 全文）

\`\`\`
$ grep -nE "raise (RuntimeError|ValueError|Exception|NotImplementedError|AssertionError)" \
    src/main/modules/workflow/executor/*.py
src/main/modules/workflow/executor/agent_executor.py:87:    raise RuntimeError(f"Agent '{agent_name}' definition not found")
src/main/modules/workflow/executor/agent_executor.py:142:    raise ValueError(f"Node {node_id} has no agent name defined")
...
\`\`\`

## 2. 转换映射表（与 §4.2 表格一致）

## 3. 替换后的代码 diff 摘要

（如 TASK-305/306/307 PR 的 diff stat）

## 4. 第 2 次 grep 验证

\`\`\`
$ grep -nE "raise (RuntimeError|ValueError)" \
    src/main/modules/workflow/executor/*.py
(no output — confirmed all raises use FinAgentError subtypes)
\`\`\`

## 5. 验收

- [ ] phase3_old_executor_raises.txt 入库
- [ ] 转换映射表覆盖全部命中行
- [ ] 新代码 grep 验证 0 结果
- [ ] 所有 executor 卡片(TASK-305/306/307)在交付说明引用本报告

## 6. 未覆盖项

（若有:为什么 / 留给哪个后续卡片）
```

## 5. Do Not 清单

- [ ] **Do Not #16**: 任何 agent 层异常必须 catch 后包成 `AgentTimeoutError`/`AgentHttp5xxError`/`McpServerError` 之一 — 本卡片审计所有 raise 点,确保替换为 `BizError` / `SystemError` / `InfraError` 子类
- [ ] **Do Not #4**: 异常必须结构化(继承 FinAgentError + ErrorCode) — 转换后必须用 `isinstance(err, AgentNotFoundError)` 形式
- [ ] **修订 T-9 强约束**: **禁止**在未完成本卡片的情况下进入 TASK-309 的 diff 校验

## 6. 验收标准

- [ ] `src/main/docs/audit/phase3_old_executor_raises.txt` 存在,含 ≥ 1 行(原代码 raise 点)
- [ ] `docs/architecture/PHASE3_EXECUTOR_RAISES.md` 存在,含 4 个章节(grep 原文 / 映射表 / diff 摘要 / 第 2 次 grep)
- [ ] **关键 grep 验证 #1**: `grep -cE '^\| (旧|新|ErrorCode|HTTP).*\|$' docs/architecture/PHASE3_EXECUTOR_RAISES.md` 与表格行数比对(排除 `|---|` 表格分隔行)
- [ ] **关键 grep 验证 #2**: TASK-305/306/307 的交付说明必须显式引用 `PHASE3_EXECUTOR_RAISES.md`
- [ ] **关键 grep 验证 #3**: 第 2 次 grep 输出 0 行(或仅有 typeguard 等框架调用)
- [ ] TASK-309 的 `PHASE3_STATE_MIGRATION.md` 报告**引用本卡片**为前置

## 7. 非目标

- 不修改 executor 代码本身(由 TASK-305/306/307 实现)
- 不写新的异常类(沿用 TASK-003 已定义的异常族)

## 8. 交付说明模板

> ⚠️ **实际执行命令后粘贴真实输出,禁止复制本节中的预期输出作伪。**

```
## TASK-311 交付说明

### grep 原文
$ wc -l src/main/docs/audit/phase3_old_executor_raises.txt
12 src/main/docs/audit/phase3_old_executor_raises.txt

### 转换映射覆盖
$ grep -E "raise (RuntimeError|ValueError|Exception|NotImplementedError|AssertionError)" src/main/docs/audit/phase3_old_executor_raises.txt | wc -l
12
$ grep -c "^| " docs/architecture/PHASE3_EXECUTOR_RAISES.md
12  # 表格覆盖 12 行

### 第 2 次 grep
$ grep -nE "raise (RuntimeError|ValueError)" src/main/modules/workflow/executor/*.py | wc -l
0

### 关联卡片引用
- TASK-305: 引用 PHASE3_EXECUTOR_RAISES.md §2 映射表(input_executor 部分)
- TASK-306: 引用 PHASE3_EXECUTOR_RAISES.md §2 映射表(agent_executor 部分)
- TASK-307: 引用 PHASE3_EXECUTOR_RAISES.md §2 映射表(debate_executor 部分)

### 偏离 / 备注
无偏离,严格按修订 T-9 执行
```
