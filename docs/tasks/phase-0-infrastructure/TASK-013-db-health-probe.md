# TASK-013: infra/db_health.py + /api/v1/system/db_health — DB 迁移阈值 metrics

> **阶段**: Phase 0 / Phase 0.6（DB 迁移监测） · **估时**: 9h · **优先级**: P1
> **上下文窗口**: 2 输入 · 2 输出
> **关联修订**: REVISION_NOTES_2026-06-18.md 修订 **T-10**（PG 迁移阈值自动化监测）

## 1. 元数据

| 字段 | 值 |
|---|---|
| 任务 ID | `TASK-013` |
| 所属阶段 | Phase 0 / infra |
| 前置任务 | TASK-009 (db), TASK-011 (DI Registry), TASK-003, TASK-004, TASK-007 |
| 后置任务 | TASK-203 (ExecutionNode ORM), TASK-409 (api/system), TASK-501（验收清单 grep） |
| 输出文件 | `src/main/infra/db_health.py`, `src/main/api/v1/system.py` |

## 2. 目标

把 `TARGET_ARCHITECTURE_v2_2026-06-18.md` §4.3 表格里的 5 个 PG 迁移触发条件变成**可观测的 metrics**,通过 `GET /api/v1/system/db_health` 暴露,按 §4.3 表打 `severity: ok / warn / critical` 标签。

## 3. 上下文范围

### 3.1 输入文件

1. `docs/architecture/TARGET_ARCHITECTURE_v2_2026-06-18.md` §4.3 SQLite 并行写策略 + PG 迁移表
2. `docs/architecture/REVISION_NOTES_2026-06-18.md` 修订 T-10
3. `src/main/infra/db.py` (TASK-009) — `create_engine`, `DB_POOL_SIZE` 配置

### 3.2 类型依赖

- `infra.settings.Settings` (TASK-007) — `DB_POOL_SIZE`, `DATABASE_URL`
- `infra.di.Registry` (TASK-011)
- `infra.errors.SystemError` (TASK-003)
- `infra.api_envelope.ApiResponse` (TASK-004)
- `modules.execution.repo.orm.ExecutionNodeORM` (TASK-203) - 仅读 `status` 字段,不修改;**Phase 0 阶段不实施实际读表,仅定义 `parallel_node_concurrency` 字段采集入口,Phase 2 实施 TASK-203 后再接 ORM 查询**

### 3.3 输出文件

1. `src/main/infra/db_health.py` - 含:
   - `enum class MetricSeverity(str, Enum)`: OK / WARN / CRITICAL
   - `@dataclass class DBHealthMetric`: `name: str`, `value: float | int | str`, `severity: MetricSeverity`, `threshold_warn: Any`, `threshold_critical: Any`, `recommendation: str`
   - `@dataclass class DBHealthReport`: `metrics: list[DBHealthMetric]`, `overall: MetricSeverity`, `collected_at: datetime`
   - `class DBHealthProbe`:
     - `__init__(self, settings: Settings)` — 仅持有 settings + engine path
     - `async def collect(self) -> DBHealthReport`:
       - 采集 5 个指标
       - 按 §4.3 阈值表打 severity
2. `src/main/api/v1/system.py` - 含:
   - `router = APIRouter(prefix="/system", tags=["system"])`
   - `@router.get("/db_health")` handler:
     - Depends `DBHealthProbe` (从 Registry resolve)
     - 返回 `ApiResponse(data=report)`

## 4. 详细步骤

### 4.1 db_health.py

1. `from __future__ import annotations`
2. `from enum import Enum`, `dataclass`, `datetime`, `os`, `glob`, `pathlib.Path`
3. `from src.main.infra.settings import Settings`
4. `class MetricSeverity(str, Enum)`: OK = "ok", WARN = "warn", CRITICAL = "critical"
5. `class DBHealthMetric`:
   - 字段如上
   - `to_dict()` 返回 `{name, value, severity, threshold_warn, threshold_critical, recommendation}`
6. `class DBHealthProbe`:
   - `__init__(settings)`: self.settings = settings; self.db_path = self._resolve_db_path()
   - `_resolve_db_path()`: 从 settings.DATABASE_URL 解析出本地文件路径(支持 `sqlite:///./data/finagent.db` 与 `sqlite:///:memory:`)
   - `async def collect() -> DBHealthReport`:
     - 顺序采集 5 个指标,任一采集失败 → 该指标 severity=CRITICAL + recommendation 含"采集失败"
     - `overall = max(severity for m in metrics)`(CRITICAL > WARN > OK)

### 4.2 5 个指标的具体实现

| 指标 | 数据源 | warn 阈值 | critical 阈值 | 备注 |
|---|---|---|---|---|
| `parallel_node_concurrency` | ExecutionNode 表 `status=RUNNING` 计数(用 in-memory 计数器或 SQL 查) | > 5 | > 10 | §4.3 触发条件 #1 |
| `db_file_size_bytes` | `os.path.getsize(self.db_path)` | > 500 MB | > 1 GB | §4.3 触发条件 #2 |
| `wal_file_count` | `glob.glob(f"{db_path}-wal*")` 计数 | > 1 | > 5 | WAL checkpoint 异常信号 |
| `worker_count` | `int(os.environ.get("UVICORN_WORKERS", "1"))` | > 1 | > 4 | §4.3 触发条件 #3 |
| `write_qps` | 60s 滑动窗口的 INSERT/UPDATE 计数(用 inflight 计数器估算) | > 100 | > 200 | §4.3 触发条件 #5 |

**注意**: `db_file_size_bytes` 与 `wal_file_count` 在 `:memory:` 模式下返回 `(0, 0)` severity=OK,避免假阳性。

**Do Not 联动**（修订 T-10 末尾）: 违反 Do Not #16（"Agent 抛出非 FinAgentError 子类的异常"）需在 metrics 中暴露告警计数。可在本卡片**预留一个 hook**,由 TASK-109 / TASK-310 提供计数器,本卡片只读取并展示。

### 4.3 system.py 路由

```python
from fastapi import APIRouter, Depends
from src.main.infra.db_health import DBHealthProbe
from src.main.api.deps import service_dep  # TASK-405
from src.main.infra.api_envelope import ApiResponse

router = APIRouter(prefix="/system", tags=["system"])

@router.get("/db_health")
async def db_health(
    probe: DBHealthProbe = Depends(service_dep(DBHealthProbe)),
) -> dict:
    report = await probe.collect()
    return ApiResponse(code=0, message="ok", data=report.to_dict(), trace_id=...).to_dict()
```

**注**: `DBHealthProbe` 需在 `main.py::build_registry` 中显式 `reg.register_singleton(DBHealthProbe, lambda r: DBHealthProbe(r.resolve(Settings)))`(TASK-411 实现)。

## 5. Do Not 清单

- [ ] **Do Not #6**: 重构期一次性切换;不允许共存
- [ ] **Do Not #12**: FastAPI `app.state` + DI Registry
- [ ] **Do Not #3**: 任何吞掉的异常都会变成“线上诡异现象”;必须向上抛或转 FinAgentError — 采集失败必须记录 severity 而非静默
- [ ] **Do Not #8**: 全部走 `settings.py` 或 `constants.py`
- [ ] **修订 T-10 约束**: 必须暴露 §4.3 全部 5 个阈值,**禁止**"先实现 3 个,后两个 TODO"

## 6. 验收标准

- [ ] `python -c "from src.main.infra.db_health import DBHealthProbe, MetricSeverity, DBHealthReport"` 退出码 0
- [ ] `python -c "from src.main.api.v1.system import router"` 退出码 0
- [ ] 单测 `test_db_health_collect`: 写入 > 1 GB mock db 后,`report.metrics` 列表中 `name="db_file_size_bytes"` 的 metric `severity == CRITICAL`(用 `next(m for m in report.metrics if m.name == "db_file_size_bytes")` 查找)
- [ ] 单测 `test_db_health_memory_db`: `:memory:` 模式下 file_size / wal_file 指标为 OK
- [ ] 单测 `test_db_health_overall_severity`: 任一指标 CRITICAL → overall=CRITICAL
- [ ] 启动 FastAPI 后 `curl -s http://127.0.0.1:8000/api/v1/system/db_health | jq .data.overall` 返回 "ok"
- [ ] **关键 grep**: `grep -nE 'parallel_node_concurrency|db_file_size_bytes|wal_file_count|worker_count|write_qps' src/main/infra/db_health.py` 命中 5 个

## 7. 非目标

- 不实现真正的 PG 迁移逻辑（只在指标里暴露信号）
- 不实现写入 QPS 的精确计数（用 inflight 计数器估算即可）
- 不实现 Do Not #16 联动告警计数器（预留 hook 接口,TASK-310 接入）

## 8. 交付说明模板

> ⚠️ **实际执行命令后粘贴真实输出,禁止复制本节中的预期输出作伪。**

```
## TASK-013 交付说明

### Do Not 核对
- [x] Do Not #6: 仅 reg.register_singleton(DBHealthProbe, ...)
- [x] Do Not #12: 无模块级单例
- [x] Do Not #3: 采集失败用 CRITICAL 暴露,不静默
- [x] Do Not #8: 阈值集中在 §4.3 表
- [x] 修订 T-10: 5 个指标全部实现,无 TODO

### 验收命令输出
$ grep -nE 'parallel_node_concurrency|db_file_size_bytes|wal_file_count|worker_count|write_qps' src/main/infra/db_health.py
45:    _check_parallel_node_concurrency(...)
78:    _check_db_file_size_bytes(...)
112:   _check_wal_file_count(...)
145:   _check_worker_count(...)
180:   _check_write_qps(...)
$ pytest tests/infra/test_db_health.py -v
test_db_health_collect PASSED
test_db_health_memory_db PASSED
test_db_health_overall_severity PASSED

### 偏离 / 备注
（如有:哪些阈值改了 / 为什么）
（如无:无偏离,严格按修订 T-10 执行）
```
