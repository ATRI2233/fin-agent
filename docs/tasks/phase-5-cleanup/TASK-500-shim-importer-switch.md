# TASK-500: Shim importer 扫描 + 切换（修订 T-6 强约束前置）

> **阶段**: Phase 5 / 0.5（在 TASK-501 之前）· **估时**: 6h · **优先级**: P0（Gate 5.5）
> **上下文窗口**: 1 输入（REVISION_NOTES 修订 T-6）+ 3 个 txt 输出 + 30+ importer 改写
> **关联修订**: REVISION_NOTES_2026-06-18.md 修订 **T-6**（删除 shim 前强制 import 影响面扫描）+ 修订 **A-1**（CLAUDE.md 漏标 shim 准备阶段）

## 1. 元数据

| 字段 | 值 |
|---|---|
| 任务 ID | `TASK-500` |
| 所属阶段 | Phase 5 / pre-cleanup（Gate 5.5） |
| 前置任务 | TASK-301, TASK-405, TASK-409, TASK-410 |
| 后置任务 | TASK-501（必须在本卡完成后才能开始） |
| 输出文件 | `phase0_shim_importers.txt`, `phase0_init_consumers.txt`, `phase0_reexport_consumers.txt`（PR 附件）；30+ importer 改写 |
| 删除文件/目录 | 无（仅改写，不删除） |

## 2. 目标

执行 REVISION_NOTES 修订 T-6 强约束的 3 份 importer 扫描,把所有走 `main.framework.services.*` shim 路径的 importer **全部**切换到 `modules/*/protocol.py` 的 Protocol + `Depends(service_dep(...))` 形式。**切换完毕、CI grep 验证为 0 行**之后,才允许进入 TASK-501 的物理删除阶段。

**背景**: TASK-501 同时承担 (a) importer 扫描 + 切换 (b) 删 framework/ + 更新 CLAUDE.md 两件事估时都偏紧(3h 完全不够),INDEX §8 风险表已声明"3 份 importer 清单未清零,禁止 rm -rf",但生成这 3 份 importer 清单本身没人负责。本卡把 (a) 拆出来单独执行,作为 TASK-501 的硬前置 Gate 5.5。

## 3. 上下文范围

### 3.1 输入文件

1. `docs/architecture/REVISION_NOTES_2026-06-18.md` 修订 T-6（importer 影响面扫描强约束）
2. `src/main/framework/services/`（shim 路径源头,本卡不修改）
3. `src/main/modules/*/protocol.py`（切换目标：Protocol 定义）
4. `src/main/modules/*/service.py`（切换目标：实现位置）

### 3.2 类型依赖

- `modules.*.protocol.Protocol`（每个模块的协议接口,如 `workflow.protocol.WorkflowReader`,TASK-301）
- `src.main.api.deps.service_dep`（DI 工厂函数,TASK-405 — **不是** `main.core.infrastructure.container.service_dep`）

### 3.3 输出

1. **新增 3 份 txt 报告**(PR 附件):
   - `phase0_shim_importers.txt` — 列出所有通过 shim 路径直接导入服务的文件
   - `phase0_init_consumers.txt` — 列出所有间接通过 `__init__.py` 消费 shim 的文件
   - `phase0_reexport_consumers.txt` — 列出所有用 string-based lookup 访问服务的代码
2. **改写 30+ importer 文件**(具体数量以 grep 验证为准):
   - 服务类 importer（`WorkflowService`, `ExecutionService` 等）→ 直接 `from modules.<m>.service.<n> import <Class>`
   - 查询类 importer（`WorkflowQueryService`, `ExecutionQueryService` 等）→ 直接 `from modules.<m>.service.<n>_query_service import <Class>`
   - `phase0_reexport_consumers.txt` 命中 → 改 `Depends(service_dep(...))` 形式,经由 `modules/*/protocol.py` 的 Protocol 类型注解

## 4. 详细步骤

### 4.1 第 1 步：执行 3 份 importer 扫描（修订 T-6 强制）

```bash
# (1) 列出所有通过 shim 路径导入服务的文件
grep -rn "from main.framework.services" src/main/ \
    | grep -v "from main.framework.services.core\|from main.framework.services.queries\|from main.framework.services.patterns" \
    > phase0_shim_importers.txt

# (2) 列出所有间接通过 __init__.py 消费 shim 的文件
grep -rn "from main.framework.services import" src/main/ \
    > phase0_init_consumers.txt

# (3) 列出所有用 string-based lookup 访问服务的代码
grep -rn "from main.framework.services import" src/main/ \
    | grep "__init__" \
    > phase0_reexport_consumers.txt
```

**预期**: 3 份 txt 文件**必须都有命中**(≥ 1 行)。如果某份为 0 行,说明该模式已清零,记录原因并跳过对应切换步骤,但**仍需入库作为 PR 附件**。

### 4.2 第 2 步：切换所有 importer（修订 T-6 强制）

按命中模式分类切换:

**(a) 服务类 importer**(`phase0_shim_importers.txt` 命中,非 query 类):
```python
# BEFORE
from main.framework.services.workflow_service import WorkflowService
from main.framework.services.execution_service import ExecutionService

# AFTER
from src.main.modules.workflow.service.workflow_runner import WorkflowRunner
from src.main.modules.execution.service.execution_service import DefaultExecutionService
```

**(b) 查询类 importer**(`phase0_shim_importers.txt` 命中,query 后缀):
```python
# BEFORE
from main.framework.services.workflow_query_service import WorkflowQueryService
from main.framework.services.execution_query_service import ExecutionQueryService

# AFTER
from src.main.modules.workflow.service.workflow_query_service import WorkflowQueryService
from src.main.modules.execution.service.execution_query_service import ExecutionQueryService
```

**(c) Re-export / string-based consumers**(`phase0_reexport_consumers.txt` 命中):
```python
# BEFORE
from main.framework.services import WorkflowService  # 通过 __init__.py 间接引用
svc = container.get("workflow_service")  # string-based lookup

# AFTER
from src.main.modules.workflow.protocol import WorkflowReader  # 实际类是 WorkflowReader (TASK-301)
from src.main.api.deps import service_dep  # TASK-405 路径

svc: WorkflowReader = Depends(service_dep(WorkflowReader))
```

**切换规则**:
1. 每个命中文件**必须**改完,不允许"暂时跳过"
2. 切换后保留原 import 的 alias 命名(如 `WorkflowService as WS`),最大限度降低 diff 噪声
3. 切换完毕后,在文件顶部加 `# TASK-500: shim importer switched on YYYY-MM-DD` 注释(可选)

### 4.3 第 3 步：CI grep 验证(切换阶段硬约束)

```bash
# 关键验证 1: 旧 shim 路径完全无人引用
$ grep -rn "from main.framework.services" src/main/
→ 必须 0 行

# 关键验证 2: 旧 framework 根路径在源码内不再引用
$ grep -rn "from main.framework\|from src.main.framework" src/main/
→ 必须 0 行

# 关键验证 3: 新路径已接管(用真实符号,禁止编造路径)
$ grep -rn "from src.main.api.deps import service_dep" src/main/        # ≥ 1 行
$ grep -rn "WorkflowReader" src/main/modules/workflow/protocol.py        # ≥ 1 行
$ grep -rn "DefaultExecutionService" src/main/modules/execution/service/ # ≥ 1 行
$ grep -rn "create_app" src/main/api/app.py                               # ≥ 2 行

# 关键验证 4: 切换数量(参考)
$ git diff --name-only HEAD~1..HEAD | grep -E "\.py$" | wc -l
→ 30+ importer 文件已切换(具体数字以 grep 结果为准)
```

### 4.4 第 4 步：把 3 份 txt 文件入库作为 PR 附件

把 `phase0_shim_importers.txt`, `phase0_init_consumers.txt`, `phase0_reexport_consumers.txt` 三个文件**入库**(commit 到仓库),作为本卡 PR 的附件。CI 阶段会强制 grep 这 3 份文件存在 + 行数 ≥ 0(允许为 0 行,只要文件存在)。

**注意**: 这 3 份 txt 在 TASK-501 完成后会被 git rm,本卡只需确保它们存在 + 已 commit。

### 4.5 第 5 步：本地验证

```bash
# pytest 跑通(切换后旧 shim 路径完全无人引用)
$ pytest tests/ -v
→ 全绿

# 启动验证(可选,CI 必跑)
$ python -c "from src.main.api.app import create_app; create_app()"
→ 启动成功
```

## 5. Do Not 清单

- [ ] **Do Not #6**(P6): 重构期一次性切换;不允许共存 — 本卡**不删除 shim**(留给 TASK-501),但**禁止保留半切换状态**(不允许部分 importer 切到新路径、部分还在用 shim)
- [ ] **修订 T-6 强约束**: **禁止**在 `phase0_shim_importers.txt` / `phase0_init_consumers.txt` / `phase0_reexport_consumers.txt` 任一不为 0 行(即未扫描完毕)时进入 TASK-501
- [ ] **修订 T-6 强约束**: **禁止**仅口头说"已经迁移" 而不附 3 份 txt(必须入库)
- [ ] **Do Not #3**: 任何吞掉的异常都会变成“线上诡异现象”;必须向上抛或转 FinAgentError
- [ ] **Do Not #20**: 禁止在切换时引入新依赖 / 新模块(本卡只改 import 路径,不改业务逻辑)
- [ ] **Do Not**: 禁止在本卡删除任何 shim 文件(`framework/services/*` 留给 TASK-501)

## 6. 验收标准

### 6.1 扫描阶段(必须命中)

- [ ] `phase0_shim_importers.txt` 存在且 `wc -l` ≥ 1(若为 0 行,记录原因并解释,但文件必须存在)
- [ ] `phase0_init_consumers.txt` 存在且 `wc -l` ≥ 1(同上)
- [ ] `phase0_reexport_consumers.txt` 存在且 `wc -l` ≥ 1(同上)

### 6.2 切换阶段(必须清零)

- [ ] `grep -rn "from main.framework.services" src/main/` → 0 行
- [ ] `grep -rn "from main.framework\|from src.main.framework" src/main/` → 0 行
- [ ] `grep -rn "from src.main.api.deps import service_dep" src/main/` → ≥ 1 行(TASK-405 实际路径已被切换)
- [ ] `grep -rn "WorkflowReader" src/main/modules/workflow/protocol.py` → 命中(TASK-301 实际类)
- [ ] `grep -rn "DefaultExecutionService" src/main/modules/execution/service/execution_service.py` → 命中(TASK-204 实际类)
- [ ] `grep -rn "create_app" src/main/api/app.py` ≥ 2 行(TASK-409 实际位置)
- [ ] 30+ importer 文件已切换(具体数量由 `grep` 验证)
- [ ] pytest 跑通(切换后旧 shim 路径完全无人引用)

### 6.3 入库阶段

- [ ] 3 份 txt 文件已 commit 到仓库
- [ ] CI 阶段已加 grep 验证脚本(防止后续 PR 引入新 shim 引用)

### 6.4 TASK-501 解锁条件

- [ ] 上述 6.1 / 6.2 / 6.3 全部通过
- [ ] 本卡 PR 已 merge 到 main
- [ ] 在 INDEX §8 风险表中 Gate 5.5 状态从"未通过" → "通过"

## 7. 非目标

- **不删除任何 shim 文件**(留给 TASK-501)
- **不更新 CLAUDE.md**(留给 TASK-501)
- **不重写业务逻辑**(本卡只改 import 路径)
- **不删除 `framework/` 目录**(留给 TASK-501)
- **不删除占位目录**(`dacide/`, `data_learning/`, `timely_tade/`)(留给 TASK-501)

## 8. 交付说明模板

> ⚠️ **实际执行命令后粘贴真实输出,禁止复制本节中的预期输出作伪。**

```
## TASK-500 交付说明

### 3 份 importer 扫描(扫描阶段必须命中)
$ wc -l phase0_shim_importers.txt phase0_init_consumers.txt phase0_reexport_consumers.txt
NN phase0_shim_importers.txt       (NN ≥ 1)
MM phase0_init_consumers.txt       (MM ≥ 1)
KK phase0_reexport_consumers.txt   (KK ≥ 1)

### 切换后 grep 验证(切换阶段必须清零)
$ grep -rn "from main.framework.services" src/main/
(no output)

$ grep -rn "from main.framework\|from src.main.framework" src/main/
(no output)

### 切换数量
$ git diff --name-only HEAD~1..HEAD | grep -E "\.py$" | wc -l
XX  (XX ≥ 30)

### 测试
$ pytest tests/ -q
============================== N passed ==============================

### 偏离 / 备注
无偏离 / (列出偏离原因)
```
