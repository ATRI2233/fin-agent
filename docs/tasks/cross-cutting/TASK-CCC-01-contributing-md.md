# TASK-CCC-01: docs/CONTRIBUTING.md - Do Not 清单 + 贡献指南

> **阶段**: 跨切 · **估时**: 2h · **优先级**: P1
> **上下文窗口**: 0 输入 · 1 输出
> **可与其他 Phase 并行**

## 1. 元数据

| 字段 | 值 |
|---|---|
| 任务 ID | `TASK-CCC-01` |
| 所属阶段 | 跨切 |
| 前置任务 | 无 |
| 后置任务 | 无（CI 引用） |
| 输出文件 | `docs/CONTRIBUTING.md` |

## 2. 目标

把设计文档 §9 Do Not 清单 + Do 清单独立成文件,便于开发者与 CI 引用。

## 3. 上下文范围

### 3.1 输入文件

1. `docs/architecture/TARGET_ARCHITECTURE_v2_2026-06-18.md` §9

### 3.2 输出文件

1. `docs/CONTRIBUTING.md` - 含:
   - 简介
   - **Do Not 清单**(19 条)
   - **Do 清单**(对应正向做法)
   - 代码审查检查表(PR reviewer 用)
   - CI grep 检查命令模板

## 4. 详细步骤

1. 写 markdown 标题与简介
2. 逐条抄设计文档 §9 的 19 条 Do Not
3. 每条 Do Not 配一条 Do(正向做法)
4. 加 "Code Review Checklist"(PR 时 reviewer 必查)
5. 加 "CI grep 模板"(可被 .github/workflows/lint.yml 引用)

## 5. Do Not 清单

- [ ] **Do Not #1**: 跨模块 `from X import _xxx` 一律禁止;需要共享必须升 Protocol
- [ ] **Do Not #2**: 接口没对齐时用反射修补 = 隐藏 bug;改 Protocol
- [ ] **Do Not #3**: 任何吞掉的异常都会变成“线上诡异现象”;必须向上抛或转 FinAgentError
- [ ] **Do Not #4**: 异常必须结构化(继承 FinAgentError + ErrorCode)
- [ ] **Do Not #5**: 事务边界 = UoW;执行器是纯函数
- [ ] **Do Not #6**: 重构期一次性切换;不允许共存
- [ ] **Do Not #7**: 全部走 `settings.py`(pydantic-settings)
- [ ] **Do Not #8**: 全部走 `settings.py` 或 `constants.py`
- [ ] **Do Not #9**: 必须用 `NodeType` 枚举
- [ ] **Do Not #10**: 必须用 `ExecutionStatus` 枚举
- [ ] **Do Not #11**: Executor 必须无状态,每次新建
- [ ] **Do Not #12**: FastAPI `app.state` + DI Registry
- [ ] **Do Not #13**: 私有 = 私有;需要公开 → 升 Protocol(与 #1 同源,作为反例)
- [ ] **Do Not #14**: 必须 `app.dependency_overrides[service_dep(...)] = lambda: mock`
- [ ] **Do Not #15**: 必须 structlog JSON + contextvars
- [ ] **Do Not #16**: 任何 agent 层异常必须 catch 后包成 `AgentTimeoutError`/`AgentHttp5xxError`/`McpServerError` 之一
- [ ] **Do Not #17**: 迭代历史走 git / CHANGELOG
- [ ] **Do Not #18**（v2.1）: ContextVar 在跨 Task 调度时只继承调度时刻快照,子 Task 的 set 不会回写;一旦污染,日志 trace_id 错乱且不可复现
- [ ] **Do Not #19**（v2.1）: 执行器必须无状态;所有跨调用持久化状态由 WorkflowRunner 独占,通过 `NodeContext` 只读快照传入。并行执行时任何共享实例字段 = 数据串读

## 6. 验收标准

- [ ] `docs/CONTRIBUTING.md` 存在
- [ ] 含 19 条 Do Not
- [ ] 每条 Do Not 配一条正向 Do
- [ ] 含 CI grep 模板段

## 7. 非目标

- 不写 CI workflow 文件(运维单独做)
- 不重写 README

## 8. 交付说明模板

> ⚠️ **实际执行命令后粘贴真实输出,禁止复制本节中的预期输出作伪。**

```
## TASK-CCC-01 交付说明

$ grep -c "^### Do Not #" docs/CONTRIBUTING.md
19
```
