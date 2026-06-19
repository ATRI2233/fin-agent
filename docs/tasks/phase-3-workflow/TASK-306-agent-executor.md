# TASK-306: agent_executor.py - **执行器无状态关键卡**

> **阶段**: Phase 3 · **估时**: 8h · **优先级**: P1（核心）
> **上下文窗口**: 4 输入 · 1 输出
> **风险等级**: 🔴 最高 — 本卡片的实现质量直接决定 v2.1 §11.2 是否能闭环

## 1. 元数据

| 字段 | 值 |
|---|---|
| 任务 ID | `TASK-306` |
| 所属阶段 | Phase 3 / workflow executor |
| 前置任务 | TASK-002, TASK-003, TASK-005, TASK-006, TASK-105, TASK-301, TASK-304, TASK-305 |
| 后置任务 | TASK-309, TASK-310, **TASK-310 也产出 PHASE3_STATE_MIGRATION.md 引用本卡** |
| 输出文件 | `src/main/modules/workflow/executor/agent_executor.py` |

## 2. 目标

实现 `AgentNodeExecutor`,**严格遵守 v2.1 §11.2 无状态规则**,把旧 `_chain_sessions/_results/_failed_nodes/_db` 全部外移。

## 3. 上下文范围

### 3.1 输入文件

1. `docs/architecture/TARGET_ARCHITECTURE_v2_2026-06-18.md` §4.1, §11.2, §3.6.3
2. `src/main/framework/core/workflow/node_executors/agent_executor.py`(旧实现,作为**参考**,禁止直接拷贝)
3. `src/main/modules/workflow/executor/base.py` (TASK-304)
4. `src/main/modules/workflow/protocol.py` (TASK-301) - 含 NodeContext 的 `chain_sessions` 字段

### 3.2 类型依赖

- `BaseNodeExecutor` (TASK-304)
- `NodeContext, NodeResult` (TASK-301) — **关键**: 必须读 `ctx["chain_sessions"]` 而不是 self._chain_sessions
- `AgentDispatcher` (TASK-105) — 唯一对外调用
- `infra.domain.AgentReference` (TASK-002)
- `infra.errors.*` (TASK-003)
- `infra.logging.get_logger` (TASK-006)
- `infra.tracing.current_trace_id` (TASK-005)

### 3.3 输出文件

1. `src/main/modules/workflow/executor/agent_executor.py` - 含 `class AgentNodeExecutor(BaseNodeExecutor)`

## 4. 详细步骤

### 4.1 构造函数

```python
class AgentNodeExecutor(BaseNodeExecutor):
    def __init__(
        self,
        *,
        dispatcher: AgentDispatcher,
        execution_recorder: ExecutionRecorder,    # 仅供 record_*(trace_id) 用
        trace_id: TraceId,
    ) -> None:
        super().__init__(dispatcher=dispatcher, execution_recorder=execution_recorder, trace_id=trace_id)
        # ⚠️ 禁止: self._chain_sessions = {}
        # ⚠️ 禁止: self._results = {}
        # ⚠️ 禁止: self._db = ...
```

### 4.2 execute 方法

```python
async def execute(self, ctx: NodeContext) -> NodeResult:
    node_id = ctx["node"].id
    edges = ctx["edges"]
    params = ctx["params"]
    trace_id = ctx["trace_id"]
    
    agent = AgentReference.from_node({"agent": ctx["node"].agent.name, ...})  # 或更直接: ctx["node"].agent
    if not agent: raise BizError(ErrorCode.AGENT_NOT_SPECIFIED, ...)
    
    # 验证 agent 定义文件存在(从 dispatcher.get_definition 或 settings)
    # ... 简化: 直接跳过(由 agent 层负责)
    
    # 串行链判断 — 用 ctx["chain_sessions"] 而非 self._chain_sessions
    session_id: SessionId | None = None
    chain = ctx["chain_sessions"]   # 只读快照
    if len(ctx["predecessor_ids"]) == 1:
        pred_id = ctx["predecessor_ids"][0]
        if pred_id in chain and is_only_successor(node_id, pred_id, edges):
            session_id = chain[pred_id]
    
    # Dispatch(无内层重试,失败直接 raise FinAgentError)
    resp = await self.dispatcher.dispatch(
        agent=agent,
        prompt=build_prompt(...),
        session_id=session_id,
        trace_id=trace_id,    # 显式传入,不依赖 ContextVar
    )
    
    # ⚠️ 禁止 self._chain_sessions[node_id] = resp["session_id"]
    # 写权归 WorkflowRunner:通过返回的 NodeResult.session_id 由 runner 写入自己的 _chain_sessions
    
    # 持久化 — 用 recorder(UoW 边界)
    await self.recorder.record_node_completed(
        execution_id=ctx["execution_id"],
        node_id=node_id,
        output={"result": resp["result"]},
        session_id=resp["session_id"],
        trace_id=trace_id,
    )
    
    return {
        "output": resp["result"],
        "session_id": resp["session_id"],
        "extra_data": {},
    }
```

### 4.3 失败处理

```python
except FinAgentError as e:
    await self.recorder.record_node_failed(
        execution_id=ctx["execution_id"],
        node_id=node_id,
        error=e,
        trace_id=trace_id,
    )
    raise   # 重新抛出,不做 swallow
except Exception as e:
    # 包装成 InfraError(禁止 except Exception: pass)
    wrapped = InfraError(...) from e
    await self.recorder.record_node_failed(...)
    raise wrapped from e
```

## 5. Do Not 清单（**本卡片最严格**）

- [ ] **Do Not #19**（v2.1 新增）: 执行器必须无状态;所有跨调用持久化状态由 WorkflowRunner 独占,通过 `NodeContext` 只读快照传入。并行执行时任何共享实例字段 = 数据串读
- [ ] **Do Not #5**: 事务边界 = UoW;执行器是纯函数
- [ ] **Do Not #8**（P8 重试只一层）: 全部走 `settings.py` 或 `constants.py`
- [ ] **Do Not #18**（v2.1 新增）: ContextVar 在跨 Task 调度时只继承调度时刻快照,子 Task 的 set 不会回写;一旦污染,日志 trace_id 错乱且不可复现
- [ ] **Do Not #3**: 任何吞掉的异常都会变成“线上诡异现象”;必须向上抛或转 FinAgentError — 必须 raise
- [ ] **Do Not #4**: 异常必须结构化(继承 FinAgentError + ErrorCode)
- [ ] **Do Not #11**: Executor 必须无状态,每次新建

## 6. 验收标准（**必须全部满足,TASK-310 报告引用本卡**）

- [ ] `python -c "from src.main.modules.workflow.executor.agent_executor import AgentNodeExecutor"` 退出码 0
- [ ] **关键 grep #1**: `grep -nE 'self\._(results|chain_sessions|failed_nodes|skipped_nodes|db)' src/main/modules/workflow/executor/agent_executor.py` → **0 行**
- [ ] **关键 grep #2**: `grep -nE 'for attempt in range|@retry_on_failure' src/main/modules/workflow/executor/agent_executor.py` → **0 行**
- [ ] **关键 grep #3**: `grep -nE 'except Exception: pass' src/main/modules/workflow/executor/agent_executor.py` → **0 行**
- [ ] **关键 grep #4**: `grep -nE 'ctx\["chain_sessions"\]' src/main/modules/workflow/executor/agent_executor.py` → 命中 ≥ 1 行
- [ ] **关键 grep #5**: `grep -nE 'trace_id=trace_id' src/main/modules/workflow/executor/agent_executor.py` → 命中 ≥ 1 行(dispatcher 调用)
- [ ] `AgentNodeExecutor(dispatcher=mock_d, recorder=mock_r, trace_id=TraceId("tr-test"))` 实例化成功
- [ ] 单元测试: 串行链判定正确(predecessor 有 chain_session 且 is_only_successor → 复用 session_id)

## 7. 非目标

- 不实现 retry(TASK-310 workflow 层)
- 不实现 prompt_builder(后续单独卡片 TASK-308)
- 不写 PHASE3_STATE_MIGRATION.md(由 TASK-310 产出,本卡片产出 diff 命令输出原文供报告引用)

## 8. 交付说明模板

> ⚠️ **实际执行命令后粘贴真实输出,禁止复制本节中的预期输出作伪。**

```
## TASK-306 交付说明

### Do Not 核对
- [x] Do Not #19: grep 已验证 self._chain_sessions 等 0 行
- [x] Do Not #5: 仅 self.recorder 一个 DB 入口
- [x] Do Not #8: 无内层重试
- [x] Do Not #18: trace_id 显式传入 dispatcher

### grep 命令输出
$ grep -nE 'self\._(results|chain_sessions|failed_nodes|skipped_nodes|db)' src/main/modules/workflow/executor/agent_executor.py
(no output)

$ grep -nE 'for attempt in range|@retry_on_failure' src/main/modules/workflow/executor/agent_executor.py
(no output)

$ grep -nE 'ctx\["chain_sessions"\]' src/main/modules/workflow/executor/agent_executor.py
42:    chain = ctx["chain_sessions"]

$ grep -nE 'trace_id=trace_id' src/main/modules/workflow/executor/agent_executor.py
55:        trace_id=trace_id,
```
