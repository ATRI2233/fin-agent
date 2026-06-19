# TASK-007: infra/settings.py - pydantic-settings 配置

> **阶段**: Phase 0 · **估时**: 4h · **优先级**: P0
> **上下文窗口**: 1 输入 · 1 输出

## 1. 元数据

| 字段 | 值 |
|---|---|
| 任务 ID | `TASK-007` |
| 所属阶段 | Phase 0 / infra |
| 前置任务 | TASK-002, TASK-003 |
| 后置任务 | TASK-008, 009, 011, 012, TASK-108 (serve_backend), TASK-411, TASK-013, TASK-014 |
| 输出文件 | `src/main/infra/settings.py` |

## 2. 目标

所有环境 / 路径 / 端口 / 超时 / 重试次数的单一来源,带 `validate()` 一致性校验。

## 3. 上下文范围

### 3.1 输入文件

1. `docs/architecture/TARGET_ARCHITECTURE_v2_2026-06-18.md` §5.1

### 3.2 类型依赖

- `infra.errors.ConfigError` (TASK-003)

### 3.3 输出文件

1. `src/main/infra/settings.py` - 含 `class Settings(BaseSettings)`,严格按设计文档 §5.1 实现:
   - 全部 30+ 字段（API_PORT, DATABASE_URL, DB_POOL_SIZE, OPENCODE_SERVE_PORT, NODE_TIMEOUT_SECONDS, MAX_AGENT_RETRIES, ...）
   - `class Config: env_prefix = "FIN_AGENT_"`
   - `@property opencode_serve_url -> str`
   - `def validate() -> None`: 4 条一致性校验

## 4. 详细步骤

1. `from __future__ import annotations`
2. `from pathlib import Path` + `from typing import Literal`
3. `from pydantic_settings import BaseSettings, SettingsConfigDict`
4. `from src.main.infra.errors import ConfigError`
5. 按设计文档 §5.1 完整列出所有字段,带默认值与类型注解
6. `class Config: env_prefix = "FIN_AGENT_"` + `env_file = ".env"`(可选)
7. `@property def opencode_serve_url(self)` 返回 `f"http://{self.OPENCODE_SERVE_HOST}:{self.OPENCODE_SERVE_PORT}"`
8. `def validate(self)`:
   - 检查端口冲突
   - 检查 OPENCODE_AGENTS_DIR 存在
   - 检查 OPENCODE_MCP_CONFIG 存在
   - 检查 DB_POOL_SIZE >= MAX_PARALLEL_NODES
   - 任一失败 raise ConfigError
9. 模块底部:`settings = Settings()`（**注意**: 这会触发 Pydantic 读取 env,**但不调用 validate**;validate 由 main.py 调用）

## 5. Do Not 清单

- [ ] **Do Not #7**: 全部走 `settings.py`(pydantic-settings) — Settings 是**唯一**入口
- [ ] **Do Not #8**: 全部走 `settings.py` 或 `constants.py` — 必须引用 settings.<FIELD>
- [ ] **Do Not #3**: 任何吞掉的异常都会变成“线上诡异现象”;必须向上抛或转 FinAgentError — 必须 raise ConfigError

## 6. 验收标准

- [ ] `python -c "from src.main.infra.settings import Settings, settings"` 退出码 0
- [ ] `Settings().API_PORT == 8000`
- [ ] `Settings().OPENCODE_SERVE_PORT == 4096`
- [ ] `Settings().opencode_serve_url == "http://127.0.0.1:4096"`
- [ ] `Settings(API_PORT=9999).API_PORT == 9999`
- [ ] `FIN_AGENT_API_PORT=9999 python -c "from src.main.infra.settings import Settings; print(Settings().API_PORT)"` 输出 9999
- [ ] `Settings(OPENCODE_SERVE_PORT=8000, API_PORT=8000).validate()` 抛 ConfigError
- [ ] `Settings(OPENCODE_AGENTS_DIR=Path("/nonexistent")).validate()` 抛 ConfigError

## 7. 非目标

- 不写 .env 文件示例（运维配置）
- 不实现热重载

## 8. 交付说明模板

> ⚠️ **实际执行命令后粘贴真实输出,禁止复制本节中的预期输出作伪。**

```
## TASK-007 交付说明

$ python -c "
from src.main.infra.settings import Settings
s = Settings()
print('port:', s.API_PORT, 'serve:', s.opencode_serve_url)
s.validate()
print('validate ok')
"
port: 8000 serve: http://127.0.0.1:4096
validate ok
```
