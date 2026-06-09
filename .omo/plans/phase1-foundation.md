# PHASE 1: 基础建设与安全网 - 完整执行计划

> **项目**: fin-agent (金融分析多Agent系统)
> **阶段**: PHASE 1 - 基础建设与安全网 (3周)
> **基础**: PHASE1.md 详细规划 + Metis 风险分析

---

## TL;DR

> **Quick Summary**: 执行 fin-agent PHASE 1 完整重构 - 建立测试安全网、修复 SQLite 并发问题、构建 Repository 数据访问层、消除 37 处散落的 SessionLocal() 调用、完成 DI 容器落地。
>
> **Deliverables**:
> - 10-15 个集成测试（安全网）
> - SQLite WAL 模式 + busy_timeout
> - BaseRepository[T] 泛型基类 + 5 个领域 Repository
> - config/ 配置层（settings/constants/database）
> - DI 容器增强（singleton/factory）
> - 自动化防护工具（ruff, ESLint, pre-commit, 行数/分层检测）
> - 消除全部 37 处 SessionLocal() 调用（13个文件）
> - 统一 Depends(get_db) 注入
>
> **Estimated Effort**: Large (3 weeks / ~15-20 working days)
> **Parallel Execution**: YES - 5 waves, max 8 tasks per wave
> **Critical Path**: Wave 1 (configs) → Wave 2 (tests) → Wave 3 (data layer) → Wave 4 (migration) → Wave 5 (cleanup)

---

## Context

### Original Request
用户指示"聚焦PHASE 1"——完整执行 `PHASE1.md` 的3周基础建设计划。

### Interview Summary
**Key Decisions (with defaults applied)**:
- 测试DB隔离: 内存SQLite (`:memory:`) + 每次重置schema — 最干净，避免污染dev DB
- `data_maintenance`范围: **INCLUDE**（仅2处调用，完整收尾）
- 后台任务模式统一: **DEFER to PHASE 2**（不在PHASE 1范围）
- Container位置: KEEP in `core/`（无需迁移）
- `execution_repo` API: **PRESERVE backward compat**（保留11个方法签名）

**Metis Risk Findings Incorporated**:
- PHASE1.md 说12个文件，实际**13个**（`data_maintenance`被遗漏）
- `execution_repo.py`与`BaseRepository[T]`设计**不兼容**（`with self._sf() as db:`内部管理模式）→ Wave 3重构为接收`db: Session`
- 4个全局状态模式未在PHASE1显式列举: `_engine_factory`, `_scheduler_instance`, `session_manager`, `configure()`
- `conversations.py:281`嵌套`db2 = SessionLocal()` — 正是PHASE1要解决的bug
- 7+ 处 SessionLocal() 在 async/background context（Depends(get_db)不工作）→ 使用 `get_session_factory()`

### Research Findings
- 现有 execution_repo.py 197行，11个方法，被 `executions.py:83-88,161` 使用
- container.py 90行，仅注册 `execution_repo`，无其他 repo
- database.py 24行 - 基础已有，需加 WAL pragma
- config.py 42行 - 基础已有，需迁移到 config/

---

## Work Objectives

### Core Objective
执行 fin-agent PHASE 1 完整重构（基础建设与安全网），建立测试安全网，修复 SQLite 并发问题，落地 Repository 数据访问层 + DI 容器，删除 37 处散落的 SessionLocal() 调用。

### Concrete Deliverables
- `tests/` 目录（conftest.py + 4个集成测试文件 + unit/ 目录）
- `main/framework/config/`（settings.py, constants.py, database.py）
- `main/framework/repositories/base.py`（BaseRepository[T]）
- 5个领域 Repository（agent, workflow, conversation, maintenance, execution-重写）
- `main/framework/services/unit_of_work.py`（UnitOfWork 模式）
- `pyproject.toml` + `.pre-commit-config.yaml`
- `webui/.eslintrc.json` + `scripts/check_lines.py` + `scripts/check_dependencies.py`
- 12个核心文件完成 SessionLocal → Repository 迁移
- `data_maintenance/models/maintenance_db.py` 迁移

### Definition of Done
- [ ] `grep -r "SessionLocal()" main/ --include="*.py"` 仅在 `database.py` + `maintenance_db.py` 的 `_SessionLocal` 定义
- [ ] `pytest tests/integration/` 全部 10-15 个测试通过
- [ ] `pytest tests/unit/` 至少 30 个测试通过
- [ ] `ruff check main/ webui/` 无错误
- [ ] `python scripts/check_lines.py` 无 500+ 行文件
- [ ] `python scripts/check_dependencies.py` 0 violation
- [ ] `PRAGMA journal_mode=WAL` 在运行时生效
- [ ] `git grep -n "configure(" main/` 返回 0 结果（除 Container）
- [ ] `git grep -n "_engine_factory\|_scheduler_instance\|session_manager" main/` 仅在 Container 中

### Must Have
- 集成测试 10-15 个全部通过
- SQLite WAL 模式生效
- 5 个 Repository 全部实现并可独立单元测试
- 所有 API 端点通过 `Depends(get_db)` 获取数据库会话
- `BaseRepository[T]` 泛型基类可实例化
- DI 容器支持 singleton / factory 注册
- ruff + ESLint 规则配置完成
- pre-commit hooks 可运行

### Must NOT Have (Guardrails)
- ❌ 拆分 conversations.py (PHASE 2 关注)
- ❌ 拆分 workflow_engine.py (PHASE 2 关注)
- ❌ 切换到 async DB 驱动
- ❌ 引入 Alembic 或 schema migration 工具
- ❌ 修改 webui/（除添加 ESLint 配置）
- ❌ 修改 Conversation / Workflow / Execution / Agent model schemas
- ❌ 添加新端点或修改现有响应结构
- ❌ 修改 data_maintenance 业务逻辑（仅 SessionLocal→maintenance_repo 迁移）
- ❌ 绕过 Container 创建模块级 repo 实例
- ❌ 改变 ExecutionRepository 11 个方法签名（向后兼容）

---

## Verification Strategy (MANDATORY)

> **ZERO HUMAN INTERVENTION** - ALL verification is agent-executed.

### Test Decision
- **Infrastructure exists**: NO (需从头创建)
- **Automated tests**: **TDD** (Wave 2 先写测试覆盖当前代码作为安全网, Wave 3 再为新 Repository 写单元测试)
- **Framework**: pytest + pytest-asyncio (从 PHASE1.md 决策)
- **Test DB**: 内存SQLite (`:memory:`) + 每测试 class 重建 schema

### QA Policy
每个任务 MUST 包含 agent-executed QA 场景，证据保存到 `.omo/evidence/task-{N}-{scenario-slug}.{ext}`。
- **Backend (API/DB)**: 使用 `bash` (curl) + `pytest` - 发送请求, 断言状态码 + 响应字段
- **Python module**: 使用 `python -c "..."` 导入验证
- **WAL mode**: 连接到 sqlite, 断言 `PRAGMA journal_mode` 返回 `wal`
- **Configs**: 解析 TOML/YAML/JSON 验证语法

---

## Execution Strategy

### Git Checkpoint Strategy (MANDATORY — Per-Wave + Per-Step)

> **用户要求**: "每一个wave或者步骤都要git存档" — 任何中断后可从 git 历史恢复
> **实现**: 每个 Step (Task) 单次 commit + 每个 Wave 完成后 checkpoint commit + lightweight tag
> **验证**: 每个 Wave 开始前必须 `git status` 干净, 完成后必须 `git status` 干净

**Pre-Flight Task 0 (Wave 0): Git Baseline Setup** — 在 Wave 1 开始前必须完成:
- 验证 git 在 PATH 中（Windows 环境需用 `C:\Program Files\Git\bin\git.exe` 全路径或加入 PATH）
- 处理现有 5 个 uncommitted deletions (ARCHITECTURE_AUDIT.md 等)
- 创建分支 `phase1-foundation`（基于 master）
- 更新 `.gitignore` 排除 `.omo/drafts/`, `.omo/notepads/`, `.omo/run-continuation/`，**保留** `.omo/evidence/` 和 `.omo/plans/`
- Baseline commit 锁定当前状态

**Per-Task (Step) Git 操作**:
```
git add <specific files from task>
git commit -m "<conventional commit message from task>"
```
每个任务有独立 `Commit: YES` + 具体 message (已在每个 task 中定义)

**Per-Wave Checkpoint** (在 Wave 全部任务完成后执行):
```
git add -A
git commit --allow-empty -m "chore(checkpoint): phase1-wave-N complete

Wave N summary:
- Tasks 1-M: <brief description>
- All QA scenarios passed
- Integration tests: <X/Y passed>

Tag: phase1-wave-N-complete"
git tag phase1-wave-N-complete
git push origin phase1-foundation
```

**Wave 失败恢复**:
```
# 恢复到上一个 wave
git checkout phase1-wave-N-complete
# 或恢复到上一个 task
git log --oneline | grep "Task X"
git checkout <commit-sha>
```

### Parallel Execution Waves

```
Wave 0 (Pre-Flight - 1 task, BLOCKS all other waves):
  0. Git baseline setup: PATH, branch, .gitignore, commit uncommitted docs

Wave 1 (Foundation - 7 tasks, all parallel, no functional change):
  1. pyproject.toml + pytest + ruff config
  2. .pre-commit-config.yaml
  3. scripts/check_lines.py + scripts/check_dependencies.py
  4. SQLite WAL mode in database.py
  5. tests/conftest.py with isolated test DB fixture
  6. webui/.eslintrc.json
  7. BaseRepository[T] generic class

Wave 2 (Safety Net - 4 tasks, all parallel, tests against CURRENT code):
  8. Integration tests for conversation flow (3 cases)
  9. Integration tests for workflow flow (3 cases)
  10. Integration tests for scheduled workflow (2 cases)
  11. Integration tests for dispatch flow (2 cases)

Wave 3 (Data Layer Build - 8 tasks, all parallel, new files only):
  12. config/ directory (settings.py, constants.py, database.py)
  13. AgentRepository (new)
  14. WorkflowRepository (new)
  15. ConversationRepository (new)
  16. MaintenanceRepository (new)
  17. Refactor execution_repo.py to extend BaseRepository[T] (backward compat)
  18. Update Container to register all 5 repos
  19. UnitOfWork pattern (services/unit_of_work.py)

Wave 4 (Migration - 12 tasks, ORDERED SEQUENTIALLY by coupling):
  20. agents.py (1 call) [lowest coupling]
  21. system.py (1 call)
  22. performance.py (2 calls)
  23. sessions.py (4 calls)
  24. triggers.py (6 calls)
  25. executions.py (6 calls) - removes module-level repo
  26. retry_handler.py (2 calls)
  27. session_cleanup.py (2 calls)
  28. scheduler.py (4 calls) - removes _engine_factory global
  29. workflow_engine.py (3 calls) - engine session lifecycle decision
  30. conversations.py (3+1 nested) - removes session_manager + nested db2
  31. maintenance_db.py (2 calls) - separate DB, dual-repo pattern

Wave 5 (Cleanup - 3 tasks, parallel):
  32. Remove db.expire_all() workarounds
  33. Remove dead ExecutionRepository() module-level instantiation
  34. Verify all globals replaced

Wave FINAL (4 review tasks, parallel):
  F1. Plan compliance audit (oracle)
  F2. Code quality review (unspecified-high)
  F3. Real manual QA (unspecified-high)
  F4. Scope fidelity check (deep)
```

### Dependency Matrix (abbreviated)
- **1-7** (Wave 1): no deps → run immediately in parallel
- **8-11** (Wave 2): depend on 5 (conftest) → run in parallel after Wave 1
- **12-19** (Wave 3): depend on 7 (BaseRepository) → run in parallel after Wave 1
- **20-31** (Wave 4): sequential, depend on previous Wave 4 task completion + all Wave 3
- **32-35** (Wave 5): depend on all Wave 4 → run in parallel

---

## TODOs

> Implementation + Test = ONE Task. Never separate.
> **FORMAT**: Task labels MUST use bare numbers: `1.`, `2.`, `3.` — NOT `T1.`, `Task 1.`, `Phase 1:`.
> Final Verification Wave labels MUST use `F1.`, `F2.`, etc. — NOT `T-F1.`, `F-1.`, `Final 1.`.
> **A task WITHOUT QA Scenarios is INCOMPLETE. No exceptions.**

### Wave 0: Pre-Flight (1个任务 - 阻塞所有其他 Waves)

- [x] 0. **Git 基线设置（PATH、分支、.gitignore、uncommitted docs）**

  **What to do**:
  - **步骤 A - 验证/修复 git PATH**:
    - 检查 git 是否在 PATH：`where git` 或 `git --version`
    - **Windows 现状**: git 在 `C:\Program Files\Git\bin\git.exe` 但不在 PATH
    - **修复方案 A1 (推荐)**: 将 `C:\Program Files\Git\bin` 加入用户 PATH (PowerShell):
      ```powershell
      [Environment]::SetEnvironmentVariable("Path", $env:Path + ";C:\Program Files\Git\bin", "User")
      $env:Path = [System.Environment]::GetEnvironmentVariable("Path","User")
      ```
    - **修复方案 A2**: 在所有 git 命令中使用完整路径 `C:\Program Files\Git\bin\git.exe`
  - **步骤 B - 更新 .gitignore (关键修复)**:
    - **当前问题**: `.gitignore` 第 70 行 `.omo/` 整目录被忽略，导致 `.omo/plans/phase1-foundation.md` (本计划) 无法提交
    - **修复方案**: 将 `.omo/` 改为细粒度规则:
      ```gitignore
      # OpenCode working files (override the blanket .omo/ rule)
      .omo/drafts/
      .omo/notepads/
      .omo/run-continuation/
      .omo/evidence/**/*.tmp
      .omo/evidence/**/*.log
      # DO track (explicit un-ignore):
      !.omo/plans/
      !.omo/evidence/
      ```
  - **步骤 C - 处理 5 个 uncommitted deletions** (ARCHITECTURE_AUDIT.md, REFACTORING_BLUEPRINT.md, REFACTORING_BLUEPRINT_PART1.md, REFACTORING_BLUEPRINT_PART2.md, REFACTORING_BLUEPRINT_PART3.md):
    - 这些是 PHASE 1 计划取代的旧文档，删除是预期行为
    - 执行：`git rm ARCHITECTURE_AUDIT.md REFACTORING_BLUEPRINT.md REFACTORING_BLUEPRINT_PART1.md REFACTORING_BLUEPRINT_PART2.md REFACTORING_BLUEPRINT_PART3.md`
    - 单独 commit: `chore(docs): remove superseded architecture audit and refactoring blueprint`
  - **步骤 D - 提交 3 个 untracked 文档** (PHASE1.md, PHASE2.md, PHASE3.md):
    - 这些是项目现有的阶段文档（项目根目录），需跟踪
    - `git add PHASE1.md PHASE2.md PHASE3.md`
    - 单独 commit: `docs: add PHASE 1/2/3 refactoring plans`
  - **步骤 E - 创建 phase1-foundation 分支**:
    - `git checkout -b phase1-foundation` （基于当前 master）
  - **步骤 F - Baseline commit + tag**:
    - `git add .gitignore`
    - `git commit -m "chore(git): add fine-grained .omo ignore rules (track plans/ and evidence/)"`
    - `git tag pre-phase1-baseline`
  - **步骤 G - 验证 clean state**:
    - `git status` 应输出 "nothing to commit, working tree clean"

  **Must NOT do**:
  - 不删除 `main/`, `webui/`, `agents/`, `data/` 任何文件
  - 不修改 PHASE1.md, PHASE2.md, PHASE3.md 内容（仅首次 add+commit）
  - 不强制 push (用户可后续 push)
  - 不重写 git 历史
  - 不修改 .git/ 内部文件

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: `["git-master"]`
  - **Reason**: 7 步标准 git 流程, 需谨慎操作避免破坏现有 repo

  **Parallelization**:
  - **Can Run In Parallel**: NO (阻塞所有其他 Wave)
  - **Parallel Group**: Wave 0 (Sequential pre-flight)
  - **Blocks**: 所有 Wave 1-5 + Final
  - **Blocked By**: None (必须是第一个任务)

  **References**:
  - `D:\github_place\fin-agent\.git` - 现有 .git 目录
  - `D:\github_place\fin-agent\.gitignore` - 现有 .gitignore (第 70 行 `.omo/` 需改为细粒度)
  - `C:\Program Files\Git\bin\git.exe` - Windows git 完整路径

  **Acceptance Criteria**:
  - [ ] `git --version` 输出成功（PATH 修复后）
  - [ ] `git branch --show-current` 输出 "phase1-foundation"
  - [ ] `git tag --list | grep pre-phase1-baseline` 输出 "pre-phase1-baseline"
  - [ ] `git status` 输出 "nothing to commit, working tree clean"
  - [ ] `cat .gitignore` 包含 `.omo/drafts/` 和 `!.omo/plans/` (un-ignore 标记)
  - [ ] `git check-ignore -v .omo/plans/phase1-foundation.md` 输出 "::" (表示 NOT ignored)
  - [ ] `git log --oneline -5` 显示 baseline 系列 commits

  **QA Scenarios (MANDATORY)**:
  ```
  Scenario: Git 在 PATH 中工作
    Tool: Bash (git)
    Steps:
      1. git --version
      2. 断言输出 = "git version 2.47.0.windows.1" (或更新)
    Expected Result: 包含 "git version"
    Failure Indicators: "无法找到" 或 "not recognized"
    Evidence: .omo/evidence/task-0-git-version.txt

  Scenario: 分支创建成功
    Tool: Bash (git)
    Steps:
      1. git branch --show-current
      2. 断言输出 = "phase1-foundation"
    Expected Result: "phase1-foundation"
    Evidence: .omo/evidence/task-0-branch.txt

  Scenario: Baseline tag 创建成功
    Tool: Bash (git)
    Steps:
      1. git tag --list
      2. 断言包含 "pre-phase1-baseline"
    Expected Result: 输出包含 "pre-phase1-baseline"
    Evidence: .omo/evidence/task-0-tag.txt

  Scenario: plans/ 不再被忽略
    Tool: Bash (git)
    Steps:
      1. git check-ignore -v .omo/plans/phase1-foundation.md
      2. 断言输出以 "::" 开头（表示 NOT ignored）
    Expected Result: ":: .omo/plans/phase1-foundation.md" (NOT ignored)
    Failure Indicators: ".gitignore:XX:.omo/" (still ignored)
    Evidence: .omo/evidence/task-0-plans-tracked.txt

  Scenario (Negative): Working tree 不干净时报错
    Tool: Bash (git)
    Preconditions: 故意修改文件不提交
    Steps:
      1. echo "test" > D:\github_place\fin-agent\test_uncommitted.txt
      2. git status --porcelain
      3. 验证有输出 (不是空的)
      4. rm D:\github_place\fin-agent\test_uncommitted.txt
    Expected Result: git status 显示未跟踪文件
    Evidence: .omo/evidence/task-0-dirty-tree.txt
  ```

  **Commit**: YES
  - Message: `chore(git): phase1-foundation pre-flight baseline (PATH + .gitignore + branch + tag)`
  - Files: `.gitignore`
  - Pre-commit: `git status` clean

---

### Wave 1: Foundation (并行, 7个任务)

- [x] 1. **pyproject.toml + pytest + ruff 配置**

  **What to do**:
  - 创建 `pyproject.toml`，包含：
    - `[project]` section: name="fin-agent", version="0.1.0", requires-python=">=3.11"
    - `[tool.pytest.ini_options]`: testpaths=["tests"], asyncio_mode="auto"
    - `[tool.ruff]`: line-length=120, max-lines=500
    - `[tool.ruff.lint]`: select=["E","W","F","C","I","N","UP"]
    - `[tool.ruff.lint.mccabe]`: max-complexity=10
  - 锁定核心依赖版本（从 `requirements.txt` 读取）

  **Must NOT do**:
  - 不修改 `requirements.txt`（保持向后兼容）
  - 不添加新依赖

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: `[]`
  - **Skills Evaluated but Omitted**: type-check (TDD 阶段不需要)
  - **Reason**: 配置文件生成，单文件单次写入

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1
  - **Blocks**: Wave 2 (conftest需要pytest配置), Wave 3 (ruff检查代码质量)
  - **Blocked By**: None

  **References**:
  - `requirements.txt` - 当前依赖列表
  - `main/framework/config.py:21-35` - 项目设置结构参考
  - PHASE1.md §2.4.2 (line 393-409) - ruff 完整配置示例

  **Acceptance Criteria**:
  - [ ] `python -c "import tomllib; tomllib.load(open('pyproject.toml','rb'))"` exit 0
  - [ ] `ruff check main/ --config pyproject.toml` exit 0 (现有代码不报错)
  - [ ] `pytest --collect-only tests/` exit 0 (即使tests/为空)

  **QA Scenarios (MANDATORY)**:
  ```
  Scenario: pyproject.toml 语法正确
    Tool: Bash (python)
    Steps:
      1. python -c "import tomllib; tomllib.load(open('pyproject.toml','rb'))"
      2. assert exit code == 0
    Expected Result: 无输出，exit 0
    Failure Indicators: tomllib.TOMLDecodeError
    Evidence: .omo/evidence/task-1-pyproject-valid.txt

  Scenario: ruff 不会对现有代码报错
    Tool: Bash (ruff)
    Steps:
      1. ruff check main/ --config pyproject.toml
      2. 记录输出
    Expected Result: "All checks passed!"
    Failure Indicators: 任何 F/E 级别错误
    Evidence: .omo/evidence/task-1-ruff-clean.txt
  ```

  **Commit**: YES
  - Message: `chore(infra): add pyproject.toml with pytest + ruff config`
  - Files: `pyproject.toml`
  - Pre-commit: `ruff check main/`

- [x] 2. **.pre-commit-config.yaml 配置**

  **What to do**:
  - 创建 `.pre-commit-config.yaml`，包含 4 个 hook（仅引用 Task 1/3 已创建的工具）：
    - `check-file-lines` (引用 scripts/check_lines.py from Task 3)
    - `ruff-check` (引用 Task 1 的 ruff)
    - `eslint-check` (引用 Task 6 的 eslint)
    - `dependency-check` (引用 scripts/check_dependencies.py from Task 3)
  - 全部使用 `language: system` + `entry:` 本地命令
  - 设置 `default_install_hook_types: [pre-commit]`

  **Must NOT do**:
  - 不安装 pre-commit 框架本身（用户自行 `pre-commit install`）
  - 不在 hook 中执行测试

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: `[]`
  - **Reason**: 纯配置文件，无业务逻辑

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1
  - **Blocks**: 无（pre-commit 独立运行）
  - **Blocked By**: None (引用 Task 3 的脚本路径，Task 3 完成后才生效)

  **References**:
  - PHASE1.md §2.4.3 (line 411-441) - pre-commit 完整配置
  - scripts/check_lines.py (Task 3 产物)
  - scripts/check_dependencies.py (Task 3 产物)

  **Acceptance Criteria**:
  - [ ] `.pre-commit-config.yaml` 存在
  - [ ] `python -c "import yaml; yaml.safe_load(open('.pre-commit-config.yaml'))"` exit 0
  - [ ] 文件包含 4 个 hooks

  **QA Scenarios (MANDATORY)**:
  ```
  Scenario: pre-commit 配置语法正确
    Tool: Bash (python yaml)
    Steps:
      1. python -c "import yaml; cfg=yaml.safe_load(open('.pre-commit-config.yaml')); assert len(cfg['repos'][0]['hooks'])==4"
      2. assert exit code == 0
    Expected Result: exit 0
    Evidence: .omo/evidence/task-2-precommit-valid.txt
  ```

  **Commit**: YES
  - Message: `chore(infra): add .pre-commit-config.yaml`
  - Files: `.pre-commit-config.yaml`

- [x] 3. **scripts/check_lines.py + scripts/check_dependencies.py**

  **What to do**:
  - 创建 `scripts/` 目录
  - 创建 `scripts/check_lines.py`：
    - 遍历 `main/` 和 `webui/src/` 下所有 `.py`/`.ts`/`.tsx` 文件
    - 排除 `node_modules`, `dist`, `.git`, `__pycache__`, `venv`, `data/`, `.opencode/node_modules`
    - 文件 > 500 行时打印 `❌ {path}: {lines} 行 (超过 500 行限制)` 并返回 1
    - 全部通过返回 0
  - 创建 `scripts/check_dependencies.py`：
    - 静态 AST 扫描
    - 规则1: `main/framework/api/` 不得 `import` 包含 `SessionLocal` 的模块
    - 规则2: `main/framework/core/` 不得 `import` 包含 `SessionLocal` 的模块（除 database.py）
    - 规则3: 不得跨模块访问私有成员（`from main.x import _y`）
    - 违规时打印详情并返回 1

  **Must NOT do**:
  - 不修改现有代码
  - 不执行实际测试

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: `[]`
  - **Reason**: 工具脚本，单次开发

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1
  - **Blocks**: Task 2 (pre-commit 引用)
  - **Blocked By**: None

  **References**:
  - PHASE1.md §2.4.4 (line 443-474) - check_lines.py 完整示例
  - PHASE1.md §2.4.5 (line 476-537) - check_dependencies.py 完整示例
  - `main/framework/api/` 和 `main/framework/core/` 当前文件列表

  **Acceptance Criteria**:
  - [ ] `python scripts/check_lines.py` exit 0 (当前代码应在限制内)
  - [ ] `python scripts/check_dependencies.py` exit 0
  - [ ] 测试：故意创建 `test_overflow.py` 含 501 行 → check_lines.py 退出码 1

  **QA Scenarios (MANDATORY)**:
  ```
  Scenario: 行数检查器能识别超长文件
    Tool: Bash (python)
    Preconditions: 无
    Steps:
      1. 创建 /tmp/test_overflow.py 含 501 行（echo 'x' 循环 501 次）
      2. cp /tmp/test_overflow.py main/framework/test_overflow.py
      3. python scripts/check_lines.py
      4. 记录 exit code（期望 1）
      5. rm main/framework/test_overflow.py
    Expected Result: exit code = 1, 输出包含 "test_overflow.py: 501 行"
    Evidence: .omo/evidence/task-3-line-check-fail.txt

  Scenario: 分层检测器能识别违规
    Tool: Bash (python)
    Preconditions: 无
    Steps:
      1. 创建 main/framework/api/_test_violation.py 含 `from main.framework.models.database import SessionLocal`
      2. python scripts/check_dependencies.py
      3. 记录 exit code（期望 1）
      4. rm main/framework/api/_test_violation.py
    Expected Result: exit code = 1, 输出包含 "_test_violation.py" + "SessionLocal"
    Evidence: .omo/evidence/task-3-dep-check-fail.txt
  ```

  **Commit**: YES
  - Message: `chore(infra): add line/dependency check scripts`
  - Files: `scripts/check_lines.py`, `scripts/check_dependencies.py`

- [x] 4. **SQLite WAL 模式在 database.py 落地**

  **What to do**:
  - 修改 `main/framework/models/database.py`：
    - 添加 `@event.listens_for(engine, "connect")` 装饰器
    - 在 connect 事件中执行：`PRAGMA journal_mode=WAL`, `PRAGMA busy_timeout=5000`, `PRAGMA synchronous=NORMAL`
  - 同时为 `data_maintenance/models/maintenance_db.py` 添加相同处理
  - 不修改 `SessionLocal` 或 `get_db` 函数签名

  **Must NOT do**:
  - 不迁移到 `config/database.py`（属 Task 12）
  - 不改 DATABASE_URL 默认值

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: `[]`
  - **Reason**: 单文件修改, 5-10 行变更

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1
  - **Blocks**: Wave 2 (集成测试需要WAL)
  - **Blocked By**: None

  **References**:
  - PHASE1.md §1.3 (line 219-233) - WAL 模式完整实现
  - `main/framework/models/database.py` (当前 24 行)
  - `main/data_maintenance/models/maintenance_db.py:1-65` (需添加相同处理)

  **Acceptance Criteria**:
  - [ ] `python -c "from main.framework.models.database import engine; conn=engine.connect(); print(conn.execute(__import__('sqlalchemy').text('PRAGMA journal_mode')).scalar())"` 输出 "wal"
  - [ ] `python -c "from main.framework.models.database import engine; conn=engine.connect(); print(conn.execute(__import__('sqlalchemy').text('PRAGMA busy_timeout')).scalar())"` 输出 ≥5000
  - [ ] 不影响现有 app 启动（手动验证 start.bat）

  **QA Scenarios (MANDATORY)**:
  ```
  Scenario: WAL 模式运行时生效
    Tool: Bash (python -c)
    Preconditions: 无
    Steps:
      1. python -c "from main.framework.models.database import engine,SessionLocal; from sqlalchemy import text; s=SessionLocal(); print(s.execute(text('PRAGMA journal_mode')).scalar()); s.close()"
      2. 断言输出 == "wal"
    Expected Result: stdout = "wal"
    Failure Indicators: stdout = "delete" 或其他
    Evidence: .omo/evidence/task-4-wal-mode.txt

  Scenario: busy_timeout 设置生效
    Tool: Bash (python -c)
    Steps:
      1. python -c "from main.framework.models.database import engine,SessionLocal; from sqlalchemy import text; s=SessionLocal(); print(s.execute(text('PRAGMA busy_timeout')).scalar()); s.close()"
      2. 断言输出 >= 5000
    Expected Result: stdout ≥ 5000
    Evidence: .omo/evidence/task-4-busy-timeout.txt

  Scenario: maintenance 数据库同样启用 WAL
    Tool: Bash (python -c)
    Steps:
      1. python -c "from main.data_maintenance.models.maintenance_db import engine,SessionLocal; from sqlalchemy import text; s=SessionLocal(); print(s.execute(text('PRAGMA journal_mode')).scalar()); s.close()"
      2. 断言输出 == "wal"
    Expected Result: stdout = "wal"
    Evidence: .omo/evidence/task-4-wal-maintenance.txt
  ```

  **Commit**: YES
  - Message: `perf(db): enable SQLite WAL mode + busy_timeout`
  - Files: `main/framework/models/database.py`, `main/data_maintenance/models/maintenance_db.py`
  - Pre-commit: `python scripts/check_lines.py`

- [x] 5. **tests/conftest.py + 隔离测试 DB fixture**

  **What to do**:
  - 创建 `tests/conftest.py`，包含：
    - `pytest` fixtures:
      - `test_engine` (scope="session") - 内存 SQLite 引擎，启用 WAL
      - `test_session_factory` (scope="session") - sessionmaker 绑定 test_engine
      - `db_session` (scope="function") - 每次重置 schema 并 yield Session
      - `client` (scope="function") - httpx AsyncClient + FastAPI app with overridden get_db
    - 覆盖 `main.framework.models.database.get_db` 使用 test session
    - 覆盖 `main.framework.core.container.Container._instances` 使用 test config
  - 创建 `tests/__init__.py` 和 `tests/integration/__init__.py`、`tests/unit/__init__.py` 空文件

  **Must NOT do**:
  - 不写实际测试（属 Wave 2）
  - 不修改 conftest.py 之外的测试文件

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: `[]`
  - **Reason**: pytest fixture 设计需要理解 FastAPI 依赖注入, 多层覆盖

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1
  - **Blocks**: Wave 2 (集成测试依赖 fixtures)
  - **Blocked By**: None (fixtures 是新建文件)

  **References**:
  - PHASE1.md §1.1-1.2 (line 60-210) - 测试目录结构和示例
  - `main/framework/main.py` - FastAPI app 实例位置
  - `main/framework/models/database.py:15-20` - get_db 函数定义

  **Acceptance Criteria**:
  - [ ] `pytest --collect-only tests/` 输出显示 fixtures
  - [ ] 测试 demo：`def test_demo(db_session): assert db_session is not None` 通过
  - [ ] 测试 demo：`def test_demo_client(client): r=await client.get("/"); assert r.status_code in [200,404]` 通过

  **QA Scenarios (MANDATORY)**:
  ```
  Scenario: pytest 能发现 fixtures
    Tool: Bash (pytest)
    Steps:
      1. pytest --collect-only tests/ 2>&1 | head -20
      2. 确认无错误
    Expected Result: "no tests ran" 或 "X items collected"（无错误）
    Evidence: .omo/evidence/task-5-pytest-collect.txt

  Scenario: db_session fixture 工作
    Tool: Bash (pytest)
    Steps:
      1. 创建 /tmp/test_conftest_demo.py:
         from main.framework.models.database import Base
         def test_db_session_works(db_session):
             assert db_session is not None
             assert db_session.bind is not None
      2. cp 到 tests/integration/_demo.py
      3. pytest tests/integration/_demo.py -v
      4. 记录结果
      5. rm tests/integration/_demo.py
    Expected Result: "1 passed"
    Evidence: .omo/evidence/task-5-db-session.txt

  Scenario: test DB 与真实 DB 隔离
    Tool: Bash (sqlite3)
    Steps:
      1. 备份 data/finagent.db size: cp data/finagent.db /tmp/finagent_before.db
      2. 运行 db_session fixture 创建表 + insert
      3. 对比 data/finagent.db 与 /tmp/finagent_before.db 大小（应一致）
      4. diff /tmp/finagent_before.db data/finagent.db
    Expected Result: 两文件相同，diff 无输出
    Evidence: .omo/evidence/task-5-db-isolated.txt
  ```

  **Commit**: YES
  - Message: `test(infrastructure): add conftest.py with isolated test DB`
  - Files: `tests/conftest.py`, `tests/__init__.py`, `tests/integration/__init__.py`, `tests/unit/__init__.py`
  - Pre-commit: `pytest --collect-only tests/`

- [x] 6. **webui/.eslintrc.json 配置**

  **What to do**:
  - 创建 `webui/.eslintrc.json`，包含：
    - `rules.max-lines`: error 500 (per file)
    - `rules.max-lines-per-function`: error 50
    - `rules.no-magic-numbers`: warn (ignore [0,1,-1,200,404,500])
    - `rules.no-restricted-imports`: error 禁止 axios
    - `rules.no-restricted-syntax`: error 禁止 CallExpression[callee.name='fetch']
  - 确保 webui 已安装 ESLint（检查 webui/node_modules，若无则用 `npm install --save-dev eslint`）

  **Must NOT do**:
  - 不修复 ESLint 错误（仅创建配置）
  - 不修改 webui/ 业务代码
  - 不添加新依赖到 webui/package.json（除 eslint）

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: `[]`
  - **Reason**: 配置文件创建

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1
  - **Blocks**: 无
  - **Blocked By**: None

  **References**:
  - PHASE1.md §2.4.1 (line 372-391) - ESLint 完整配置
  - `webui/package.json` - 当前依赖
  - `webui/src/pages/WorkflowEditor.tsx` - 已知超大文件 (1563 行，预期 ESLint 错误)

  **Acceptance Criteria**:
  - [ ] `webui/.eslintrc.json` 存在且为合法 JSON
  - [ ] `cd webui && npx eslint --print-config src/App.tsx` 输出包含 max-lines 规则
  - [ ] 不影响 webui 启动 (`npm run build` 不强制要求)

  **QA Scenarios (MANDATORY)**:
  ```
  Scenario: ESLint 配置 JSON 合法
    Tool: Bash (python json)
    Steps:
      1. python -c "import json; cfg=json.load(open('webui/.eslintrc.json')); assert 'max-lines' in cfg['rules']"
      2. assert exit code == 0
    Expected Result: exit 0
    Evidence: .omo/evidence/task-6-eslintrc-valid.txt

  Scenario: ESLint 能读取配置
    Tool: Bash (npx eslint)
    Steps:
      1. cd webui && npx eslint --print-config src/App.tsx | python -c "import json,sys; cfg=json.load(sys.stdin); assert cfg['rules']['max-lines'][0]=='error'"
      2. assert exit code == 0
    Expected Result: exit 0
    Evidence: .omo/evidence/task-6-eslint-readable.txt
  ```

  **Commit**: YES
  - Message: `chore(webui): add ESLint config with size restrictions`
  - Files: `webui/.eslintrc.json` (and webui/package.json if eslint added)

- [x] 7. **BaseRepository[T] 泛型基类**

  **What to do**:
  - 创建 `main/framework/repositories/base.py`，实现：
    - `class BaseRepository(Generic[T])`:
      - `__init__(self, model: Type[T], db: Session)` - 接收 db，不创建
      - `get(self, id: str) -> Optional[T]`
      - `list(self, **filters) -> List[T]`
      - `create(self, **kwargs) -> T` - 不 commit（调用方控制）
      - `update(self, id: str, **kwargs) -> Optional[T]` - 不 commit
      - `delete(self, id: str) -> bool` - 不 commit
    - 接收 `db: Session` 而非 `session_factory`（关键决策）
    - 文档字符串说明事务归属
  - 不修改现有 `execution_repo.py`（属 Task 17）

  **Must NOT do**:
  - 不引入新的 ORM 模型
  - 不实现具体 Repository（属 Task 13-16）
  - 不在 BaseRepository 内部 commit

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: `[]`
  - **Reason**: 泛型设计需理解 SQLAlchemy 事务模型 + 现有 execution_repo 模式

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1
  - **Blocks**: Wave 3 (具体 Repository 依赖基类)
  - **Blocked By**: None (独立新文件)

  **References**:
  - PHASE1.md §2.3 (line 348-359) - BaseRepository 简化示例
  - PHASE1.md §1.6 (line 287-313) - UnitOfWork 上下文
  - `main/framework/repositories/execution_repo.py` - 现有模式参考（但内部 SessionLocal 模式需改进）

  **Acceptance Criteria**:
  - [ ] `python -c "from main.framework.repositories.base import BaseRepository; from main.framework.models.agent import Agent; br=BaseRepository(Agent, None); assert br is not None"` exit 0
  - [ ] 文件 < 100 行
  - [ ] ruff 通过

  **QA Scenarios (MANDATORY)**:
  ```
  Scenario: BaseRepository 可实例化
    Tool: Bash (python -c)
    Steps:
      1. python -c "from main.framework.repositories.base import BaseRepository; from main.framework.models.agent import Agent; br=BaseRepository(Agent, None); print(type(br).__name__)"
      2. 断言输出 == "BaseRepository"
    Expected Result: "BaseRepository"
    Evidence: .omo/evidence/task-7-base-instantiable.txt

  Scenario: BaseRepository 在内存 DB 上工作
    Tool: Bash (pytest)
    Steps:
      1. 创建 tests/unit/_test_base.py:
         from main.framework.repositories.base import BaseRepository
         from main.framework.models.agent import Agent
         from main.framework.models.database import Base
         def test_base_create_get(db_session):
             Base.metadata.create_all(db_session.bind)
             repo = BaseRepository(Agent, db_session)
             agent = repo.create(id='a1', name='test')
             db_session.commit()
             found = repo.get('a1')
             assert found.name == 'test'
      2. pytest tests/unit/_test_base.py -v
      3. 清理
    Expected Result: "1 passed"
    Evidence: .omo/evidence/task-7-base-works.txt
  ```

  **Commit**: YES
  - Message: `feat(data): add BaseRepository[T] generic class`
  - Files: `main/framework/repositories/base.py`
  - Pre-commit: `python scripts/check_lines.py`

### Wave 2: Safety Net (并行, 4个任务 - 在当前代码上写集成测试)

- [ ] 8. **集成测试: conversation flow**

  **What to do**:
  - 创建 `tests/integration/test_conversation_flow.py`
  - 至少 3 个测试用例（PHASE1.md §1.1 要求）:
    - `test_create_conversation`: POST /api/v1/conversations/ → 200, 返回 id
    - `test_send_agent_message`: 创建对话 → POST /messages (mode=agent) → 轮询 GET /messages 最多 60 秒 → 验证 assistant 回复
    - `test_list_messages`: 创建对话 → 发送消息 → 验证消息列表
  - 使用 `tests/conftest.py` 的 `client` 和 `db_session` fixtures
  - 标记 `@pytest.mark.asyncio`

  **Must NOT do**:
  - 不 mock OpenCode 后端（保持真实路径）
  - 不修改 conftest.py

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: `[]`
  - **Reason**: 异步 API 测试需理解 httpx AsyncClient + FastAPI 轮询

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2
  - **Blocks**: Wave 4 (迁移 conversation.py 时作为回归测试)
  - **Blocked By**: Task 5 (conftest.py)

  **References**:
  - PHASE1.md §1.1 (line 74-115) - 完整测试代码示例
  - `main/framework/api/conversations.py:364-609` - API 端点定义
  - `tests/conftest.py` - 共享 fixtures

  **Acceptance Criteria**:
  - [ ] `pytest tests/integration/test_conversation_flow.py -v` 3 passed
  - [ ] 全部测试在 60 秒内完成
  - [ ] 不修改生产代码

  **QA Scenarios (MANDATORY)**:
  ```
  Scenario: 创建对话端点工作
    Tool: Bash (pytest)
    Steps:
      1. pytest tests/integration/test_conversation_flow.py::test_create_conversation -v
      2. 记录输出
    Expected Result: "1 passed"
    Failure Indicators: 500 错误, timeout
    Evidence: .omo/evidence/task-8-create-conv.txt

  Scenario: 完整流程（创建+消息+回复）
    Tool: Bash (pytest)
    Steps:
      1. pytest tests/integration/test_conversation_flow.py -v --tb=short
      2. 断言所有 3 测试通过
    Expected Result: "3 passed"
    Evidence: .omo/evidence/task-8-conv-all.txt
  ```

  **Commit**: YES
  - Message: `test(integration): add conversation flow safety net`
  - Files: `tests/integration/test_conversation_flow.py`
  - Pre-commit: `pytest tests/integration/test_conversation_flow.py`

- [ ] 9. **集成测试: workflow flow**

  **What to do**:
  - 创建 `tests/integration/test_workflow_flow.py`
  - 至少 3 个测试用例:
    - `test_create_and_execute_workflow`: POST /api/v1/workflows/ → 200, 触发执行 → 轮询 GET /executions/{id} → 验证 completed
    - `test_list_workflows`: 创建后 → GET /workflows/ 验证存在
    - `test_workflow_with_parallel_nodes`: 创建含并行节点的工作流 → 触发 → 验证多个节点完成
  - 使用 conftest fixtures

  **Must NOT do**:
  - 不修改 workflow_engine.py
  - 不跳过任何测试（即使慢）

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: `[]`
  - **Reason**: 工作流测试需理解 DAG 拓扑和并行执行

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2
  - **Blocks**: Wave 4 (workflow_engine.py 迁移时作为回归测试)
  - **Blocked By**: Task 5

  **References**:
  - PHASE1.md §1.1 (line 116-145) - workflow 测试示例
  - `main/framework/api/workflows.py` - 工作流端点
  - `main/framework/api/executions.py` - 执行查询端点

  **Acceptance Criteria**:
  - [ ] `pytest tests/integration/test_workflow_flow.py -v` 3 passed
  - [ ] 工作流创建到执行完成 < 120 秒

  **QA Scenarios (MANDATORY)**:
  ```
  Scenario: 工作流创建+执行完成
    Tool: Bash (pytest)
    Steps:
      1. pytest tests/integration/test_workflow_flow.py -v --tb=short
      2. 断言 3 passed
    Expected Result: "3 passed"
    Evidence: .omo/evidence/task-9-workflow-all.txt
  ```

  **Commit**: YES
  - Message: `test(integration): add workflow flow safety net`
  - Files: `tests/integration/test_workflow_flow.py`

- [ ] 10. **集成测试: scheduled workflow**

  **What to do**:
  - 创建 `tests/integration/test_scheduled_workflow.py`
  - 至少 2 个测试用例:
    - `test_schedule_workflow`: 创建工作流 → POST /workflows/{id}/schedule (cron="0 9 * * 1-5") → GET /workflows/scheduled 验证存在
    - `test_manual_trigger_scheduled`: 调度工作流 → POST /workflows/{id}/trigger 手动触发 → 验证执行开始
  - 不等待实际 cron 触发（用 manual_trigger 验证逻辑）

  **Must NOT do**:
  - 不实际等待 cron 时间（避免测试超长）
  - 不修改 APScheduler 配置

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: `[]`
  - **Reason**: 调度测试需理解 APScheduler 和 mock 时间

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2
  - **Blocks**: Wave 4 (scheduler.py 迁移时回归)
  - **Blocked By**: Task 5

  **References**:
  - PHASE1.md §1.1 (line 147-163) - scheduled 测试示例
  - `main/framework/api/scheduler_routes.py` - 调度 API
  - `main/framework/core/scheduler.py` - APScheduler 集成

  **Acceptance Criteria**:
  - [ ] `pytest tests/integration/test_scheduled_workflow.py -v` 2 passed
  - [ ] 调度创建到列出 < 5 秒

  **QA Scenarios (MANDATORY)**:
  ```
  Scenario: 定时工作流调度+列出
    Tool: Bash (pytest)
    Steps:
      1. pytest tests/integration/test_scheduled_workflow.py -v --tb=short
      2. 断言 2 passed
    Expected Result: "2 passed"
    Evidence: .omo/evidence/task-10-scheduled-all.txt
  ```

  **Commit**: YES
  - Message: `test(integration): add scheduled workflow safety net`
  - Files: `tests/integration/test_scheduled_workflow.py`

- [ ] 11. **集成测试: dispatch flow**

  **What to do**:
  - 创建 `tests/integration/test_dispatch_flow.py`
  - 至少 2 个测试用例:
    - `test_sync_dispatch`: POST /api/v1/dispatch/sync (agent="macro-scout", prompt="...") → 200, 验证 response
    - `test_parallel_dispatch`: POST /api/v1/dispatch/parallel (agents=["a","b"], prompt="...") → 200, 验证多结果
  - 使用 conftest client

  **Must NOT do**:
  - 不 mock OpenCode
  - 不修改 dispatch.py

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: `[]`
  - **Reason**: Agent 调度测试需理解同步/并行模式

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2
  - **Blocks**: Wave 4 (dispatch 路径迁移时回归)
  - **Blocked By**: Task 5

  **References**:
  - `main/framework/api/dispatch.py` - dispatch 端点
  - `main/framework/core/agent_dispatcher.py` - 调度器

  **Acceptance Criteria**:
  - [ ] `pytest tests/integration/test_dispatch_flow.py -v` 2 passed
  - [ ] sync dispatch < 30 秒
  - [ ] parallel dispatch < 60 秒

  **QA Scenarios (MANDATORY)**:
  ```
  Scenario: 同步和并行 Agent 调度
    Tool: Bash (pytest)
    Steps:
      1. pytest tests/integration/test_dispatch_flow.py -v --tb=short
      2. 断言 2 passed
    Expected Result: "2 passed"
    Evidence: .omo/evidence/task-11-dispatch-all.txt
  ```

  **Commit**: YES
  - Message: `test(integration): add dispatch flow safety net`
  - Files: `tests/integration/test_dispatch_flow.py`

### Wave 3: Data Layer Build (并行, 8个任务 - 仅新建文件)

- [x] 12. **config/ 目录迁移（settings/constants/database）**

  **What to do**:
  - 创建 `main/framework/config/` 包（`__init__.py`）
  - 创建 `main/framework/config/settings.py`:
    - 从 `main/framework/config.py` 迁移 `Settings` 类和 `_find_opencode_bin`
    - 保持 `Settings` 字段不变
  - 创建 `main/framework/config/constants.py`:
    - 提取业务常量：`MAX_AGENT_RETRIES=3`, `DEFAULT_TIMEOUT=300`, `MAX_NODES_PER_WORKFLOW=20` 等
    - 从散落代码（workflow_engine.py, scheduler.py, etc.）中识别魔法数字
  - 创建 `main/framework/config/database.py`:
    - 从 `main/framework/models/database.py` 迁移 `engine`, `SessionLocal`, `Base`, `get_db`, `init_db`
    - 保持 Task 4 添加的 WAL pragma
  - 添加 deprecation comment 到原 `main/framework/config.py` 指向新位置
  - 添加 compatibility re-export 到原 `main/framework/models/database.py` 指向新位置
  - **不删除**原文件（避免破坏现有导入），通过 re-export 保持向后兼容

  **Must NOT do**:
  - 不删除 `main/framework/config.py` 或 `main/framework/models/database.py`
  - 不修改 Settings 字段名
  - 不改变 DATABASE_URL 默认值

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: `[]`
  - **Reason**: 多文件迁移需识别所有引用并保持兼容

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3
  - **Blocks**: Wave 4 (迁移文件需要新的 settings 路径)
  - **Blocked By**: None (新文件 + re-export)

  **References**:
  - PHASE1.md §2.1 (line 319-325) - config/ 目录结构
  - `main/framework/config.py:1-42` - 现有 Settings
  - `main/framework/models/database.py:1-24` - 现有 database 模块

  **Acceptance Criteria**:
  - [ ] `python -c "from main.framework.config.settings import settings; assert settings.API_PORT==8000"` exit 0
  - [ ] `python -c "from main.framework.config.database import SessionLocal, get_db, Base; assert callable(get_db)"` exit 0
  - [ ] `python -c "from main.framework.config.constants import MAX_AGENT_RETRIES; assert isinstance(MAX_AGENT_RETRIES, int)"` exit 0
  - [ ] 旧路径 `from main.framework.config import Settings` 仍工作（re-export）
  - [ ] 旧路径 `from main.framework.models.database import SessionLocal` 仍工作（re-export）

  **QA Scenarios (MANDATORY)**:
  ```
  Scenario: 新 config 路径可导入
    Tool: Bash (python -c)
    Steps:
      1. python -c "from main.framework.config.settings import settings; from main.framework.config.database import SessionLocal, get_db, Base; from main.framework.config.constants import MAX_AGENT_RETRIES; print('OK')"
      2. 断言输出 = "OK"
    Expected Result: "OK"
    Evidence: .omo/evidence/task-12-new-config.txt

  Scenario: 旧 config 路径仍兼容
    Tool: Bash (python -c)
    Steps:
      1. python -c "from main.framework.config import Settings; from main.framework.models.database import SessionLocal; print('OK')"
      2. 断言输出 = "OK"
    Expected Result: "OK"（验证 re-export 工作）
    Evidence: .omo/evidence/task-12-legacy-compat.txt
  ```

  **Commit**: YES
  - Message: `refactor(config): migrate to config/ package with backward compat`
  - Files: `main/framework/config/__init__.py`, `main/framework/config/settings.py`, `main/framework/config/constants.py`, `main/framework/config/database.py`
  - Pre-commit: `python scripts/check_lines.py && ruff check main/framework/config/`

- [x] 13. **AgentRepository 实现**

  **What to do**:
  - 创建 `main/framework/repositories/agent_repo.py`
  - 实现 `class AgentRepository(BaseRepository[Agent])`:
    - 继承 `BaseRepository`（基类接收 db via constructor）
    - 额外方法：`get_by_name(name: str) -> Optional[Agent]`, `list_by_provider(provider: str) -> List[Agent]`
    - 不内部 commit
  - 创建 `tests/unit/test_agent_repository.py`:
    - 5+ 单元测试: test_create, test_get, test_list, test_update, test_get_by_name, test_list_by_provider
  - 使用内存 SQLite + 重置 schema

  **Must NOT do**:
  - 不创建新 Agent 模型
  - 不修改 models/agent.py

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: `[]`
  - **Reason**: 标准 CRUD + 简单查询方法

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3
  - **Blocks**: Task 18 (Container 注册)
  - **Blocked By**: Task 7 (BaseRepository)

  **References**:
  - `main/framework/models/agent.py` - Agent 模型
  - `main/framework/repositories/base.py` (Task 7 产物) - 继承的基类
  - `main/framework/repositories/execution_repo.py` - 现有 Repository 风格参考

  **Acceptance Criteria**:
  - [ ] `pytest tests/unit/test_agent_repository.py -v` 6+ passed
  - [ ] `python -c "from main.framework.repositories.agent_repo import AgentRepository; print('OK')"` exit 0
  - [ ] AgentRepository 接收 db via constructor

  **QA Scenarios (MANDATORY)**:
  ```
  Scenario: AgentRepository 单元测试通过
    Tool: Bash (pytest)
    Steps:
      1. pytest tests/unit/test_agent_repository.py -v --tb=short
      2. 断言 6+ passed
    Expected Result: "6 passed" 或更多
    Evidence: .omo/evidence/task-13-agent-repo.txt
  ```

  **Commit**: YES
  - Message: `feat(data): add AgentRepository with unit tests`
  - Files: `main/framework/repositories/agent_repo.py`, `tests/unit/test_agent_repository.py`
  - Pre-commit: `python scripts/check_lines.py`

- [x] 14. **WorkflowRepository 实现**

  **What to do**:
  - 创建 `main/framework/repositories/workflow_repo.py`
  - 实现 `class WorkflowRepository(BaseRepository[Workflow])`:
    - 继承 BaseRepository
    - 额外方法：`list_active() -> List[Workflow]`, `get_by_name(name)`, `set_active(workflow_id, active: bool)`
  - 创建 `tests/unit/test_workflow_repository.py` (5+ 测试)

  **Must NOT do**:
  - 不创建新 Workflow 模型
  - 不修改 models/workflow.py

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: `[]`
  - **Reason**: 标准 CRUD + 业务查询

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3
  - **Blocks**: Task 18
  - **Blocked By**: Task 7

  **References**:
  - `main/framework/models/workflow.py` - Workflow 模型
  - `main/framework/repositories/base.py` (Task 7)

  **Acceptance Criteria**:
  - [ ] `pytest tests/unit/test_workflow_repository.py -v` 5+ passed

  **QA Scenarios (MANDATORY)**:
  ```
  Scenario: WorkflowRepository 单元测试通过
    Tool: Bash (pytest)
    Steps:
      1. pytest tests/unit/test_workflow_repository.py -v --tb=short
    Expected Result: "5 passed" 或更多
    Evidence: .omo/evidence/task-14-workflow-repo.txt
  ```

  **Commit**: YES
  - Message: `feat(data): add WorkflowRepository with unit tests`
  - Files: `main/framework/repositories/workflow_repo.py`, `tests/unit/test_workflow_repository.py`

- [x] 15. **ConversationRepository 实现**

  **What to do**:
  - 创建 `main/framework/repositories/conversation_repo.py`
  - 实现 `class ConversationRepository(BaseRepository[Conversation])`:
    - 额外方法：`add_message(conv_id, role, content) -> Message`, `get_messages(conv_id) -> List[Message]`, `get_recent(limit=20)`, `delete_with_messages(conv_id) -> bool`
  - 包含 Message 模型处理（同一文件或独立类）
  - 创建 `tests/unit/test_conversation_repository.py` (8+ 测试)

  **Must NOT do**:
  - 不创建新 Conversation/Message 模型
  - 不修改 models/conversation.py

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: `[]`
  - **Reason**: 涉及两个关联模型 (Conversation + Message) 的关系操作

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3
  - **Blocks**: Task 18, Wave 4 (conversations.py 迁移)
  - **Blocked By**: Task 7

  **References**:
  - `main/framework/models/conversation.py` - Conversation + Message 模型
  - `main/framework/repositories/base.py` (Task 7)

  **Acceptance Criteria**:
  - [ ] `pytest tests/unit/test_conversation_repository.py -v` 8+ passed
  - [ ] add_message + get_messages 往返一致

  **QA Scenarios (MANDATORY)**:
  ```
  Scenario: ConversationRepository 单元测试
    Tool: Bash (pytest)
    Steps:
      1. pytest tests/unit/test_conversation_repository.py -v --tb=short
    Expected Result: "8 passed" 或更多
    Evidence: .omo/evidence/task-15-conv-repo.txt
  ```

  **Commit**: YES
  - Message: `feat(data): add ConversationRepository with unit tests`
  - Files: `main/framework/repositories/conversation_repo.py`, `tests/unit/test_conversation_repository.py`

- [x] 16. **MaintenanceRepository 实现（独立 DB）**

  **What to do**:
  - 创建 `main/data_maintenance/repositories/maintenance_repo.py`（注意：在 data_maintenance 子系统下）
  - 实现 `class MaintenanceRepository`:
    - **不**继承 `BaseRepository`（因 MaintenanceBase 独立于框架 Base）
    - 接收 db: Session via constructor
    - 方法：`get_setting(key)`, `set_setting(key, value)`, `list_jobs() -> List[MaintenanceJob]`, `update_job_status(id, status, error=None)`
  - 创建 `tests/unit/test_maintenance_repository.py` (4+ 测试)
  - 不修改 `maintenance_db.py` 的 `_SessionLocal`（保持向后兼容）

  **Must NOT do**:
  - 不修改 MaintenanceBase 模型
  - 不统一两个数据库的 Session（PHASE 1 保留双 DB 架构）
  - 不在 MaintenanceRepository 内部 commit

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: `[]`
  - **Reason**: 类似其他 Repository，但独立 DB 路径

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3
  - **Blocks**: Wave 4 (maintenance_db.py 迁移)
  - **Blocked By**: None (独立子系统)

  **References**:
  - `main/data_maintenance/models/maintenance_db.py` - MaintenanceBase + 现有模型
  - PHASE1.md §3.1 maintenance_repo 规范

  **Acceptance Criteria**:
  - [ ] `pytest tests/unit/test_maintenance_repository.py -v` 4+ passed
  - [ ] 独立 DB 验证: 测试 DB 与框架 DB 分离

  **QA Scenarios (MANDATORY)**:
  ```
  Scenario: MaintenanceRepository 单元测试
    Tool: Bash (pytest)
    Steps:
      1. pytest tests/unit/test_maintenance_repository.py -v --tb=short
    Expected Result: "4 passed" 或更多
    Evidence: .omo/evidence/task-16-maint-repo.txt
  ```

  **Commit**: YES
  - Message: `feat(data): add MaintenanceRepository for data_maintenance subsystem`
  - Files: `main/data_maintenance/repositories/__init__.py`, `main/data_maintenance/repositories/maintenance_repo.py`, `tests/unit/test_maintenance_repository.py`

- [x] 17. **重构 execution_repo.py 继承 BaseRepository[T]（向后兼容）**

  **What to do**:
  - 修改 `main/framework/repositories/execution_repo.py`:
    - `ExecutionRepository` 改为继承 `BaseRepository` (或组合)
    - **关键**：保留 11 个现有方法签名不变（向后兼容）
    - **关键**：保留 `__init__(self, session_factory=SessionLocal)` 双模式：
      - 默认模式（无参）= 旧行为（内部 SessionLocal）
      - 注入模式（传 db 或 session_factory）= 新行为
    - 内部 `with self._sf() as db:` 模式保留（避免破坏现有调用方）
  - 添加新方法：`create_execution_v2(db: Session, **kwargs)` 接收外部 db
  - 不修改 `executions.py`（属 Wave 4 Task 25）

  **Must NOT do**:
  - 不删除现有 11 个方法
  - 不改变现有方法签名
  - 不在 Wave 3 修改 `executions.py`

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: `[]`
  - **Reason**: 兼容性重构，需保留两套 API 同时工作

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3
  - **Blocks**: Wave 4 (Task 25, 26, 27, 28, 29)
  - **Blocked By**: Task 7 (BaseRepository)

  **References**:
  - `main/framework/repositories/execution_repo.py:1-197` - 当前实现
  - `main/framework/repositories/base.py` (Task 7 产物)
  - `main/framework/api/executions.py:21` - 模块级 `repo = ExecutionRepository()` 调用

  **Acceptance Criteria**:
  - [ ] `pytest tests/integration/` 全部 10-15 测试仍通过（无 regression）
  - [ ] 现有 11 个方法签名未变（lsp_find_references 验证）
  - [ ] 新方法 `create_execution_v2(db, ...)` 可独立单元测试
  - [ ] 文件 < 250 行

  **QA Scenarios (MANDATORY)**:
  ```
  Scenario: 现有集成测试无 regression
    Tool: Bash (pytest)
    Steps:
      1. pytest tests/integration/ -v --tb=short
      2. 断言 10-15 passed（与重构前一致）
    Expected Result: "10-15 passed"
    Failure Indicators: 任何 FAIL 或 ERROR
    Evidence: .omo/evidence/task-17-no-regression.txt

  Scenario: 新 v2 方法可用
    Tool: Bash (python -c)
    Steps:
      1. python -c "from main.framework.repositories.execution_repo import ExecutionRepository; assert hasattr(ExecutionRepository, 'create_execution_v2')"
    Expected Result: exit 0
    Evidence: .omo/evidence/task-17-v2-method.txt
  ```

  **Commit**: YES
  - Message: `refactor(data): make ExecutionRepository backward-compatible with BaseRepository`
  - Files: `main/framework/repositories/execution_repo.py`
  - Pre-commit: `pytest tests/integration/`

- [x] 18. **Container 注册所有 5 个 Repository**

  **What to do**:
  - 修改 `main/framework/core/container.py`:
    - 保留现有 `execution_repo` property（向后兼容）
    - 添加 `register_singleton(cls, instance)` 通用方法
    - 添加 `register_factory(cls, factory)` 通用方法
    - 添加新 properties: `agent_repo`, `workflow_repo`, `conversation_repo`, `maintenance_repo`
    - 所有 new repos 接受可选 `db: Session` 参数（None 时用 SessionLocal）
  - **不**修改现有 backend / dispatcher / scheduler properties
  - 添加 `get_service(interface)` 函数（如 PHASE1.md §2.2 示例）作为 FastAPI Depends 工厂

  **Must NOT do**:
  - 不删除 `execution_repo` property
  - 不修改 backend/dispatcher 创建逻辑
  - 不实现自动扫描注册（手动注册 5 个）

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: `[]`
  - **Reason**: DI 容器增强需考虑向后兼容

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3
  - **Blocks**: Wave 4 所有迁移任务
  - **Blocked By**: Task 13, 14, 15, 16, 17 (所有 Repository 必须先存在)

  **References**:
  - PHASE1.md §2.2 (line 327-345) - Container 增强示例
  - `main/framework/core/container.py:1-90` - 现有实现

  **Acceptance Criteria**:
  - [ ] `python -c "from main.framework.core.container import Container, get_service; from main.framework.repositories.agent_repo import AgentRepository; c=Container(...); assert c.agent_repo is not None"` exit 0
  - [ ] `python -c "from main.framework.core.container import get_service; dep=get_service(AgentRepository); assert callable(dep)"` exit 0
  - [ ] 现有 `container.execution_repo` 仍工作

  **QA Scenarios (MANDATORY)**:
  ```
  Scenario: Container 注册 5 个 Repository
    Tool: Bash (python -c)
    Steps:
      1. python -c "
         from main.framework.core.container import Container
         from main.framework.config.settings import settings
         c = Container(settings)
         assert c.execution_repo is not None
         assert c.agent_repo is not None
         assert c.workflow_repo is not None
         assert c.conversation_repo is not None
         assert c.maintenance_repo is not None
         print('OK')
         "
    Expected Result: "OK"
    Evidence: .omo/evidence/task-18-container-registered.txt

  Scenario: get_service 工厂工作
    Tool: Bash (python -c)
    Steps:
      1. python -c "from main.framework.core.container import get_service; from main.framework.repositories.agent_repo import AgentRepository; dep=get_service(AgentRepository); assert callable(dep); print('OK')"
    Expected Result: "OK"
    Evidence: .omo/evidence/task-18-get-service.txt
  ```

  **Commit**: YES
  - Message: `feat(di): register all 5 Repositories in Container`
  - Files: `main/framework/core/container.py`

- [x] 19. **UnitOfWork 模式（跨 Repository 事务）**

  **What to do**:
  - 创建 `main/framework/services/__init__.py`（新包）
  - 创建 `main/framework/services/unit_of_work.py`:
    - 实现 `class UnitOfWork`:
      - `__init__(self, db: Session = None)` - 默认从 SessionLocal 获取
      - `__enter__` / `__exit__` 管理事务
      - `repository(name, model)` 懒加载缓存 repos
    - 遵循 PHASE1.md §1.6 示例
  - 创建 `tests/unit/test_unit_of_work.py` (3+ 测试)
    - test_commit_on_success
    - test_rollback_on_exception
    - test_cross_repo_transaction

  **Must NOT do**:
  - 不在 UnitOfWork 内 commit 单个 repo 操作
  - 不实现具体业务 Service（属 PHASE 2）

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: `[]`
  - **Reason**: 标准 UoW 模式, PHASE1.md 有完整示例

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3
  - **Blocks**: Wave 4 (迁移时 UoW 用于跨 repo 操作)
  - **Blocked By**: None (独立新文件)

  **References**:
  - PHASE1.md §1.6 (line 287-313) - UnitOfWork 完整示例
  - `main/framework/repositories/base.py` (Task 7)

  **Acceptance Criteria**:
  - [ ] `pytest tests/unit/test_unit_of_work.py -v` 3+ passed
  - [ ] 异常时 rollback, 成功时 commit

  **QA Scenarios (MANDATORY)**:
  ```
  Scenario: UnitOfWork 事务管理
    Tool: Bash (pytest)
    Steps:
      1. pytest tests/unit/test_unit_of_work.py -v --tb=short
    Expected Result: "3 passed"
    Evidence: .omo/evidence/task-19-uow.txt
  ```

  **Commit**: YES
  - Message: `feat(data): add UnitOfWork for cross-Repository transactions`
  - Files: `main/framework/services/__init__.py`, `main/framework/services/unit_of_work.py`, `tests/unit/test_unit_of_work.py`

### Wave 4: Migration (顺序执行, 12个任务 - 按耦合度从低到高)

> **关键**: Wave 4 任务**必须按顺序**执行。每个迁移可能暴露跨文件问题。
> 每个任务完成后必须通过 `pytest tests/integration/` 验证无 regression。

- [x] 20. **迁移 agents.py (1 处 SessionLocal)**

  **What to do**:
  - 修改 `main/framework/api/agents.py`:
    - 删除 1 处 `SessionLocal()` 调用
    - 改用 `Depends(get_service(AgentRepository))`
    - 端点函数签名加 `repo: AgentRepository = Depends(get_service(AgentRepository))`
  - 行为完全不变（重构非功能修改）

  **Must NOT do**:
  - 不修改 Agent 模型
  - 不改变 API 响应格式

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: `[]`
  - **Reason**: 1 处调用，最低复杂度

  **Parallelization**:
  - **Can Run In Parallel**: NO (Wave 4 顺序)
  - **Parallel Group**: Wave 4 (Sequential, position 1)
  - **Blocks**: Task 21+ (后续迁移)
  - **Blocked By**: Task 18 (Container 注册 AgentRepository)

  **References**:
  - `main/framework/api/agents.py` - 当前实现
  - `main/framework/repositories/agent_repo.py` (Task 13)
  - `main/framework/core/container.py:get_service` (Task 18)

  **Acceptance Criteria**:
  - [ ] `pytest tests/integration/ -v` 全部通过 (无 regression)
  - [ ] `grep "SessionLocal" main/framework/api/agents.py` 仅在 import (无调用)
  - [ ] Agent 列表/详情端点正常工作

  **QA Scenarios (MANDATORY)**:
  ```
  Scenario: agents.py 迁移后无 regression
    Tool: Bash (pytest)
    Preconditions: Task 8-11 集成测试已通过
    Steps:
      1. pytest tests/integration/ -v --tb=short
      2. 断言 10-15 passed
    Expected Result: 全部通过
    Evidence: .omo/evidence/task-20-agents-no-regress.txt

  Scenario: SessionLocal 已从 agents.py 移除
    Tool: Bash (grep)
    Steps:
      1. grep -n "SessionLocal" main/framework/api/agents.py
      2. 验证无 `SessionLocal()` 调用（仅可能 import）
    Expected Result: 无 `SessionLocal()` 调用
    Evidence: .omo/evidence/task-20-agents-grep.txt
  ```

  **Commit**: YES
  - Message: `refactor(api): migrate agents.py to AgentRepository`
  - Files: `main/framework/api/agents.py`
  - Pre-commit: `pytest tests/integration/`

- [x] 21. **迁移 system.py (1 处 SessionLocal)**

  **What to do**:
  - 修改 `main/framework/api/system.py`:
    - 删除 1 处 `SessionLocal()` (通常是统计查询)
    - 改用合适的 Repository 或保留 `Depends(get_db)`
  - 端点行为不变

  **Must NOT do**:
  - 不修改系统状态字段

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: `[]`

  **Parallelization**:
  - **Can Run In Parallel**: NO (Wave 4 顺序)
  - **Parallel Group**: Wave 4 (position 2)
  - **Blocked By**: Task 20

  **References**:
  - `main/framework/api/system.py` - 当前实现

  **Acceptance Criteria**:
  - [ ] `pytest tests/integration/ -v` 全部通过
  - [ ] `grep "SessionLocal()" main/framework/api/system.py` exit 1 (no match)

  **QA Scenarios (MANDATORY)**:
  ```
  Scenario: system.py 迁移后无 regression
    Tool: Bash (pytest)
    Steps:
      1. pytest tests/integration/ -v --tb=short
    Expected Result: 全部通过
    Evidence: .omo/evidence/task-21-system-no-regress.txt
  ```

  **Commit**: YES
  - Message: `refactor(api): migrate system.py to Repository pattern`
  - Files: `main/framework/api/system.py`

- [x] 22. **迁移 performance.py (2 处 SessionLocal)**

  **What to do**:
  - 修改 `main/framework/core/performance.py`:
    - 删除 2 处 `SessionLocal()` (性能计数器写入)
    - 改用 `Depends(get_db)` 或构造注入
  - 保持性能指标行为

  **Must NOT do**:
  - 不修改性能指标语义

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: `[]`

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 4 (position 3)
  - **Blocked By**: Task 21

  **References**:
  - `main/framework/core/performance.py`

  **Acceptance Criteria**:
  - [ ] `pytest tests/integration/ -v` 全部通过

  **QA Scenarios (MANDATORY)**:
  ```
  Scenario: performance.py 迁移后无 regression
    Tool: Bash (pytest)
    Steps:
      1. pytest tests/integration/ -v --tb=short
    Expected Result: 全部通过
    Evidence: .omo/evidence/task-22-perf-no-regress.txt
  ```

  **Commit**: YES
  - Message: `refactor(core): migrate performance.py to Depends`
  - Files: `main/framework/core/performance.py`

- [x] 23. **迁移 sessions.py (4 处 SessionLocal)**

  **What to do**:
  - 修改 `main/framework/api/sessions.py`:
    - 删除 4 处 `SessionLocal()` (只读查询 ExecutionNode, Conversation)
    - 改用 `Depends(get_service(ExecutionRepository))` 和 `Depends(get_service(ConversationRepository))`

  **Must NOT do**:
  - 不修改 API 响应格式

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: `[]`

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 4 (position 4)
  - **Blocked By**: Task 22

  **References**:
  - `main/framework/api/sessions.py`
  - `main/framework/repositories/execution_repo.py` (Task 17)
  - `main/framework/repositories/conversation_repo.py` (Task 15)

  **Acceptance Criteria**:
  - [ ] `pytest tests/integration/ -v` 全部通过
  - [ ] `grep "SessionLocal()" main/framework/api/sessions.py` exit 1

  **QA Scenarios (MANDATORY)**:
  ```
  Scenario: sessions.py 迁移后无 regression
    Tool: Bash (pytest)
    Steps:
      1. pytest tests/integration/ -v --tb=short
    Expected Result: 全部通过
    Evidence: .omo/evidence/task-23-sessions-no-regress.txt
  ```

  **Commit**: YES
  - Message: `refactor(api): migrate sessions.py to ExecutionRepository + ConversationRepository`
  - Files: `main/framework/api/sessions.py`

- [x] 24. **迁移 triggers.py (6 处 SessionLocal)**

  **What to do**:
  - 修改 `main/framework/api/triggers.py`:
    - 删除 6 处 `SessionLocal()` 调用
    - 改用 `Depends(get_service(WorkflowRepository))` 和 `Depends(get_service(ExecutionRepository))`
    - 保留 `BackgroundTasks` 或 `asyncio.create_task` 模式（PHASE 1 不统一后台任务）
    - 后台任务使用 `get_session_factory()` (Task 12 提供的工厂函数)
  - 触发逻辑行为不变

  **Must NOT do**:
  - 不改变 trigger 触发逻辑
  - 不实现后台任务统一（PHASE 2）

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: `[]`
  - **Reason**: 6 处调用 + 后台任务模式

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 4 (position 5)
  - **Blocked By**: Task 23

  **References**:
  - `main/framework/api/triggers.py` (6 处)
  - `main/framework/repositories/workflow_repo.py` (Task 14)

  **Acceptance Criteria**:
  - [ ] `pytest tests/integration/ -v` 全部通过
  - [ ] `grep "SessionLocal()" main/framework/api/triggers.py` exit 1

  **QA Scenarios (MANDATORY)**:
  ```
  Scenario: triggers.py 迁移后无 regression
    Tool: Bash (pytest)
    Steps:
      1. pytest tests/integration/ -v --tb=short
    Expected Result: 全部通过
    Evidence: .omo/evidence/task-24-triggers-no-regress.txt
  ```

  **Commit**: YES
  - Message: `refactor(api): migrate triggers.py to WorkflowRepository`
  - Files: `main/framework/api/triggers.py`

- [x] 25. **迁移 executions.py (6 处 SessionLocal) - 移除模块级 repo**

  **What to do**:
  - 修改 `main/framework/api/executions.py`:
    - 删除 6 处 `SessionLocal()` 调用
    - **关键**：删除模块级 `repo = ExecutionRepository()` (line 21)
    - 改用 `Depends(get_service(ExecutionRepository))`
    - 保留所有现有 ExecutionRepository 方法调用
  - 这是向纯 DI 过渡的关键一步

  **Must NOT do**:
  - 不修改 ExecutionRepository 现有 11 个方法签名
  - 不改变 API 行为

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: `[]`
  - **Reason**: 移除模块级单例是架构关键转变

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 4 (position 6)
  - **Blocked By**: Task 24, Task 17 (向后兼容 ExecutionRepository)

  **References**:
  - `main/framework/api/executions.py:21` - 模块级 repo 实例
  - `main/framework/repositories/execution_repo.py` (Task 17)
  - `main/framework/core/container.py:get_service` (Task 18)

  **Acceptance Criteria**:
  - [ ] `pytest tests/integration/ -v` 全部通过
  - [ ] `grep -n "^repo = ExecutionRepository" main/framework/api/executions.py` exit 1 (无匹配)
  - [ ] `grep "SessionLocal()" main/framework/api/executions.py` exit 1

  **QA Scenarios (MANDATORY)**:
  ```
  Scenario: executions.py 迁移后无 regression
    Tool: Bash (pytest)
    Steps:
      1. pytest tests/integration/ -v --tb=short
    Expected Result: 全部通过
    Evidence: .omo/evidence/task-25-exec-no-regress.txt

  Scenario: 模块级 repo 已移除
    Tool: Bash (grep)
    Steps:
      1. grep -n "^repo = ExecutionRepository\|^repo=ExecutionRepository" main/framework/api/executions.py
      2. 断言无输出
    Expected Result: 无输出
    Evidence: .omo/evidence/task-25-no-module-repo.txt
  ```

  **Commit**: YES
  - Message: `refactor(api): migrate executions.py to ExecutionRepository (remove module-level repo)`
  - Files: `main/framework/api/executions.py`

- [x] 26. **迁移 retry_handler.py (2 处 SessionLocal)**

  **What to do**:
  - 修改 `main/framework/core/retry_handler.py`:
    - 删除 2 处 `SessionLocal()`
    - 改用 `Depends(get_service(ExecutionRepository))` 或构造注入

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: `[]`

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 4 (position 7)
  - **Blocked By**: Task 25

  **References**:
  - `main/framework/core/retry_handler.py`

  **Acceptance Criteria**:
  - [ ] `pytest tests/integration/ -v` 全部通过

  **QA Scenarios (MANDATORY)**:
  ```
  Scenario: retry_handler.py 迁移后无 regression
    Tool: Bash (pytest)
    Steps:
      1. pytest tests/integration/ -v --tb=short
    Expected Result: 全部通过
    Evidence: .omo/evidence/task-26-retry-no-regress.txt
  ```

  **Commit**: YES
  - Message: `refactor(core): migrate retry_handler.py to ExecutionRepository`
  - Files: `main/framework/core/retry_handler.py`

- [x] 27. **迁移 session_cleanup.py (2 处 SessionLocal)**

  **What to do**:
  - 修改 `main/framework/core/session_cleanup.py`:
    - 删除 2 处 `SessionLocal()`
    - 删除 `configure(backend)` 函数 (PHASE 1 全局状态清理)
    - 改用 Container 注入

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: `[]`

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 4 (position 8)
  - **Blocked By**: Task 26

  **References**:
  - `main/framework/core/session_cleanup.py`
  - `main/framework/core/container.py:backend` property (Task 18 保留)

  **Acceptance Criteria**:
  - [ ] `pytest tests/integration/ -v` 全部通过
  - [ ] `grep "configure(" main/framework/core/session_cleanup.py` exit 1 (除 Container)

  **QA Scenarios (MANDATORY)**:
  ```
  Scenario: session_cleanup.py 迁移后无 regression
    Tool: Bash (pytest)
    Steps:
      1. pytest tests/integration/ -v --tb=short
    Expected Result: 全部通过
    Evidence: .omo/evidence/task-27-cleanup-no-regress.txt
  ```

  **Commit**: YES
  - Message: `refactor(core): migrate session_cleanup.py (remove configure global)`
  - Files: `main/framework/core/session_cleanup.py`

- [x] 28. **迁移 scheduler.py (4 处 SessionLocal) - 移除 _engine_factory 全局**

  **What to do**:
  - 修改 `main/framework/core/scheduler.py`:
    - 删除 4 处 `SessionLocal()`
    - **关键**：删除模块级 `_engine_factory` 全局变量
    - **关键**：删除模块级 `_scheduler_instance` 全局变量（如果在）
    - `WorkflowScheduler` 改为通过 Container 创建 (已在 container.create_scheduler)
    - 改为 `Depends(get_service(WorkflowRepository))` 和 `Depends(get_service(ExecutionRepository))`
    - `add_job(run_scheduled_workflow, ...)` 改为注册 Container 方法
  - APScheduler 行为不变

  **Must NOT do**:
  - 不修改 APScheduler 配置
  - 不改变 cron 解析逻辑

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: `[]`
  - **Reason**: 全局状态 + APScheduler 集成复杂

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 4 (position 9)
  - **Blocked By**: Task 27

  **References**:
  - `main/framework/core/scheduler.py:20` (`_engine_factory`), line 87 (`add_job`)
  - `main/framework/core/container.py:78-84` (`create_scheduler`)
  - `main/framework/repositories/workflow_repo.py`, `execution_repo.py`

  **Acceptance Criteria**:
  - [ ] `pytest tests/integration/ -v` 全部通过
  - [ ] `pytest tests/integration/test_scheduled_workflow.py` 2 passed (Task 10)
  - [ ] `grep "_engine_factory\|_scheduler_instance" main/framework/core/scheduler.py` exit 1

  **QA Scenarios (MANDATORY)**:
  ```
  Scenario: scheduler.py 迁移后无 regression
    Tool: Bash (pytest)
    Steps:
      1. pytest tests/integration/ -v --tb=short
      2. 重点验证 test_scheduled_workflow.py
    Expected Result: 全部通过
    Evidence: .omo/evidence/task-28-sched-no-regress.txt

  Scenario: _engine_factory 全局已移除
    Tool: Bash (grep)
    Steps:
      1. grep -n "_engine_factory" main/framework/core/scheduler.py
      2. 断言无输出
    Expected Result: 无输出
    Evidence: .omo/evidence/task-28-no-factory-global.txt
  ```

  **Commit**: YES
  - Message: `refactor(core): migrate scheduler.py (remove _engine_factory global)`
  - Files: `main/framework/core/scheduler.py`

- [x] 29. **迁移 workflow_engine.py (3 处 SessionLocal) - engine session lifecycle**

  **What to do**:
  - 修改 `main/framework/core/workflow_engine.py`:
    - 删除 3 处独立 `SessionLocal()` (execute, execute_node, handle_failure)
    - **关键决策**: 选择 session lifecycle：
      - 选项A: `WorkflowEngine.__init__` 接收 `db: Session`，整个执行复用
      - 选项B: 每个方法独立 session (改用 SessionLocal via Container)
    - 推荐选项A (跨方法事务一致性)
    - 接收 `repo: ExecutionRepository` via Container
  - 暂时保留 `db.expire_all()` workarounds (Task 32 清理)

  **Must NOT do**:
  - 不拆分 execute_node (PHASE 2 关注)
  - 不改变 DAG 执行行为

  **Recommended Agent Profile**:
  - **Category**: `deep`
  - **Skills**: `[]`
  - **Reason**: 三重 session + 异步方法 + DAG 状态管理, 需谨慎设计

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 4 (position 10)
  - **Blocked By**: Task 28, Task 17 (ExecutionRepository v2)

  **References**:
  - `main/framework/core/workflow_engine.py:65,285,453` - 三处 SessionLocal
  - `main/framework/repositories/execution_repo.py` (Task 17 v2 方法)
  - `main/framework/core/container.py:create_workflow_engine` (Task 18 保留)

  **Acceptance Criteria**:
  - [ ] `pytest tests/integration/ -v` 全部通过
  - [ ] `pytest tests/integration/test_workflow_flow.py` 3 passed (Task 9)
  - [ ] `grep "SessionLocal()" main/framework/core/workflow_engine.py` exit 1
  - [ ] 文件 < 350 行（目标 300 行, 接受至 350）

  **QA Scenarios (MANDATORY)**:
  ```
  Scenario: workflow_engine.py 迁移后无 regression
    Tool: Bash (pytest)
    Steps:
      1. pytest tests/integration/ -v --tb=short
      2. 重点验证 test_workflow_flow.py
    Expected Result: 全部通过
    Evidence: .omo/evidence/task-29-engine-no-regress.txt

  Scenario: SessionLocal 已移除
    Tool: Bash (grep)
    Steps:
      1. grep -n "SessionLocal()" main/framework/core/workflow_engine.py
      2. 断言无输出
    Expected Result: 无输出
    Evidence: .omo/evidence/task-29-no-sessionlocal.txt
  ```

  **Commit**: YES
  - Message: `refactor(core): migrate workflow_engine.py to shared db session`
  - Files: `main/framework/core/workflow_engine.py`
  - Pre-commit: `pytest tests/integration/ && python scripts/check_lines.py`

- [x] 30. **迁移 conversations.py (3+1 嵌套 SessionLocal) - 移除 session_manager + 嵌套 db2**

  **What to do**:
  - 修改 `main/framework/api/conversations.py`:
    - 删除 3 处 `SessionLocal()` + 1 处 `db2 = SessionLocal()` (line 281 嵌套)
    - **关键**：删除模块级 `session_manager` 全局
    - 改用 `Depends(get_service(ConversationRepository))` 和 `Depends(get_service(ExecutionRepository))`
    - 后台任务 (`BackgroundTasks` 或 `asyncio.create_task`) 使用 `get_session_factory()` (Task 12)
    - 保留 `ConvSessionManager` 类，但通过 ConversationService 管理（不全局）
  - 这是最复杂的迁移

  **Must NOT do**:
  - 不拆分 conversations.py (PHASE 2 关注)
  - 不改变对话创建/消息 API 行为
  - 暂时保留 `db.expire_all()` (Task 32 清理)

  **Recommended Agent Profile**:
  - **Category**: `deep`
  - **Skills**: `[]`
  - **Reason**: 610 行 + 嵌套 db2 + 后台任务 + 全局状态, 最复杂迁移

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 4 (position 11, **最后**)
  - **Blocked By**: Task 29 (确保 engine 已迁移)

  **References**:
  - `main/framework/api/conversations.py:130` (session_manager), 281 (db2)
  - `main/framework/repositories/conversation_repo.py` (Task 15)
  - `main/framework/services/` (Task 19 UnitOfWork, for cross-repo ops)

  **Acceptance Criteria**:
  - [ ] `pytest tests/integration/ -v` 全部通过
  - [ ] `pytest tests/integration/test_conversation_flow.py` 3 passed (Task 8)
  - [ ] `grep "SessionLocal()" main/framework/api/conversations.py` exit 1
  - [ ] `grep -n "db2 = SessionLocal" main/framework/api/conversations.py` exit 1
  - [ ] `grep -n "^session_manager" main/framework/api/conversations.py` exit 1
  - [ ] conversations.py 行数不变 (PHASE 1 不拆分)

  **QA Scenarios (MANDATORY)**:
  ```
  Scenario: conversations.py 迁移后无 regression
    Tool: Bash (pytest)
    Steps:
      1. pytest tests/integration/ -v --tb=short
      2. 重点验证 test_conversation_flow.py
    Expected Result: 全部通过
    Evidence: .omo/evidence/task-30-conv-no-regress.txt

  Scenario: 嵌套 db2 已消除
    Tool: Bash (grep)
    Steps:
      1. grep -n "db2 = SessionLocal" main/framework/api/conversations.py
      2. 断言无输出
    Expected Result: 无输出
    Evidence: .omo/evidence/task-30-no-nested-db2.txt

  Scenario: session_manager 全局已移除
    Tool: Bash (grep)
    Steps:
      1. grep -n "^session_manager" main/framework/api/conversations.py
      2. 断言无输出
    Expected Result: 无输出
    Evidence: .omo/evidence/task-30-no-session-mgr.txt
  ```

  **Commit**: YES
  - Message: `refactor(api): migrate conversations.py (remove session_manager + nested db2)`
  - Files: `main/framework/api/conversations.py`
  - Pre-commit: `pytest tests/integration/ && python scripts/check_lines.py`

- [x] 31. **迁移 maintenance_db.py (2 处 SessionLocal) - 独立 DB**

  **What to do**:
  - 修改 `main/data_maintenance/models/maintenance_db.py`:
    - 删除 2 处 `SessionLocal()` 调用（如果存在于此文件）
    - 改用 `Depends(get_service(MaintenanceRepository))` 或 `get_maintenance_db()` 双轨
  - 如果 SessionLocal 在 `data_maintenance/api/` 下，则改对应文件
  - 保持 MaintenanceBase 独立

  **Must NOT do**:
  - 不统一两个数据库
  - 不修改 MaintenanceBase 模型

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: `[]`
  - **Reason**: 独立子系统, 2 处调用

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 4 (position 12, 最后)
  - **Blocked By**: Task 30

  **References**:
  - `main/data_maintenance/models/maintenance_db.py:44,58` - 2 处 SessionLocal
  - `main/data_maintenance/repositories/maintenance_repo.py` (Task 16)

  **Acceptance Criteria**:
  - [ ] `pytest tests/integration/ -v` 全部通过
  - [ ] `grep "SessionLocal()" main/data_maintenance/ --include="*.py" -r` 仅在 `maintenance_db.py` 的 `_SessionLocal` 定义

  **QA Scenarios (MANDATORY)**:
  ```
  Scenario: maintenance 迁移后无 regression
    Tool: Bash (pytest)
    Steps:
      1. pytest tests/integration/ -v --tb=short
    Expected Result: 全部通过
    Evidence: .omo/evidence/task-31-maint-no-regress.txt

  Scenario: maintenance 子系统 SessionLocal 已最小化
    Tool: Bash (grep)
    Steps:
      1. grep -rn "SessionLocal()" main/data_maintenance/ --include="*.py"
      2. 验证仅在 maintenance_db.py 中作为定义
    Expected Result: 仅 1-2 个匹配（定义位置）
    Evidence: .omo/evidence/task-31-maint-grep.txt
  ```

  **Commit**: YES
  - Message: `refactor(maintenance): migrate data_maintenance to MaintenanceRepository`
  - Files: `main/data_maintenance/...` (depends on actual call locations)

### Wave 5: Cleanup (并行, 3个任务)

- [x] 32. **移除 db.expire_all() workarounds**

  **What to do**:
  - 搜索所有 `db.expire_all()` 和 `db.commit()` visibility hacks
  - 已知位置: `conversations.py:295`, `scheduler.py:322`, `workflow_engine.py:70,103,131`
  - 删除或重写为标准 SQLAlchemy 模式
  - 验证 WAL 模式下无需这些 workaround

  **Must NOT do**:
  - 不修改业务行为
  - 不在 PHASE 1 引入新 ORM 模式

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: `[]`
  - **Reason**: SQLAlchemy 内部机制 + 跨文件验证

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 5
  - **Blocks**: F1-F4 reviews
  - **Blocked By**: Wave 4 全部完成

  **References**:
  - `main/framework/api/conversations.py:295`
  - `main/framework/core/scheduler.py:322`
  - `main/framework/core/workflow_engine.py:70,103,131`

  **Acceptance Criteria**:
  - [ ] `pytest tests/integration/ -v` 全部通过
  - [ ] `grep -rn "db.expire_all\|db.commit()" main/framework/ --include="*.py"` 仅在 Repository (BaseRepository) 内
  - [ ] 文件 < 500 行

  **QA Scenarios (MANDATORY)**:
  ```
  Scenario: 移除 expire_all 后无 regression
    Tool: Bash (pytest)
    Steps:
      1. pytest tests/integration/ -v --tb=short
    Expected Result: 全部通过
    Evidence: .omo/evidence/task-32-no-expire-regress.txt

  Scenario: db.expire_all 已从业务代码移除
    Tool: Bash (grep)
    Steps:
      1. grep -rn "db.expire_all" main/framework/ --include="*.py"
      2. 验证仅在 Repository 层（无业务代码）
    Expected Result: 仅 Repository 内
    Evidence: .omo/evidence/task-32-expire-grep.txt
  ```

  **Commit**: YES
  - Message: `chore(cleanup): remove db.expire_all() workarounds`
  - Files: `main/framework/api/conversations.py`, `main/framework/core/scheduler.py`, `main/framework/core/workflow_engine.py`

- [x] 33. **移除死代码: 模块级 ExecutionRepository 实例化路径**

  **What to do**:
  - 搜索 `repo = ExecutionRepository()` 模式
  - 验证所有调用方已迁移至 `Depends` 注入 (Task 25 已完成)
  - 删除任何遗留的模块级实例化
  - 验证 Container 仍是唯一创建点

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: `[]`

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 5
  - **Blocked By**: Wave 4 全部完成

  **References**:
  - `main/framework/core/container.py:55-58` - 唯一创建点
  - PHASE1.md §0.2 (line 25-29) - 跨层调用规范

  **Acceptance Criteria**:
  - [ ] `grep -rn "= ExecutionRepository()" main/ --include="*.py"` 仅在 container.py 内
  - [ ] `pytest tests/integration/ -v` 全部通过

  **QA Scenarios (MANDATORY)**:
  ```
  Scenario: ExecutionRepository 唯一在 Container 创建
    Tool: Bash (grep)
    Steps:
      1. grep -rn "= ExecutionRepository()" main/ --include="*.py"
      2. 断言仅 container.py 匹配
    Expected Result: 1 个匹配 (container.py)
    Evidence: .omo/evidence/task-33-repo-creation.txt
  ```

  **Commit**: YES
  - Message: `chore(cleanup): remove dead ExecutionRepository instantiations`
  - Files: (TBD by grep results)

- [x] 34. **验证所有全局状态已替换**

  **What to do**:
  - 搜索 PHASE 1 识别的 4 个全局状态模式:
    - `_engine_factory` (scheduler.py:20) - 应仅在 Container
    - `_scheduler_instance` (scheduler.py:346) - 应仅在 Container
    - `session_manager` (conversations.py:130) - 应通过 Service
    - `configure(` 函数 - 应全部删除（除 Container 内部）
  - 生成验证报告
  - 如果有遗漏，标记为后续 PHASE 2 任务

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: `[]`

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 5
  - **Blocked By**: Wave 4 全部完成

  **References**:
  - Metis findings (draft 2026-06-09)
  - PHASE1.md §0.1 (line 19)

  **Acceptance Criteria**:
  - [ ] `grep -rn "_engine_factory\|_scheduler_instance\|session_manager" main/ --include="*.py"` 仅在 container.py
  - [ ] `grep -rn "^def configure(" main/ --include="*.py"` 仅在 container.py

  **QA Scenarios (MANDATORY)**:
  ```
  Scenario: 全局变量已收敛到 Container
    Tool: Bash (grep)
    Steps:
      1. grep -rn "_engine_factory\|_scheduler_instance" main/ --include="*.py"
      2. grep -rn "session_manager" main/ --include="*.py"
      3. 两者都应仅在 container.py 中
    Expected Result: 仅 container.py 匹配
    Evidence: .omo/evidence/task-34-globals-clean.txt

  Scenario: configure() 函数已删除
    Tool: Bash (grep)
    Steps:
      1. grep -rn "^def configure(" main/ --include="*.py"
      2. 断言无输出
    Expected Result: 无输出
    Evidence: .omo/evidence/task-34-no-configure.txt
  ```

  **Commit**: NO (verification only, no code changes expected)

---

## Final Verification Wave (MANDATORY)

- [ ] F1. **Plan Compliance Audit** — `oracle`
- [ ] F2. **Code Quality Review** — `unspecified-high`
- [ ] F3. **Real Manual QA** — `unspecified-high`
- [ ] F4. **Scope Fidelity Check** — `deep`

### Discovered Issues (Wave 1-2) — Deferred to Final Wave

> **用户指示**: "把每个wave发现的问题处理都放到final里面处理"

- [ ] F5. **修复 Scheduler 路由 bug**: `GET /api/v1/workflows/scheduled` 被 `/{workflow_id}` 影子覆盖 — 改 router 注册顺序或加 explicit path
- [ ] F6. **修复 workflow_parser.validate_dag() 循环检测 bug**: `defaultdict(str)` 默认是 `""` 不是 `"white"` — cyclic DAG 静默通过
- [ ] F7. **修复 API 路径不一致**: `/api/v1/workflows/` (POST) vs `/api/workflows/{id}/trigger` (无 /v1/) — 统一前缀
- [ ] F8. **更新 pyproject.toml ruff rules**: Wave 1 限制为 `["E","W","F"]` (215 legacy issues) — Wave 4 完成后加回 UP, I, B, SIM
- [ ] F9. **更新 check_dependencies.py expected_violations**: 添加 `api/workflows.py` (Wave 2 Task 9 发现 2 violations)

---

## Commit Strategy

### Per-Step (Task) Commits (每个任务一次)

每个任务在其 `Commit: YES` 段已定义具体 message，按 conventional commits 规范:
- `chore(...)` - 配置/工具/无关功能
- `feat(...)` - 新功能/新文件
- `refactor(...)` - 重构不改行为
- `test(...)` - 测试代码
- `fix(...)` - 修复

### Per-Wave Checkpoint Commits (每个 Wave 完成后)

> **用户要求**: "每一个wave都要git存档" — Wave 完成后必须 checkpoint commit + tag

每个 Wave 全部任务 commit 完成后，执行:

```bash
# 1. 验证 working tree 干净
git status

# 2. Wave checkpoint commit (空 commit 作为 marker)
git commit --allow-empty -m "chore(checkpoint): phase1-wave-N complete

Wave N summary:
- Tasks <X>-<Y>: <brief description>
- All QA scenarios passed
- Integration tests: <X/Y passed>

Tag: phase1-wave-N-complete
Executed-by: Sisyphus"

# 3. Lightweight tag (可恢复到该 wave)
git tag phase1-wave-N-complete

# 4. Push 到 origin (可选, 由用户决定)
git push origin phase1-foundation --tags
```

**Wave 标签**:
| Wave | Tag | 时间点 |
|------|-----|--------|
| Wave 0 | `pre-phase1-baseline` | Git 环境就绪后 |
| Wave 1 | `phase1-wave-1-complete` | 7 个 foundation 任务完成后 |
| Wave 2 | `phase1-wave-2-complete` | 4 个集成测试完成后 |
| Wave 3 | `phase1-wave-3-complete` | 8 个数据层任务完成后 |
| Wave 4 | `phase1-wave-4-complete` | 12 个迁移任务完成后 |
| Wave 5 | `phase1-wave-5-complete` | 3 个清理任务完成后 |
| Final | `phase1-complete` | F1-F4 全部 APPROVE 后 |

### 失败恢复策略

```bash
# 恢复到上一个 wave
git checkout phase1-wave-(N-1)-complete
# 或恢复到上一个 task
git log --oneline | grep "task-N-"
git checkout <commit-sha>
# 重启 Sisyphus 时它会自动检测 git 状态并恢复上下文
```

### Wave-Specific Commit Aggregations (参考)

- **Wave 1 全部完成后**: 7 次单任务 commit + 1 次 checkpoint = 8 次 commit
- **Wave 2 全部完成后**: 4 次单任务 commit + 1 次 checkpoint = 5 次 commit
- **Wave 3 全部完成后**: 8 次单任务 commit + 1 次 checkpoint = 9 次 commit
- **Wave 4 全部完成后**: 12 次单任务 commit + 1 次 checkpoint = 13 次 commit
- **Wave 5 全部完成后**: 2-3 次单任务 commit + 1 次 checkpoint = 3-4 次 commit
- **Final 全部完成后**: 0 次代码 commit (只审核) + 1 次 `phase1-complete` tag

**总计**: 约 35 次单任务 commit + 6 次 wave checkpoint commit + 7 个 tag

---

## Success Criteria

### Verification Commands
```bash
# 测试
pytest tests/integration/ -v    # Expected: 10-15 passed
pytest tests/unit/ -v           # Expected: 30+ passed

# SessionLocal 消除
grep -r "SessionLocal()" main/ --include="*.py"  # Expected: 仅 database.py, maintenance_db.py (definition only)

# 全局状态消除
grep -rn "configure(" main/ --include="*.py"  # Expected: 0 results (除 Container 自身)
grep -rn "_engine_factory\|_scheduler_instance\|session_manager" main/ --include="*.py"  # Expected: 仅 Container

# 代码质量
ruff check main/ webui/    # Expected: All checks passed
python scripts/check_lines.py    # Expected: 0 files > 500 lines
python scripts/check_dependencies.py    # Expected: 0 violations

# WAL mode 验证
python -c "from main.framework.models.database import engine; conn = engine.connect(); print(conn.execute('PRAGMA journal_mode').scalar())"    # Expected: wal
```

### Final Checklist
- [ ] All "Must Have" present
- [ ] All "Must NOT Have" absent
- [ ] 30+ Repository unit tests passing
- [ ] 10-15 integration tests passing
- [ ] WAL mode verified at runtime
- [ ] All globals replaced
- [ ] All 13 files migrated off SessionLocal() (除定义文件)
- [ ] ExecutionRepository 11 个方法签名保持向后兼容
