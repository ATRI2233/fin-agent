# TASK-501: 删除 framework/ + 占位目录 + 更新 CLAUDE.md（前置 TASK-500）

> **阶段**: Phase 5 / 1（在 TASK-500 之后）· **估时**: 10h（原 3h 调整,含 pytest + grep 验证）· **优先级**: P0
> **上下文窗口**: 1 输入（TARGET_ARCHITECTURE）+ 1 文件重写 + 多次删除 + grep 验证
> **关联修订**: REVISION_NOTES_2026-06-18.md 修订 **A-1**（CLAUDE.md 漏标 shim）
> **前置卡片**: TASK-500（Gate 5.5 必须通过,3 份 importer txt 全部清零）

## 1. 元数据

| 字段 | 值 |
|---|---|
| 任务 ID | `TASK-501` |
| 所属阶段 | Phase 5 / cleanup |
| 前置任务 | **TASK-500**, TASK-CCC-04, TASK-411, **且所有集成测试通过** |
| 后置任务 | 无（项目标记 done） |
| 输出文件 | `CLAUDE.md`（重写） |
| 删除文件/目录 | `framework/`, `dacide/`, `data_learning/`, `timely_tade/`;`phase0_shim_importers.txt`, `phase0_init_consumers.txt`, `phase0_reexport_consumers.txt`(TASK-500 附件) | 注: `src/main/api/v1/_legacy_compat.py` **不删除**,留待后续 sprint 单独清理卡片处理 |

## 2. 目标

物理删除旧代码,更新文档,跑最终验收清单。**CLAUDE.md 必须同步重写**(修订 A-1 暴露的"漏标 shim"问题在重构后由"完全重写"解决)。

**前置 Gate**: 本卡的"删除目录"步骤必须**在 TASK-500 完成后**执行。TASK-500 负责 3 份 importer 扫描 + 全部 importer 切换 + CI grep 验证为 0 行;本卡只负责"扫描已清零 + 物理删除 + 文档重写"。

## 3. 上下文范围

### 3.1 输入文件

1. `docs/architecture/TARGET_ARCHITECTURE_v2_2026-06-18.md` §8.2 删除清单
2. `docs/architecture/REVISION_NOTES_2026-06-18.md` 修订 A-1
3. **TASK-500 产出**(本卡的前置):`phase0_shim_importers.txt` / `phase0_init_consumers.txt` / `phase0_reexport_consumers.txt` 三份文件已存在,内容已清零
4. `CLAUDE.md`(现有,需重写)
5. `pyproject.toml`(可能需调整)

### 3.2 类型依赖

无（清理动作）

### 3.3 输出

1. 删除目录:
   - `src/main/framework/`(整个)
   - `src/main/framework/api/`(已在 framework 内)
   - `src/main/dacide/`, `src/main/data_learning/`, `src/main/timely_tade/`(空占位)
2. 删除文件:
   - `phase0_shim_importers.txt`, `phase0_init_consumers.txt`, `phase0_reexport_consumers.txt`(TASK-500 的 PR 附件,在本卡物理删除 shim 后失去存在价值,git rm)
   - **不删除** `src/main/api/v1/_legacy_compat.py`(留待后续 sprint 单独清理卡片处理)
3. 修改文件:
   - `CLAUDE.md`: 重写目录结构章节,与磁盘 tree 对齐;**显式标注 shim 已删除**(修订 A-1 闭环)
   - `pyproject.toml`: 删除 framework 相关路径(若有)

## 4. 详细步骤

### 4.1 第 1 步：验证 TASK-500 产出(3 份 txt 已清零)

```bash
# 验证 TASK-500 已完成: 旧 shim 路径在源码内不再引用
$ grep -rn "from main.framework.services" src/main/
→ 必须 0 行

$ grep -rn "from main.framework\|from src.main.framework" src/main/
→ 必须 0 行

# 验证 3 份 txt 文件存在且内容已记录(用于 PR 历史)
$ ls phase0_shim_importers.txt phase0_init_consumers.txt phase0_reexport_consumers.txt
→ 3 个文件均存在
```

**只有上述 grep 全部为 0 行才能进入第 2 步的删除。**

### 4.2 第 2 步：删除目录

```bash
# 二次确认 framework 已无 import(防止 TASK-500 后又有新 PR 引入)
$ grep -rn "from main.framework\|from src.main.framework" src/main/ tests/
→ 必须 0 行(若有残留,先修复,再删)

$ rm -rf src/main/framework/
$ rm -rf src/main/dacide/ src/main/data_learning/ src/main/timely_tade/

# 删除 TASK-500 的 3 份附件(本卡物理删除 shim 后失去存在价值)
$ git rm phase0_shim_importers.txt phase0_init_consumers.txt phase0_reexport_consumers.txt

# _legacy_compat.py 不在本卡删除范围,留待后续 sprint 单独清理卡片处理
```

### 4.3 第 3 步：更新 CLAUDE.md（修订 A-1 闭环）

新 CLAUDE.md 目录树章节应反映:
- `src/main/api/`(新,含 v1 routers,**不再包含 `_legacy_compat.py`**)
- `src/main/infra/`(新)
- `src/main/modules/{mcp,agent,execution,workflow,conversation}/`(新)
- 删掉 `framework/` 相关
- 删掉 `dacide/data_learning/timely_tade` 占位段
- **新增一段"shim 已删除"声明**(修订 A-1 闭环):
  > 注: 本次重构已删除全部 `framework/services/{workflow,execution,...}_service.py` shim 与 canonical `framework/services/core/` 双路径,所有 import 走 `modules/*/protocol.py` 的 Protocol + Depends(service_dep(...))。

### 4.4 第 4 步：清理 Wave N 注释

```bash
$ grep -rn "Wave [0-9]" src/main/ tests/
→ 必须 0 行(若有,清理)
```

### 4.5 第 5 步：最终验收

跑设计文档 §10 验收清单的**全部** grep 检查 + 修订 T-12 追加的 14 项 grep 检查(由 TASK-CCC-04 维护)。

## 5. Do Not 清单

- [ ] **Do Not #6**(P6): 重构期一次性切换;不允许共存 — 本卡片物理删除所有 shim 文件
- [ ] **Do Not #17**: 迭代历史走 git / CHANGELOG
- [ ] **Do Not #3**: 任何吞掉的异常都会变成“线上诡异现象”;必须向上抛或转 FinAgentError
- [ ] **修订 T-6 强约束**: **禁止**在 TASK-500 未完成(即 3 份 importer txt 任一仍有命中)时执行 `rm -rf framework/`
- [ ] **修订 A-1 闭环**: CLAUDE.md 重写后必须显式标注"shim 已删除",不允许只更新目录树而不写 shim 删除声明


## 6. 验收标准

### 6.1 TASK-500 前置产出(引用,不重复执行)

- [ ] **引用 TASK-500 产出**:`grep -rn "from main.framework.services" src/main/` → 0 行(由 TASK-500 完成)
- [ ] **引用 TASK-500 产出**:`phase0_shim_importers.txt` / `phase0_init_consumers.txt` / `phase0_reexport_consumers.txt` 已存在于 git 历史(由 TASK-500 commit)

### 6.2 删除与更新

- [ ] `test -d src/main/framework` → exit code 1(不存在)
- [ ] `test -d src/main/dacide` → exit code 1
- [ ] `test -d src/main/data_learning` → exit code 1
- [ ] `test -d src/main/timely_tade` → exit code 1
- [ ] `test -f src/main/api/v1/_legacy_compat.py` → exit code 0(本卡片**不删除**,留待后续 sprint 单独清理卡片处理)
- [ ] **关键 grep #1**: `grep -rn "from main.framework\|from src.main.framework" src/ tests/` → 0
- [ ] **关键 grep #2**: `grep -rn "_resolve_agent_name" src/` → 0
- [ ] **关键 grep #3**: `grep -rn "hasattr.*setattr" src/main/` → 0
- [ ] **关键 grep #4**: `grep -rn 'except Exception: pass' src/main/` → 0
- [ ] **关键 grep #5**: `grep -rn 'if "HTTP 5"' src/main/` → 0
- [ ] **关键 grep #6**: `grep -rn "_SERVICE_MAP\|_container\|create_message_processor" src/main/` → 0
- [ ] **关键 grep #7**: `grep -rn "Wave [0-9]" src/` → 0
- [ ] **修订 A-1 验证**: `grep -nE 'shim 已删除' CLAUDE.md` 命中 ≥ 1

### 6.3 测试与运行

- [ ] `pytest tests/ -v` 全绿
- [ ] `python -c "from src.main.api.app import create_app, lifespan; create_app()"` 启动成功

> 注:`create_app` 由 TASK-409 拥有,在 `src/main/api/app.py`;`src/main/main.py` 仅 `build_registry` 与 `__main__` 入口。

## 7. 非目标

- 不做 3 份 importer 扫描(由 TASK-500 负责)
- 不做 importer 切换(由 TASK-500 负责)
- 不重写 README.md(后续单独卡片)
- 不写发布说明(CHANGELOG.md 留给运维)
- 不删除 `_legacy_compat.py`(由后续 sprint 单独清理卡片处理)

## 8. 交付说明模板

> ⚠️ **实际执行命令后粘贴真实输出,禁止复制本节中的预期输出作伪。**

```
## TASK-501 交付说明

### TASK-500 前置验证(引用,不重复)
$ wc -l phase0_shim_importers.txt phase0_init_consumers.txt phase0_reexport_consumers.txt
(从 TASK-500 引用,本卡已 git rm)

$ grep -rn "from main.framework" src/ tests/
(no output)

### 删除
$ test -d src/main/framework && echo EXISTS || echo GONE
GONE
$ test -d src/main/dacide && echo EXISTS || echo GONE
GONE

### 关键 grep
$ grep -rn "from main.framework" src/ tests/
(no output)

$ grep -rn "_SERVICE_MAP\|_container\|create_message_processor" src/main/
(no output)

$ grep -nE 'shim 已删除' CLAUDE.md
89:> 注: 本次重构已删除全部 `framework/services/{workflow,execution,...}_service.py` shim 与 canonical `framework/services/core/` 双路径,所有 import 走 `modules/*/protocol.py` 的 Protocol + Depends(service_dep(...))。

### 测试
$ pytest tests/ -q
============================== N passed ==============================

### 偏离 / 备注
无偏离,严格按修订 A-1 执行(TASK-500 已完成 3 份 importer 清零前置)
```
