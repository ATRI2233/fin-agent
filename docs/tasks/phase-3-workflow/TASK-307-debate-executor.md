# TASK-307: debate_executor.py - 多 agent 并行辩论

> **阶段**: Phase 3 · **估时**: 5h · **优先级**: P1
> **上下文窗口**: 4 输入 · 1 输出

## 1. 元数据

| 字段 | 值 |
|---|---|
| 任务 ID | `TASK-307` |
| 所属阶段 | Phase 3 / workflow executor |
| 前置任务 | TASK-002, TASK-003, TASK-005, TASK-006, TASK-105, TASK-301, TASK-304, TASK-306 |
| 后置任务 | TASK-309, TASK-310 |
| 输出文件 | `src/main/modules/workflow/executor/debate_executor.py` |

## 2. 目标

实现 `DebateNodeExecutor`: 并行 dispatch 多个 agent,合并结果,返回带 `extra_data["debate_session_ids"]`。

## 3. 上下文范围

### 3.1 输入文件

1. `docs/architecture/TARGET_ARCHITECTURE_v2_2026-06-18.md` §3.6.3 (NodeResult.extra_data), §7.6 (并行 trace_id)
2. `src/main/modules/workflow/executor/agent_executor.py` (TASK-306) - 参考实现
3. `src/main/modules/workflow/executor/base.py` (TASK-304)
4. `src/main/modules/workflow/protocol.py` (TASK-301)

### 3.2 类型依赖

- `BaseNodeExecutor` (TASK-304)
- `NodeContext, NodeResult` (TASK-301)
- `AgentDispatcher` (TASK-105) - 用 `dispatch_parallel`
- `AgentReference` (TASK-002)
- `infra.errors.*` (TASK-003)
- `infra.tracing.bind_contextvars` (TASK-005+TASK-006) - **v2.1 §7.6 必须显式**
- 配对使用 `infra.tracing.unbind_contextvars` (TASK-005)

### 3.3 输出文件

1. `src/main/modules/workflow/executor/debate_executor.py` - 含 `class DebateNodeExecutor(BaseNodeExecutor)`

## 4. 详细步骤

### 4.1 构造函数(同 agent_executor,无状态字段)

```python
class DebateNodeExecutor(BaseNodeExecutor):
    def __init__(self, *, dispatcher, execution_recorder, trace_id):
        super().__init__(dispatcher=dispatcher, execution_recorder=execution_recorder, trace_id=trace_id)
```

### 4.2 execute 方法(关键:asyncio.gather + 显式 trace_id)

```python
async def execute(self, ctx: NodeContext) -> NodeResult:
    node_id = ctx["node"].id
    trace_id = ctx["trace_id"]
    
    # 解析辩论参与者(从 ctx["node"].data["participants"])
    participants = [AgentReference.from_node(...) for ...]  # 或更直接读列表
    if not participants: raise ValidationError("debate node has no participants")
    
    # v2.1 §7.6 强制:显式 bind/unbind + 显式 trace_id 传入
    bind_contextvars(trace_id=str(trace_id), node_id=str(node_id), event="debate.started")
    try:
        # dispatch_parallel 接收 trace_id 参数
        results, session_ids = await self.dispatcher.dispatch_parallel(
            agents=participants,
            prompt=build_prompt(...),
            timeout=None,           # None → settings 默认
            trace_id=trace_id,      # ⚠️ 显式传入
        )
    finally:
        unbind_contextvars("trace_id", "node_id", "event")
    
    # 合并:vote / summary / first-wins(由 ctx["node"].data["strategy"] 决定)
    strategy = ctx["node"].data.get("strategy", "summary")
    merged = self._merge(results, strategy)
    
    await self.recorder.record_node_completed(
        execution_id=ctx["execution_id"], node_id=node_id,
        output={"result": merged}, session_id=session_ids[0] if session_ids else None,
        trace_id=trace_id,
    )
    
    return {
        "output": merged,
        "session_id": session_ids[0] if session_ids else None,
        "extra_data": {"debate_session_ids": [str(s) for s in session_ids]},
    }
```

### 4.3 _merge 方法

- `strategy == "summary"`: 用 LLM summary(暂留 TODO 或简化:返回 list[result])
- `strategy == "vote"`: 简单多数
- `strategy == "first"`: 取第一个

## 5. Do Not 清单

- [ ] **Do Not #19**: 执行器必须无状态;所有跨调用持久化状态由 WorkflowRunner 独占,通过 `NodeContext` 只读快照传入。并行执行时任何共享实例字段 = 数据串读
- [ ] **Do Not #18**（v2.1 §7.6）: ContextVar 在跨 Task 调度时只继承调度时刻快照,子 Task 的 set 不会回写;一旦污染,日志 trace_id 错乱且不可复现
- [ ] **Do Not #8**: 全部走 `settings.py` 或 `constants.py`
- [ ] **Do Not #3**: 任何吞掉的异常都会变成“线上诡异现象”;必须向上抛或转 FinAgentError
- [ ] **Do Not #4**: 异常必须结构化(继承 FinAgentError + ErrorCode)

## 6. 验收标准

- [ ] `python -c "from src.main.modules.workflow.executor.debate_executor import DebateNodeExecutor"` 退出码 0
- [ ] **关键 grep #1**: `grep -nE 'self\._(results|chain_sessions|db)' src/main/modules/workflow/executor/debate_executor.py` → 0
- [ ] **关键 grep #2**: `grep -c 'bind_contextvars' src/main/modules/workflow/executor/debate_executor.py` 命中 ≥ 1
- [ ] **关键 grep #2b**: `grep -c 'unbind_contextvars' src/main/modules/workflow/executor/debate_executor.py` 命中 ≥ 1
- [ ] **关键 grep #3**: `grep -nE 'trace_id=trace_id' src/main/modules/workflow/executor/debate_executor.py` → 命中(dispatch_parallel 调用)
- [ ] 单元测试: mock dispatcher,验证 dispatch_parallel 收到正确 participants 列表

## 7. 非目标

- 不实现 LLM-based summary(TODO 留给后续)
- 不实现 vote/tally 算法(简化版即可)

## 8. 交付说明模板

> ⚠️ **实际执行命令后粘贴真实输出,禁止复制本节中的预期输出作伪。**

```
## TASK-307 交付说明

$ grep -nE 'bind_contextvars' src/main/modules/workflow/executor/debate_executor.py
$ grep -nE 'unbind_contextvars' src/main/modules/workflow/executor/debate_executor.py
28: bind_contextvars(trace_id=str(trace_id), node_id=str(node_id), event="debate.started")
36: unbind_contextvars("trace_id", "node_id", "event")
```
