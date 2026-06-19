# TASK-006: infra/logging.py - 结构化 JSON 日志

> **阶段**: Phase 0 · **估时**: 3h · **优先级**: P1
> **上下文窗口**: 1 输入 · 1 输出

## 1. 元数据

| 字段 | 值 |
|---|---|
| 任务 ID | `TASK-006` |
| 所属阶段 | Phase 0 / infra |
| 前置任务 | TASK-002, TASK-005, TASK-007 |
| 后置任务 | TASK-411 |
| 输出文件 | `src/main/infra/logging.py` |

## 2. 目标

配置 structlog 输出 JSON 格式日志,自动合并 contextvars 中的 trace_id/execution_id/node_id/agent_name。

## 3. 上下文范围

### 3.1 输入文件

1. `docs/architecture/TARGET_ARCHITECTURE_v2_2026-06-18.md` §7.3

### 3.2 类型依赖

- `infra.domain.TraceId` (TASK-002)
- `infra.settings.Settings` (TASK-007) — 读取 `LOG_LEVEL`, `LOG_FORMAT`
- `infra.tracing.current_trace_id` (TASK-005)
- `structlog.contextvars.bind_contextvars / unbind_contextvars`(TASK-005 的 ContextVar 桥接层)

### 3.3 输出文件

1. `src/main/infra/logging.py` - 含:
   - `configure_logging(settings: Settings) -> None`: 初始化 structlog + stdlib logging
   - `get_logger(name: str) -> structlog.stdlib.BoundLogger`
   - 模块顶部:`import structlog`

## 4. 详细步骤

1. 依赖: `structlog>=24.1`(若环境未装,在 pyproject.toml 添加依赖,本卡片负责)
2. `configure_logging(settings)`:
   - 设置 stdlib root logger level
   - 配置 structlog processors 链:
     - `structlog.contextvars.merge_contextvars` (绑定 trace_id 等) — **必须包含** `structlog.contextvars.merge_contextvars` processor,这是 trace_id 贯穿到日志的关键桥接
     - `structlog.processors.add_log_level`
     - `structlog.processors.TimeStamper(fmt="iso", utc=True)`
     - `structlog.processors.StackInfoRenderer`
     - `structlog.processors.format_exc_info`
     - `structlog.processors.JSONRenderer()` (或 ConsoleRenderer 若 LOG_FORMAT=="console")
   - `structlog.configure(...)` 一次性绑定
3. `get_logger(name)` 返回 `structlog.get_logger(name)`

## 5. Do Not 清单

- [ ] **Do Not #15**: 必须 structlog JSON + contextvars — 必须用 `get_logger().info("event", key=val)` 形式
- [ ] **Do Not #3**: 任何吞掉的异常都会变成“线上诡异现象”;必须向上抛或转 FinAgentError — 即使在 logger 配置中也不行
- [ ] **Do Not #7**: 全部走 `settings.py`(pydantic-settings) — （LOG_LEVEL 等从 settings 来）
- [ ] **Do Not #1**: 跨模块 `from X import _xxx` 一律禁止;需要共享必须升 Protocol
- [ ] **Do Not(桥接)**: 禁止删除 `structlog.contextvars.merge_contextvars` processor — 它是从 TASK-005 的 ContextVar 读 trace_id 的唯一桥梁

## 6. 验收标准

- [ ] `python -c "from src.main.infra.logging import configure_logging, get_logger"` 退出码 0
- [ ] `configure_logging(Settings())` 不抛异常
- [ ] `log = get_logger("test"); log.info("hello", x=1)` 输出 JSON 行,含 `event=hello`, `x=1`, `level=info`
- [ ] 在 `bind(TraceId("tr-test"))` 作用域内调用 `log.info("e")`,日志 JSON 含 `trace_id=tr-test`
- [ ] `Settings(LOG_LEVEL="DEBUG").LOG_LEVEL == "DEBUG"` 验证 settings 联动
- [ ] 输出的 JSON 单行可被 `json.loads()` 解析
- [ ] `grep -nE "merge_contextvars" src/main/infra/logging.py` 命中 ≥ 1

## 7. 非目标

- 不实现日志文件落盘（仅 stdout）
- 不集成 Sentry / OpenTelemetry

## 8. 交付说明模板

> ⚠️ **实际执行命令后粘贴真实输出,禁止复制本节中的预期输出作伪。**

```
## TASK-006 交付说明

$ python -c "
from src.main.infra.settings import Settings
from src.main.infra.logging import configure_logging, get_logger
from src.main.infra.tracing import bind, reset, TraceId
configure_logging(Settings())
log = get_logger('test')
token = bind(TraceId('tr-demo'))
log.info('node.completed', execution_id='exe-1', agent_name='macro-scout')
reset(token)
"
{"event": "node.completed", "execution_id": "exe-1", "agent_name": "macro-scout", "trace_id": "tr-demo", "level": "info", "timestamp": "2026-06-18T..."}
```
