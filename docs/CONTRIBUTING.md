# Fin-Agent 贡献指南

> 版本: **v2.1 (target)** · 更新: 2026-06-19
> 来源: `docs/architecture/TARGET_ARCHITECTURE_v2_2026-06-18.md` §9 与 INDEX.md §6.1
> 范围: 后端 Python 服务 (`src/main/`)；前端与 MCP 服务不在此范围

---

## 目录

1. [简介](#1-简介)
2. [Do Not 清单（19 条）](#2-do-not-清单19-条)
3. [Do 清单（正向做法）](#3-do-清单正向做法)
4. [代码审查检查表](#4-代码审查检查表)
5. [CI grep 检查命令模板](#5-ci-grep-检查命令模板)

---

## 1. 简介

本文档是 Fin-Agent 项目的强制性贡献规范，来源于目标架构设计文档 `TARGET_ARCHITECTURE_v2_2026-06-18.md` §9。

**所有代码提交、代码审查和 CI 检查必须遵守本文档的全部规则。**

---

## 2. Do Not 清单（19 条）

### Do Not #1 — 禁止跨模块 import 下划线开头的私有成员

**规则**: 跨模块 `from X import _xxx` 一律禁止。

**原因**: 私有边界是契约的一部分；需要共享必须升 Protocol。

**检测**:
```bash
grep -rnE "from [^\s]+ import _" src/main/modules/
```

### Do Not #2 — 禁止 `hasattr(...)` + `setattr(...)` 反射修改其他类私有属性

**规则**: 接口没对齐时用反射修补 = 隐藏 bug；改 Protocol。

**原因**: 反射绕过类型检查，使接口不一致成为运行时问题而非编译时问题。

**检测**:
```bash
grep -rnE "hasattr.*setattr" src/main/
```

### Do Not #3 — 禁止 `except Exception: pass` 吞异常

**规则**: 任何吞掉的异常都会变成"线上诡异现象"；必须向上抛或转 FinAgentError。

**原因**: 静默吞异常导致故障不可观测，排查耗时剧增。

**检测**:
```bash
grep -rnE "except Exception: pass" src/main/
```

### Do Not #4 — 禁止字符串匹配异常文本做分类

**规则**: 异常必须结构化（继承 FinAgentError + ErrorCode），禁止 `if "HTTP 5" in str(e)`。

**原因**: 字符串匹配脆弱（拼写/翻译/版本变更都会静默失效）；ErrorCode 枚举提供稳定分类。

**检测**:
```bash
grep -rnE 'if "HTTP 5"' src/main/
```

### Do Not #5 — 禁止节点执行器直接操作 DB Session / commit / rollback

**规则**: 事务边界 = UoW；执行器是纯函数，不持有 db 引用。

**原因**: 执行器内 commit 打破事务边界，使 UoW 无法控制回滚。并行执行时多个执行器共享 Session 导致不可预期的提交顺序。

**检测**:
```bash
grep -rnE "self\._db|Session\(\)" src/main/modules/workflow/executor/
```

### Do Not #6 — 禁止保留双胞胎 / shim 模块 / 两条导入路径

**规则**: 重构期一次性切换；不允许共存。

**原因**: 两条路径导致 import 混乱，部分代码走新路径、部分走旧路径，出现难以排查的行为不一致。

**检测**:
```bash
grep -rnE "shim|legacy_compat" src/main/
```

### Do Not #7 — 禁止业务代码读 `os.environ` / 直接拼 URL

**规则**: 全部走 `settings.py`（pydantic-settings）。

**原因**: 散落的环境变量读取不可审计、不可 mock、不可重载。

**检测**:
```bash
grep -rnE "os\.environ|os\.getenv" src/main/modules/
```

### Do Not #8 — 禁止业务代码 inline 数值

**规则**: 端口/超时/重试次数/路径前缀等全部走 `settings.py` 或 `constants.py`。

**原因**: 魔法数字散落代码中导致配置难以统一修改，且容易遗漏。

**检测**:
```bash
grep -rnE "(4096|600|300)\b" src/main/modules/
```

### Do Not #9 — 禁止节点类型用字符串字面量

**规则**: 必须用 `NodeType` 枚举，禁止 `"input"`/`"output"`/`"debate"` 散落。

**原因**: 字符串字面量无法被类型检查器捕获拼写错误。

**检测**:
```bash
grep -rnE 'NodeType\("input"\)|"input"|"output"|"debate"' src/main/modules/
```

### Do Not #10 — 禁止状态用字符串字面量

**规则**: 必须用 `ExecutionStatus` 枚举，禁止 `"pending"`/`"running"`/`"failed"` 散落。

**原因**: 与 #9 相同，字符串字面量不可类型检查。

**检测**:
```bash
grep -rnE '"pending"|"running"|"completed"|"failed"|"skipped"' src/main/modules/
```

### Do Not #11 — 禁止单例缓存的 Executor Registry

**规则**: Executor 必须无状态，每次新建。

**原因**: 单例缓存使 executor 实例跨请求复用，可变状态累积导致数据串读。

**检测**:
```bash
grep -rnE "@lru_cache|executor_cache" src/main/modules/workflow/
```

### Do Not #12 — 禁止模块级全局变量保存服务实例

**规则**: 使用 FastAPI `app.state` + DI Registry，禁止 `_container`、`_db`、`_SERVICE_MAP` 等模块级全局变量。

**原因**: 模块级全局变量使测试难以隔离，且易在 import 时产生隐式初始化顺序问题。

**检测**:
```bash
grep -rnE "^[A-Z_]+ *[:=] *[^=].*=|_[a-z_]+ *=" src/main/modules/ | grep -v "settings|constants"
```

### Do Not #13 — 禁止 `from X import _private_func`

**规则**: 私有 = 私有；需要公开 → 升 Protocol（与 #1 同源，作为反例）。

**原因**: 与 Do Not #1 一致，import 私有成员等同于破坏模块封装。

**检测**:
```bash
grep -rnE "from [^\s]+ import _[a-z]" src/main/modules/
```

### Do Not #14 — 禁止测试用单独的注册路径

**规则**: 必须使用 `app.dependency_overrides[service_dep(...)] = lambda: mock`，禁止 `register("name", instance)`。

**原因**: 单独的注册路径与生产代码路径不同，可能导致测试通过但生产失败。

**检测**:
```bash
grep -rnE 'register\("' tests/
```

### Do Not #15 — 禁止日志用 `print()` / `%s` 拼接

**规则**: 必须使用 structlog JSON + contextvars。

**原因**: print 日志无法被日志系统过滤/路由；%s 拼接不支持结构化字段。

**检测**:
```bash
grep -rnE "print\(|logger\.[a-z]+\(.*%s|f\"" src/main/modules/
```

### Do Not #16 — 禁止 Agent 抛出非 FinAgentError 子类的异常

**规则**: 任何 agent 层异常必须 catch 后包成 `AgentTimeoutError`/`AgentHttp5xxError`/`McpServerError` 之一。

**原因**: 未包装的底层异常（httpx、requests 等）泄露实现细节且无法被 ErrorCode 分类处理。

**检测**:
```bash
grep -rnE "raise (httpx|requests|RuntimeError|ValueError)" src/main/modules/agent/
```

### Do Not #17 — 禁止注释/文档里出现迭代标记

**规则**: 迭代历史走 git / CHANGELOG，禁止 `"Wave 2"`/`"P1 pilot"` 等标记。

**原因**: 迭代标记在代码冻结后迅速过时，变成误导性注释。

**检测**:
```bash
grep -rnE "Wave [0-9]|P1 pilot|pilot 阶段" docs/tasks/
```

### Do Not #18 — 禁止依赖 ContextVar 在 asyncio.gather 并行任务间隐式传递 trace_id

**规则**: worker 必须显式接收 `trace_id: TraceId` 参数并 `bind_contextvars`。

**原因**: ContextVar 在跨 Task 调度时只继承调度时刻快照，子 Task 的 set 不会回写；一旦污染，日志 trace_id 错乱且不可复现。

**检测**:
```bash
grep -rnE "trace_id_var\.set|trace_ctx_var\.set" src/main/modules/
```

### Do Not #19 — 禁止执行器构造函数或类体内出现可变状态字段

**规则**: 执行器必须无状态；禁止 `_results`/`_failed_nodes`/`_skipped_nodes`/`_chain_sessions`/`_db` 等可变状态字段。

**原因**: 所有跨调用持久化状态由 WorkflowRunner 独占，通过 `NodeContext` 只读快照传入。并行执行时任何共享实例字段 = 数据串读。

**检测**:
```bash
grep -rnE "self\._(results|failed_nodes|skipped_nodes|chain_sessions|db)" src/main/modules/workflow/executor/
```

---

## 3. Do 清单（正向做法）

| Do Not # | 正向做法 |
|---|---|
| #1 | 需要共享功能 → 定义 `Protocol` 并注册到 DI `Registry` |
| #2 | 接口不对齐 → 修改 `Protocol` 签名，所有实现类同步更新 |
| #3 | 捕获异常后要么 `raise`（原样抛出），要么 `raise FinAgentError(...)` 包装后抛出；极少数需 logger.warning 记录后继续 |
| #4 | 定义 `ErrorCode` 枚举值，异常继承 `FinAgentError` 子类（`BizError`/`SystemError`/`InfraError`），调用方用 `except SomeError` 按类型捕获 |
| #5 | 执行器只读 `NodeContext`，返回 `NodeResult`；全部持久化由 `WorkflowRunner` 通过 `ExecutionRecorder` 完成 |
| #6 | 迁移完成后立即删除旧路径，不留 shim/兼容层 |
| #7 | 通过 `Settings` 单例（pydantic-settings，前缀 `FIN_AGENT_`）读取所有环境变量和 URL |
| #8 | 运维可配置值 → `settings.py`；业务不变量（改需评审）→ `constants.py` |
| #9 | `from modules.workflow.domain.node import NodeType`，用 `NodeType.INPUT` / `NodeType.OUTPUT` / `NodeType.DEBATE` |
| #10 | `from modules.execution.domain.execution_node import ExecutionStatus`，用 `ExecutionStatus.PENDING` / `ExecutionStatus.RUNNING` 等 |
| #11 | 每次节点执行通过 `NodeExecutorFactory.create(node_type, ..., dispatcher=..., execution_recorder=..., trace_id=...)` 创建新实例 |
| #12 | `Registry.register_singleton(Protocol, factory)` + `Registry.resolve(Protocol)`，生命周期由 `app.state.registry` 管理 |
| #13 | 需要公开的功能 → 在 `protocol.py` 中声明 Protocol 方法，模块外部只通过 Protocol 访问 |
| #14 | 测试 mock 用 `app.dependency_overrides[service_dep(SomeProtocol)] = lambda: mock_instance` |
| #15 | 用 `structlog.get_logger()`，`bind_contextvars(trace_id=..., execution_id=...)`，日志为一行 JSON |
| #16 | `except httpx.HTTPStatusError as e: raise AgentHttp5xxError(...) from e`，确保最终抛出的都是 `FinAgentError` 子类 |
| #17 | 功能分期信息写 git commit message 或 `CHANGELOG.md`，不写入代码注释/docstring |
| #18 | 所有 `asyncio.gather`/`TaskGroup` worker 签名含 `trace_id: TraceId`，入口 `bind_contextvars`，finally 中 `unbind_contextvars` |
| #19 | 执行器只保留不可变引用（`self.dispatcher`、`self.settings` 等），可变状态全部移入 `WorkflowRunner` 通过 `NodeContext` 只读快照传入 |

---

## 4. 代码审查检查表

PR reviewer 在审查代码时，逐条检查以下事项：

### 模块边界

- [ ] 没有跨模块 `import _xxx`（私有成员）
- [ ] 没有 `hasattr` + `setattr` 反射操作
- [ ] 没有 `from X import _private_func`

### 异常处理

- [ ] 没有 `except Exception: pass`
- [ ] 没有字符串匹配异常文本（`if "xxx" in str(e)`）
- [ ] 所有 `raise` 都是 `FinAgentError` 子类（agent 层尤其注意）
- [ ] 异常携带 `ErrorCode` 枚举

### 数据库与事务

- [ ] 执行器内没有 `Session()` / `commit()` / `rollback()`
- [ ] 执行器没有 `self._db` 字段
- [ ] 事务边界由 UoW 管理

### 配置与常量

- [ ] 没有 `os.environ` / `os.getenv` 散落业务代码
- [ ] 没有 inline 魔法数字（端口/超时/重试次数）
- [ ] 配置统一在 `settings.py`，业务不变量在 `constants.py`

### 类型安全

- [ ] 节点类型用 `NodeType` 枚举而非字符串
- [ ] 状态用 `ExecutionStatus` 枚举而非字符串

### DI 与全局状态

- [ ] 没有单例缓存的 Executor Registry
- [ ] 没有模块级全局变量（`_container`、`_db`、`_SERVICE_MAP`）
- [ ] 测试 mock 使用 `dependency_overrides`，无独立注册路径

### 日志

- [ ] 无 `print()` 日志
- [ ] 无 `%s` 拼接日志
- [ ] 使用 structlog JSON 格式

### 文档

- [ ] 注释/文档中没有 `Wave N`、`P1 pilot` 等迭代标记

### 并行与 trace

- [ ] `asyncio.gather` worker 签名含 `trace_id: TraceId` 参数
- [ ] worker 内 `bind_contextvars(trace_id=...)` 配对 `unbind_contextvars(...)`
- [ ] worker 内无 `trace_id_var.set()` / `trace_ctx_var.set()`

### 执行器状态

- [ ] 执行器构造函数无 `_results`/`_failed_nodes`/`_skipped_nodes`/`_chain_sessions`/`_db`
- [ ] 执行器只保留不可变引用

---

## 5. CI grep 检查命令模板

以下是可在 CI 中直接使用的 grep 检查命令。每条命令对应一条 Do Not 规则。

```bash
#!/usr/bin/env bash
# CI 静态检查脚本 — 零容忍模式
# 全部命令返回 0 表示通过；任何命令返回非零则 CI 失败

set -euo pipefail

echo "=== Do Not #1: 跨模块 import 私有成员 ==="
grep -rnE "from [^\s]+ import _" src/main/modules/ && exit 1 || echo "PASS"

echo "=== Do Not #2: 反射修改私有属性 ==="
grep -rnE "hasattr.*setattr" src/main/ && exit 1 || echo "PASS"

echo "=== Do Not #3: 吞异常 ==="
grep -rnE "except Exception: pass" src/main/ && exit 1 || echo "PASS"

echo "=== Do Not #4: 字符串匹配异常文本 ==="
grep -rnE 'if "HTTP 5"' src/main/ && exit 1 || echo "PASS"

echo "=== Do Not #5: 执行器操作 DB ==="
grep -rnE "self\._db|Session\(\)" src/main/modules/workflow/executor/ && exit 1 || echo "PASS"

echo "=== Do Not #6: shim 遗留 ==="
grep -rnE "shim|legacy_compat" src/main/ && exit 1 || echo "PASS"

echo "=== Do Not #7: os.environ 散落 ==="
grep -rnE "os\.environ|os\.getenv" src/main/modules/ && exit 1 || echo "PASS"

echo "=== Do Not #8: inline 魔法数字 ==="
grep -rnE "(4096|600|300)\b" src/main/modules/ && exit 1 || echo "PASS"

echo "=== Do Not #9: 节点类型字符串 ==="
grep -rnE 'NodeType\("input"\)|"input"|"output"|"debate"' src/main/modules/ && exit 1 || echo "PASS"

echo "=== Do Not #10: 状态字符串 ==="
grep -rnE '"pending"|"running"|"completed"|"failed"|"skipped"' src/main/modules/ && exit 1 || echo "PASS"

echo "=== Do Not #11: 单例缓存 registry ==="
grep -rnE "@lru_cache|executor_cache" src/main/modules/workflow/ && exit 1 || echo "PASS"

echo "=== Do Not #12: 模块级全局变量 ==="
grep -rnE "^[A-Z_]+ *[:=] *[^=].*=|_[a-z_]+ *=" src/main/modules/ \
  | grep -v "settings|constants" && exit 1 || echo "PASS"

echo "=== Do Not #13: import 私有函数 ==="
grep -rnE "from [^\s]+ import _[a-z]" src/main/modules/ && exit 1 || echo "PASS"

echo "=== Do Not #14: 测试独立注册 ==="
grep -rnE 'register\("' tests/ && exit 1 || echo "PASS"

echo "=== Do Not #15: print / %s 日志 ==="
grep -rnE "print\(|logger\.[a-z]+\(.*%s|f\"" src/main/modules/ && exit 1 || echo "PASS"

echo "=== Do Not #16: Agent 抛出非 FinAgentError 异常 ==="
grep -rnE "raise (httpx|requests|RuntimeError|ValueError)" src/main/modules/agent/ && exit 1 || echo "PASS"

echo "=== Do Not #17: 迭代标记 ==="
grep -rnE "Wave [0-9]|P1 pilot|pilot 阶段" docs/tasks/ && exit 1 || echo "PASS"

echo "=== Do Not #18: trace_id_var.set 在 worker 体内 ==="
grep -rnE "trace_id_var\.set|trace_ctx_var\.set" src/main/modules/ && exit 1 || echo "PASS"

echo "=== Do Not #19: 执行器可变状态字段 ==="
grep -rnE "self\._(results|failed_nodes|skipped_nodes|chain_sessions|db)" \
  src/main/modules/workflow/executor/ && exit 1 || echo "PASS"

echo ""
echo "=== 全部 19 项检查通过 ==="
```

---

## 附录 A: 引用来源

所有规则来源于目标架构设计文档的以下章节：

| 来源 | 内容 |
|---|---|
| `TARGET_ARCHITECTURE_v2_2026-06-18.md` §9 | 完整的 19 条 Do Not 清单 |
| `TARGET_ARCHITECTURE_v2_2026-06-18.md` §7.6 | #18 并行 trace_id 传递规则的详细原理 |
| `TARGET_ARCHITECTURE_v2_2026-06-18.md` §4.1 | #19 执行器无状态的详细推导 |
| `INDEX.md` §6.1 | Do Not 中央注册表（统一描述 + 验证 grep） |
