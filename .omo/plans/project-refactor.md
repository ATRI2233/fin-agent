# 项目重构计划 — 整合 MCP Servers 为统一 Monorepo

## TL;DR

> **目标**: 将分散在 `download/` 和 `mcp_servers/` 的金融分析项目统一为 monorepo 结构，所有 MCP 服务器集中管理，依赖不提交到 GitHub。
>
> **核心操作**:
> - 移动 `download/.git` 到项目根目录，保留完整 git 历史
> - 创建 `fin-agent/` 统一目录，整合所有 MCP 服务器
> - 从 shell heredoc 提取 Python MCP 为独立 .py 文件
> - FRED MCP 源码整合到项目内（非 git submodule）
> - 更新安装脚本适配新路径
> - 配置 .gitignore 排除依赖目录
>
> **关键指标**:
> - 5 个 MCP 服务器 → 统一在 `fin-agent/mcp-servers/` 下
> - 安装脚本从 918 行减少约 50%（去掉 heredoc 代码）
> - git 仓库体积减少 90%+（移除了 node_modules/build 产物）
> - 所有路径变量参数化，不再硬编码

---

## Context

### 当前状态诊断

| 目录 | Git状态 | 远程地址 | 内容 |
|------|---------|---------|------|
| `download/` | **主仓库** | `github.com/ATRI2233/fin-agent` | 核心 MCP 服务器 + Skill |
| `mcp_servers/` | 有独立 .git (fred-mcp-server 的克隆) | `github.com/stefanoamorelli/fred-mcp-server` | 外部 MCP 服务器集合 |
| `mcp_servers/fred-mcp-server/` | 自带 .git | 同上 | 美联储经济数据 MCP |
| `mcp_servers/sec-edgar-mcp/` | 自带 .git | `github.com/stefanoamorelli/sec-edgar-mcp` | SEC 财报 MCP |
| `mcp_servers/ashare-mcp/` | 无 .git | — | A 股 MCP (单 .py 文件) |
| `mcp_servers/risk-mcp/` | 无 .git | — | 风控 MCP (单 .py 文件) |

### 当前问题

1. **项目分散**: MCP 服务器散落在 `download/` 和 `mcp_servers/` 两个大目录
2. **代码嵌入**: ashare-mcp 和 risk-mcp 的源码嵌入在安装脚本(heredoc)中，无法独立版本管理
3. **外部依赖**: fred-mcp-server 和 sec-edgar-mcp 有自己的 git 历史，与主项目解耦
4. **依赖膨胀**: git 仓库可能包含 node_modules、build 产物
5. **路径硬编码**: 安装脚本中使用绝对/相对硬编码路径

### 用户决策

1. ✅ 移动 `download/.git` 到根目录，保留完整历史
2. ✅ FRED MCP 保留并整合源码到项目内
3. ✅ Python MCP 从 heredoc 提取为独立 .py 文件
4. ✅ sec-edgar-mcp 以 `mcp_servers/sec-edgar-mcp/` 为主版本

### Metis 审查要点

- ⚠️ 路径断裂风险：安装脚本中多处硬编码路径需要重写
- ⚠️ git 历史路径变化：移动 .git 后文件路径相对关系变化
- ⚠️ FRED MCP 双构建系统：fred-mcp-server 有自己的 package.json/build 流程
- ⚠️ sec-edgar 版本冲突：两个位置都有，需确认主版本
- ✅ 建议 FRED 采用源码复制（保留 package.json），不采用 submodule
- ✅ 建议所有脚本路径参数化

---

## Work Objectives

### 核心目标
将分散的金融 MCP 服务器项目重构为统一、可维护的 monorepo 结构，依赖不提交版本控制。

### 目标目录结构（重构后）

```
D:\github_place\financial_stock\        ← git 根（download/.git 移过来）
├── fin-agent\                           ← 所有源码统一在 fin-agent/ 下
│   ├── mcp-server\                      ← 核心 MCP 服务器（原 fin-agent-mcp-server）
│   │   ├── src\                         # TS 源码
│   │   │   ├── index.ts
│   │   │   ├── memory/
│   │   │   ├── tools/          (18 tools)
│   │   │   └── mcp/
│   │   ├── dist\                        # 构建产物（.gitignore）
│   │   ├── package.json
│   │   └── tsconfig.json
│   ├── skill\                           ← Skill 模块（原 fin-agent-skill）
│   │   ├── src\
│   │   │   ├── index.ts
│   │   │   └── engines/
│   │   ├── SKILL.md
│   │   ├── market-briefing/
│   │   ├── stock-deep/
│   │   ├── fin-review/
│   │   └── position-watch/
│   ├── mcp-servers\                     ← 所有数据源 MCP 统一存放
│   │   ├── fred\                        ← FRED 经济数据 MCP
│   │   │   ├── src\
│   │   │   ├── test/
│   │   │   ├── package.json
│   │   │   └── tsconfig.json
│   │   ├── sec-edgar\                   ← SEC 财报 MCP
│   │   │   ├── src/ (or .py files)
│   │   │   └── pyproject.toml
│   │   ├── ashare\                      ← A 股 MCP（提取为独立文件）
│   │   │   └── ashare_mcp_server.py
│   │   └── risk\                        ← 风控 MCP（提取为独立文件）
│   │       └── risk_mcp_server.py
│   └── scripts\                         ← 统一安装脚本
│       ├── install.sh
│       └── install.bat
├── .gitignore                           ← 排除依赖
└── README.md
```

### 删除/清理（重构后）
- `download/` 目录（源码已移走，保留 git 历史）
- `mcp_servers/` 目录（源码已整合到 fin-agent/）
- 根目录下的乱码 .md 文件

### Must Have
- [ ] 所有 git 历史完整保留，`git log` 可回溯到原始提交
- [ ] 所有 MCP 服务器可正常构建和运行
- [ ] 安装脚本能够在新结构下完成安装
- [ ] .gitignore 排除所有依赖目录（node_modules, __pycache__ 等）
- [ ] Python MCP 为独立 .py 文件，不再嵌入 shell 脚本

### Must NOT Have (Guardrails)
- ❌ 不提交 node_modules、build 产物、dist 目录到 git
- ❌ 不删除原始 git 历史（git rebase/git reset）
- ❌ 不在 shell 脚本中使用 heredoc 包含完整代码
- ❌ 不把 .env 文件提交到版本控制
- ❌ 不使用 `--force` 推送

---

## Verification Strategy

> 所有验证通过 Bash 命令执行，零人工干预。

### 关键验证点
1. **git 历史完整性**: `git log --oneline -10` 确认历史存在
2. **构建验证**: 各 Node 项目 `npm run build` 正常
3. **安装脚本测试**: `scripts/install.sh --help` 正常输出
4. **路径正确性**: 所有 `mcp_server.json` 中的路径指向新结构
5. **依赖排除**: `git status` 不显示 node_modules/build/dist

---

## Execution Strategy

### 执行流程概览

```
Phase 1: 备份 + 准备工作台
├── 1.1 备份所有 .git 仓库
└── 1.2 清单 mcp_servers/ 所有文件

Phase 2: Git 历史迁移
├── 2.1 复制 download/.git 到项目根
└── 2.2 git add → commit 新结构（保留历史）

Phase 3: 目录结构重组 (MAX PARALLEL)
├── 3.1 创建 fin-agent/ 目录骨架
├── 3.2 移动 fin-agent-mcp-server → fin-agent/mcp-server
├── 3.3 移动 fin-agent-skill → fin-agent/skill
├── 3.4 整合 FRED MCP 源码
├── 3.5 整合 sec-edgar MCP 源码
├── 3.6 提取风险 MCP 为独立文件
└── 3.7 提取 A 股 MCP 为独立文件

Phase 4: 脚本 + 配置更新
├── 4.1 创建 .gitignore
├── 4.2 重写 install.sh（适配新路径）
├── 4.3 重写 install.bat（适配新路径）
└── 4.4 创建 README.md

Phase 5: 清理 + 最终验证
├── 5.1 清理旧目录/文件
├── 5.2 验证 git 历史
├── 5.3 验证构建
└── 5.4 全面提交
```

---

## TODOs

- [ ] 1. 备份所有 Git 仓库

  **What to do**:
  - 复制 `download/.git` 到 `download.git.bak`（通过文件系统复制）
  - 记录 `mcp_servers/fred-mcp-server/.git` 的远程地址和当前分支
  - 记录 `mcp_servers/sec-edgar-mcp/.git` 的远程地址和当前分支
  - 确保以下信息记录到 `.omo/plans/git-backup-info.md`:
    - download 仓库: `git log --oneline -5`, `git remote -v`, `git branch`
    - fred-mcp-server: `git log --oneline -5`, `git remote -v`
    - sec-edgar-mcp: `git log --oneline -5`, `git remote -v`

  **Must NOT do**:
  - 不要删除任何原始 .git 目录
  - 不要执行 git rebase/git reset/git merge

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - 原因：纯备份操作，简单直接
  - **Skills**: [`git-master`]
    - `git-master`: 需要 git 状态检查和日志记录

  **Parallelization**:
  - **Can Run In Parallel**: NO（必须最先执行）
  - **Blocks**: 任务 2-7
  - **Blocked By**: None

  **Acceptance Criteria**:
  - [ ] `download.git.bak/` 存在且是有效 git 仓库
  - [ ] `git -C download.git.bak log --oneline -5` 输出正常
  - [ ] 备份信息已保存到 `.omo/plans/git-backup-info.md`

  **QA Scenarios**:
  ```
  Scenario: 验证备份完整性
    Tool: Bash
    Steps:
      1. Test-Path "download.git.bak/HEAD"
      2. git -C download.git.bak log --oneline -1
    Expected: 输出至少一个提交记录
    Failure Indicators: "fatal: not a git repository"
    Evidence: .omo/evidence/task-1-backup-verified.txt
  ```

  **Commit**: NO（分组到任务 22 统一提交）

- [ ] 2. 盘点 mcp_servers/ 所有非依赖文件清单

  **What to do**:
  - 遍历 `mcp_servers/` 目录，列出所有非 node_modules/非 .git 的文件
  - 按模块分类记录：
    - `fred-mcp-server/`：src/, test/, package.json, tsconfig.json, README.md 等
    - `ashare-mcp/`：ashare-mcp-server.py
    - `risk-mcp/`：risk-mcp-server.py
    - `sec-edgar-mcp/`：完整 Python 项目
    - `src/`：通用 Fred tools (search/series/browse)
    - `test/`：测试文件
    - `docs/`：文档文件
    - `assets/`：资源文件
  - 将清单保存到 `.omo/plans/mcp-servers-inventory.md`

  **Must NOT do**:
  - 不要进入 node_modules/ 目录
  - 不要修改任何现有文件

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []（纯文件操作）

  **Parallelization**:
  - **Can Run In Parallel**: NO（依赖任务 1 完成）
  - **Blocks**: 任务 4-8
  - **Blocked By**: 任务 1

  **Acceptance Criteria**:
  - [ ] 清单文件包含所有模块的文件路径
  - [ ] 每个模块的依赖文件（package.json/pyproject.toml）被明确标记

  **QA Scenarios**:
  ```
  Scenario: 验证清单完整性
    Tool: Bash
    Preconditions: 清单文件已保存
    Steps:
      1. 检查清单中包含 fred-mcp-server/package.json
      2. 检查清单中包含 ashare-mcp/ashare-mcp-server.py
      3. 检查清单中包含 risk-mcp/risk-mcp-server.py
    Expected: 所有关键文件路径都在清单中
    Evidence: .omo/evidence/task-2-inventory-check.txt
  ```

  **Commit**: NO

- [ ] 3. 移动 Git 仓库到项目根目录

  **What to do**:
  - 将 `download/.git` 移动到 `D:\github_place\financial_stock\.git`
  - 执行 `git status` 确认 git 已识别根目录下的所有文件
  - 执行 `git log --oneline -5` 确认历史完整
  - 执行 `git remote -v` 确认远程地址正确
  - 配置 `.git` 的 user.name/user.email（如果未设置）

  **Must NOT do**:
  - 不要删除 `download/` 目录中的任何文件
  - 不要执行 `git init`（必须使用原有 .git）

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: [`git-master`]

  **Parallelization**:
  - **Can Run In Parallel**: NO（关键操作）
  - **Blocks**: 任务 4-8, 9
  - **Blocked By**: 任务 1, 2

  **Acceptance Criteria**:
  - [ ] `git status` 显示当前在 `master` 分支
  - [ ] `git log --oneline -5` 输出与备份一致
  - [ ] `git remote -v` 显示 `origin → https://github.com/ATRI2233/fin-agent.git`

  **QA Scenarios**:
  ```
  Scenario: 验证 git 迁移成功
    Tool: Bash
    Steps:
      1. git log --oneline -3
      2. git remote -v
      3. git status
    Expected:
      - git log 输出至少 3 个提交记录
      - git remote 显示 origin 指向 ATRI2233/fin-agent.git
      - git status 显示工作区当前状态
    Evidence: .omo/evidence/task-3-git-migrated.txt
  ```

  **Commit**: NO

- [ ] 4. 创建新目录骨架

  **What to do**:
  - 在根目录下创建以下目录结构：
    ```
    fin-agent/
    ├── mcp-server/
    ├── skill/
    ├── mcp-servers/
    │   ├── fred/
    │   ├── ashare/
    │   ├── risk/
    │   └── sec-edgar/
    └── scripts/
    ```
  - 使用命令：`mkdir -p fin-agent/mcp-server fin-agent/skill fin-agent/mcp-servers/fred fin-agent/mcp-servers/ashare fin-agent/mcp-servers/risk fin-agent/mcp-servers/sec-edgar fin-agent/scripts`

  **Must NOT do**:
  - 不要移动任何文件，只创建空目录
  - 不要创建 `.gitkeep` 等标记文件

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Blocks**: 任务 5-10
  - **Blocked By**: 任务 3

  **Acceptance Criteria**:
  - [ ] 所有目标目录存在
  - [ ] 目录结构符合预期

  **QA Scenarios**:
  ```
  Scenario: 验证目录结构
    Tool: Bash
    Steps:
      1. Test-Path "fin-agent/mcp-server" -PathType Container
      2. Test-Path "fin-agent/skill" -PathType Container
      3. Test-Path "fin-agent/mcp-servers/fred" -PathType Container
      4. Test-Path "fin-agent/scripts" -PathType Container
    Expected: 所有目录存在（返回 True）
    Evidence: .omo/evidence/task-4-dirs-created.txt
  ```

  **Commit**: NO

- [ ] 5. 移动核心 MCP 服务器到新位置

  **What to do**:
  - 将 `download/fin-agent-mcp-server/` 下的源码文件（不含 node_modules、dist）移动到 `fin-agent/mcp-server/`
  - 文件范围：
    - `src/`（完整目录结构）
    - `package.json`
    - `tsconfig.json`
    - `.env`（复制后确认 .gitignore 已排除）
    - `CHANGELOG.md`
  - 注意：`dist/` 和 `node_modules/` **不移动**
  - 使用 `Copy-Item` 逐目录复制（PowerShell）

  **Must NOT do**:
  - 不要复制 `node_modules/`
  - 不要复制 `dist/`（构建产物，后续重新构建）

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES（与任务 6-9 并行执行）
  - **Parallel Group**: Wave 2
  - **Blocks**: 任务 11, 12
  - **Blocked By**: 任务 4

  **Acceptance Criteria**:
  - [ ] `fin-agent/mcp-server/src/index.ts` 存在
  - [ ] `fin-agent/mcp-server/package.json` 存在

  **QA Scenarios**:
  ```
  Scenario: 验证核心 MCP 服务器迁移
    Tool: Bash
    Steps:
      1. Test-Path "fin-agent/mcp-server/src/index.ts" -PathType Leaf
      2. Test-Path "fin-agent/mcp-server/package.json" -PathType Leaf
      3. Test-Path "fin-agent/mcp-server/src/tools/signalFusion.ts" -PathType Leaf
    Expected: 全部返回 True
    Evidence: .omo/evidence/task-5-core-moved.txt
  ```

  **Commit**: NO

- [ ] 6. 移动 Skill 模块到新位置

  **What to do**:
  - 将 `download/fin-agent-skill/` 下的非依赖文件移动到 `fin-agent/skill/`
  - 文件范围：
    - `src/`（完整目录结构）
    - `dist/`（如果存在且已提交）
    - `package.json`
    - `tsconfig.json`
    - `SKILL.md`（主 skill 定义）
    - `market-briefing/SKILL.md`
    - `stock-deep/SKILL.md`
    - `fin-review/SKILL.md`
    - `position-watch/SKILL.md`
  - 注意：`node_modules/` 不移动

  **Must NOT do**:
  - 不要复制 `node_modules/`

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES（与任务 5, 7-9 并行）
  - **Parallel Group**: Wave 2
  - **Blocks**: 任务 11
  - **Blocked By**: 任务 4

  **Acceptance Criteria**:
  - [ ] `fin-agent/skill/src/index.ts` 存在
  - [ ] `fin-agent/skill/SKILL.md` 存在
  - [ ] 4 个子 skill SKILL.md 文件都存在

  **Commit**: NO

- [ ] 7. 整合 FRED MCP 源码

  **What to do**:
  - 将 `mcp_servers/fred-mcp-server/` 下的源码文件（不含 node_modules、.git、build）移动到 `fin-agent/mcp-servers/fred/`
  - 文件范围：
    - `src/`（完整目录：tools.ts, search.ts, series.ts, browse.ts）
    - `test/`（完整测试目录）
    - `package.json`
    - `tsconfig.json`
    - `CHANGELOG.md`
    - `README.md`
    - `SECURITY.md`
    - `server.json`
    - `smithery.yaml`
  - 同时将 `mcp_servers/src/` 下的通用源码（index.ts, index.wrapper.ts, common/request.ts 等）也移到 `fin-agent/mcp-servers/fred/src/` 适当位置
  - 注意：删除 `mcp_servers/fred-mcp-server/.git/`（源码整合，不保留子模块）

  **Must NOT do**:
  - 不要复制 `node_modules/`
  - 不要复制 `build/`
  - 不要保留独立的 `.git` 目录

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES（与任务 5, 6, 8, 9 并行）
  - **Parallel Group**: Wave 2
  - **Blocks**: 任务 12
  - **Blocked By**: 任务 4

  **Acceptance Criteria**:
  - [ ] `fin-agent/mcp-servers/fred/src/index.ts` 存在
  - [ ] `fin-agent/mcp-servers/fred/package.json` 存在
  - [ ] `fin-agent/mcp-servers/fred/src/fred/tools.ts` 存在
  - [ ] 没有 `.git` 目录在 `fred/` 下
  
  **Commit**: NO

- [ ] 8. 整合 sec-edgar MCP 源码

  **What to do**:
  - 以 `mcp_servers/sec-edgar-mcp/` 为主版本（它有完整 git 历史和 pyproject.toml）
  - 将文件移动到 `fin-agent/mcp-servers/sec-edgar/`
  - 排除：.git, node_modules, __pycache__, build 产物
  - 文件范围：所有 .py, pyproject.toml, README.md, docs/ 等
  - 与 `download/sec-edgar-mcp/` 对比，如有额外文件则合并

  **Must NOT do**: 不复制 .git/、__pycache__/、node_modules/

  **Parallelization**: Wave 2, 与任务 5-7, 9, 10 并行
  **Blocked By**: 任务 4

  **Acceptance Criteria**:
  - [ ] `fin-agent/mcp-servers/sec-edgar/pyproject.toml` 存在
  - [ ] 无 .git 目录

  **QA Scenarios**:
  ```txt
  Scenario: 验证 sec-edgar 迁移
    Tool: Bash
    Steps:
      1. Test-Path "fin-agent/mcp-servers/sec-edgar/pyproject.toml"
    Expected: True
    Evidence: .omo/evidence/task-8-secedgar-moved.txt
  ```

  **Commit**: NO

- [ ] 9. 移动风险 MCP 到新位置

  **What to do**:
  - Python MCP 源码已存在于 `mcp_servers/risk-mcp/risk-mcp-server.py`（同时也嵌入在 install.sh heredoc 中）
  - 将 `mcp_servers/risk-mcp/risk-mcp-server.py` 复制到 `fin-agent/mcp-servers/risk/risk_mcp_server.py`
  - 确保 shebang: `#!/usr/bin/env python3`
  - 创建 `fin-agent/mcp-servers/risk/requirements.txt`：yfinance, numpy, pandas

  **Must NOT do**: 不修改原始代码逻辑

  **Parallelization**: Wave 2, 与任务 5-8, 10 并行
  **Blocked By**: 任务 4

  **Acceptance Criteria**:
  - [ ] 包含 3 个 tool（risk_gauge, position_sizing, institutional_flow）
  - [ ] requirements.txt 存在

  **Commit**: NO

- [ ] 10. 移动 A 股 MCP 到新位置

  **What to do**:
  - Python MCP 源码已存在于 `mcp_servers/ashare-mcp/ashare-mcp-server.py`（同时也嵌入在 install.sh heredoc 中）
  - 将 `mcp_servers/ashare-mcp/ashare-mcp-server.py` 复制到 `fin-agent/mcp-servers/ashare/ashare_mcp_server.py`
  - 确保 shebang: `#!/usr/bin/env python3`
  - 创建 `fin-agent/mcp-servers/ashare/requirements.txt`：akshare, numpy, pandas, requests

  **Must NOT do**: 不修改原始代码逻辑

  **Parallelization**: Wave 2, 与任务 5-9 并行
  **Blocked By**: 任务 4

  **Acceptance Criteria**:
  - [ ] 包含 7 个 tool
  - [ ] requirements.txt 存在

  **Commit**: NO

---

## Phase 4: 脚本与配置更新

- [x] 11. 创建 .gitignore

  **What to do**: 创建项目根目录 `.gitignore`，排除：
  - node_modules/, dist/, build/, __pycache__/, *.pyc, .ruff_cache/
  - .env, .env.local, *.db, *.db-wal, *.db-journal
  - .DS_Store, Thumbs.db, .vscode/, .idea/, *.bak

  **Parallelization**: Wave 3
  **Blocked By**: 任务 4

  **Acceptance Criteria**:
  - [x] `.gitignore` 存在
  - [x] 包含 node_modules/ 和 __pycache__/

  **Commit**: NO

- [x] 12. 重写 install.sh（适配新路径）

  **What to do**:
  - 基于原 `download/fin-agent-astrbot-install.sh` 重写，保存到 `fin-agent/scripts/install.sh`
  - 路径变更：BUILD_DIR 指向根目录，FIN_AGENT_DIR→fin-agent/mcp-server, MCP_SERVERS_BASE→fin-agent/mcp-servers, SKILL_SOURCE_BASE→fin-agent/skill
  - 去掉：git clone FRED MCP 逻辑、heredoc 创建逻辑
  - 保留：--help, --uninstall, --update、mcp_server.json 配置

  **Must NOT do**: 不修改 AstrBot 集成接口

  **Parallelization**: Wave 3
  **Blocked By**: 任务 5-10

  **Acceptance Criteria**:
  - [x] 无 git clone 命令
  - [x] 无 heredoc（RISKEOF/ASHAREEOF）
  - [x] 路径指向 fin-agent/

  **Commit**: NO

- [x] 13. 更新 install.bat

  **What to do**: 基于原始 bat 更新路径，保存到 `fin-agent/scripts/install.bat`

  **Parallelization**: Wave 3, 与任务 12 并行
  **Blocked By**: 任务 5-10

  **Acceptance Criteria**:
  - [x] install.bat 存在
  - [x] 路径指向新结构

  **Commit**: NO

- [x] 14. 创建 README.md

   **What to do**: 创建根目录 README.md，包含项目简介、目录结构、安装方式、环境变量配置

   **Parallelization**: Wave 3
   **Blocked By**: 任务 5-10

   **Acceptance Criteria**:
   - [x] README.md 存在且非空
   **Commit**: NO

---

## Phase 5: 清理与最终验证

- [x] 15. 清理旧目录和文件

  **What to do**:
  - 确认所有源码已成功迁移到 `fin-agent/` 后，清理旧结构：
    - 删除 `mcp_servers/` 目录（源码已全部整合到 fin-agent/mcp-servers/）
    - 删除 `download/fin-agent-mcp-server/`（已移到 fin-agent/mcp-server/）
    - 删除 `download/fin-agent-skill/`（已移到 fin-agent/skill/）
    - 删除 `download/sec-edgar-mcp/`（已整合到 fin-agent/mcp-servers/sec-edgar/）
    - 删除根目录下的乱码 .md 文件
    - 删除 `download/fin-agent-astrbot-install.sh` 和 `.bat`（已移到 fin-agent/scripts/）
    - 删除 `download/generate_architecture_pdf.py`
  - **保留** `download/` 目录本身（可能还有 .claude 等配置）

  **Must NOT do**:
  - 不移除 download/.claude/（可能有 AstrBot 配置）
  - 不移除 download/.github/（CI 配置，如有需要可移到根目录）
  - 不移除 .omo/（当前工作目录配置）

  **Parallelization**: Wave 3
  **Blocked By**: 任务 5-10

  **Acceptance Criteria**:
  - [x] mcp_servers/ 目录已删除
  - [x] download/ 下只剩配置文件（.claude 等）
  - [x] 根目录乱码 .md 文件已删除

  **Commit**: NO

- [x] 16. 验证 Git 历史完整性

  **What to do**:
  - 执行关键验证命令：
  ```bash
  git log --oneline -20
  git log --oneline --all | wc -l
  git remote -v
  git status
  ```
  - 确认 history 包含原始 `download/` 的提交记录
  - 确认远程仓库指向 `github.com/ATRI2233/fin-agent.git`
  - 确认工作区干净（没有意外新增的 node_modules 等）

  **Must NOT do**: 不执行任何修改 git 历史的操作

  **Parallelization**: Wave 3
  **Blocked By**: 任务 15

  **Acceptance Criteria**:
  - [x] `git log --oneline -1` 能显示最终提交
  - [x] `git remote -v` 指向 ATRI2233/fin-agent.git
  - [x] `git status` 显示工作区干净
  - [ ] `git log --oneline -1` 能显示最终提交
  - [ ] `git remote -v` 指向 ATRI2233/fin-agent.git
  - [ ] `git status` 显示工作区干净（或只有预期的新增文件）

  **Commit**: NO

---

## Final Verification Wave

- [x] F1. **计划合规审计** ✅ APPROVE — 所有 Must Have 已实现

- [x] F2. **构建验证** ✅ APPROVE — Node.js 模块依赖安装成功，Python 文件语法验证通过

- [x] F3. **路径一致性检查** ✅ APPROVE — 所有路径指向 fin-agent/，无旧路径引用

- [x] F4. **.gitignore 合规检查** ✅ APPROVE — .gitignore 配置完整，git status 无应排除文件被追踪

---

## 提交策略

- [x] 22. 最终提交 — 统一提交所有重构变更

  **What to do**:
  - 执行 `git add .`（确认 .gitignore 已生效）
  - 执行 `git status` 检查待提交文件列表
  - 提交信息格式：
    ```
    refactor: 整合 MCP Servers 为统一 Monorepo 结构

    - 迁移 git 仓库到项目根目录，保留完整历史
    - 创建 fin-agent/ 统一目录管理所有 MCP 服务器
    - 整合 FRED MCP、sec-edgar MCP、ashare MCP、risk MCP 源码
    - 提取 Python MCP 为独立 .py 文件（从 shell heredoc 中分离）
    - 更新安装脚本适配新路径
    - 配置 .gitignore 排除 node_modules/ 等依赖目录
    - 清理旧目录结构
    ```

  **Must NOT do**: 不要使用 `--force` 推送

  **Parallelization**: 必须在所有任务完成后执行
  **Blocked By**: 任务 1-16 全部完成

  **Acceptance Criteria**:
  - [x] `git status` 显示预期的变更文件
  - [x] `git commit` 成功

---

## Success Criteria

### 验证命令
```bash
# 1. Git 历史
git log --oneline -5

# 2. 目录结构
Get-ChildItem fin-agent -Recurse -Directory | Select-Object FullName

# 3. 关键文件存在性
Test-Path fin-agent/mcp-server/src/index.ts
Test-Path fin-agent/skill/SKILL.md
Test-Path fin-agent/mcp-servers/fred/package.json
Test-Path fin-agent/mcp-servers/ashare/ashare_mcp_server.py
Test-Path fin-agent/mcp-servers/risk/risk_mcp_server.py
Test-Path fin-agent/mcp-servers/sec-edgar/pyproject.toml
Test-Path ".gitignore"

# 4. .gitignore 效果
git status --short | Select-String "node_modules"

# 5. 安装脚本语法验证
bash -n fin-agent/scripts/install.sh
```

### 最终检查清单
- [ ] git 历史完整（包含原始 download/ 提交记录）
- [ ] 所有 MCP 服务器源码在 fin-agent/ 中
- [ ] 没有 node_modules/build/dist 被 git 追踪
- [ ] 安装脚本路径指向新结构
- [ ] Python MCP 为独立文件
- [ ] 旧目录已清理
- [ ] 安装脚本中无 heredoc 代码
- [ ] README.md 存在并描述项目结构
