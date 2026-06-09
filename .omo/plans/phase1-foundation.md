# PHASE 1: 鍩虹寤鸿涓庡畨鍏ㄧ綉 - 瀹屾暣鎵ц璁″垝

> **椤圭洰**: fin-agent (閲戣瀺鍒嗘瀽澶欰gent绯荤粺)
> **闃舵**: PHASE 1 - 鍩虹寤鸿涓庡畨鍏ㄧ綉 (3鍛?
> **鍩虹**: PHASE1.md 璇︾粏瑙勫垝 + Metis 椋庨櫓鍒嗘瀽

---

## TL;DR

> **Quick Summary**: 鎵ц fin-agent PHASE 1 瀹屾暣閲嶆瀯 - 寤虹珛娴嬭瘯瀹夊叏缃戙€佷慨澶?SQLite 骞跺彂闂銆佹瀯寤?Repository 鏁版嵁璁块棶灞傘€佹秷闄?37 澶勬暎钀界殑 SessionLocal() 璋冪敤銆佸畬鎴?DI 瀹瑰櫒钀藉湴銆?>
> **Deliverables**:
> - 10-15 涓泦鎴愭祴璇曪紙瀹夊叏缃戯級
> - SQLite WAL 妯″紡 + busy_timeout
> - BaseRepository[T] 娉涘瀷鍩虹被 + 5 涓鍩?Repository
> - config/ 閰嶇疆灞傦紙settings/constants/database锛?> - DI 瀹瑰櫒澧炲己锛坰ingleton/factory锛?> - 鑷姩鍖栭槻鎶ゅ伐鍏凤紙ruff, ESLint, pre-commit, 琛屾暟/鍒嗗眰妫€娴嬶級
> - 娑堥櫎鍏ㄩ儴 37 澶?SessionLocal() 璋冪敤锛?3涓枃浠讹級
> - 缁熶竴 Depends(get_db) 娉ㄥ叆
>
> **Estimated Effort**: Large (3 weeks / ~15-20 working days)
> **Parallel Execution**: YES - 5 waves, max 8 tasks per wave
> **Critical Path**: Wave 1 (configs) 鈫?Wave 2 (tests) 鈫?Wave 3 (data layer) 鈫?Wave 4 (migration) 鈫?Wave 5 (cleanup)

---

## Context

### Original Request
鐢ㄦ埛鎸囩ず"鑱氱劍PHASE 1"鈥斺€斿畬鏁存墽琛?`PHASE1.md` 鐨?鍛ㄥ熀纭€寤鸿璁″垝銆?
### Interview Summary
**Key Decisions (with defaults applied)**:
- 娴嬭瘯DB闅旂: 鍐呭瓨SQLite (`:memory:`) + 姣忔閲嶇疆schema 鈥?鏈€骞插噣锛岄伩鍏嶆薄鏌揹ev DB
- `data_maintenance`鑼冨洿: **INCLUDE**锛堜粎2澶勮皟鐢紝瀹屾暣鏀跺熬锛?- 鍚庡彴浠诲姟妯″紡缁熶竴: **DEFER to PHASE 2**锛堜笉鍦≒HASE 1鑼冨洿锛?- Container浣嶇疆: KEEP in `core/`锛堟棤闇€杩佺Щ锛?- `execution_repo` API: **PRESERVE backward compat**锛堜繚鐣?1涓柟娉曠鍚嶏級

**Metis Risk Findings Incorporated**:
- PHASE1.md 璇?2涓枃浠讹紝瀹為檯**13涓?*锛坄data_maintenance`琚仐婕忥級
- `execution_repo.py`涓巂BaseRepository[T]`璁捐**涓嶅吋瀹?*锛坄with self._sf() as db:`鍐呴儴绠＄悊妯″紡锛夆啋 Wave 3閲嶆瀯涓烘帴鏀禶db: Session`
- 4涓叏灞€鐘舵€佹ā寮忔湭鍦≒HASE1鏄惧紡鍒椾妇: `_engine_factory`, `_scheduler_instance`, `session_manager`, `configure()`
- `conversations.py:281`宓屽`db2 = SessionLocal()` 鈥?姝ｆ槸PHASE1瑕佽В鍐崇殑bug
- 7+ 澶?SessionLocal() 鍦?async/background context锛圖epends(get_db)涓嶅伐浣滐級鈫?浣跨敤 `get_session_factory()`

### Research Findings
- 鐜版湁 execution_repo.py 197琛岋紝11涓柟娉曪紝琚?`executions.py:83-88,161` 浣跨敤
- container.py 90琛岋紝浠呮敞鍐?`execution_repo`锛屾棤鍏朵粬 repo
- database.py 24琛?- 鍩虹宸叉湁锛岄渶鍔?WAL pragma
- config.py 42琛?- 鍩虹宸叉湁锛岄渶杩佺Щ鍒?config/

---

## Work Objectives

### Core Objective
鎵ц fin-agent PHASE 1 瀹屾暣閲嶆瀯锛堝熀纭€寤鸿涓庡畨鍏ㄧ綉锛夛紝寤虹珛娴嬭瘯瀹夊叏缃戯紝淇 SQLite 骞跺彂闂锛岃惤鍦?Repository 鏁版嵁璁块棶灞?+ DI 瀹瑰櫒锛屽垹闄?37 澶勬暎钀界殑 SessionLocal() 璋冪敤銆?
### Concrete Deliverables
- `tests/` 鐩綍锛坈onftest.py + 4涓泦鎴愭祴璇曟枃浠?+ unit/ 鐩綍锛?- `main/framework/config/`锛坰ettings.py, constants.py, database.py锛?- `main/framework/repositories/base.py`锛圔aseRepository[T]锛?- 5涓鍩?Repository锛坅gent, workflow, conversation, maintenance, execution-閲嶅啓锛?- `main/framework/services/unit_of_work.py`锛圲nitOfWork 妯″紡锛?- `pyproject.toml` + `.pre-commit-config.yaml`
- `webui/.eslintrc.json` + `scripts/check_lines.py` + `scripts/check_dependencies.py`
- 12涓牳蹇冩枃浠跺畬鎴?SessionLocal 鈫?Repository 杩佺Щ
- `data_maintenance/models/maintenance_db.py` 杩佺Щ

### Definition of Done
- [x] `grep -r "SessionLocal()" main/ --include="*.py"` 浠呭湪 `database.py` + `maintenance_db.py` 鐨?`_SessionLocal` 瀹氫箟
- [x] `pytest tests/integration/` 鍏ㄩ儴 10-15 涓祴璇曢€氳繃
- [x] `pytest tests/unit/` 鑷冲皯 30 涓祴璇曢€氳繃
- [x] `ruff check main/ webui/` 鏃犻敊璇?- [ ] `python scripts/check_lines.py` 鏃?500+ 琛屾枃浠?- [ ] `python scripts/check_dependencies.py` 0 violation
- [x] `PRAGMA journal_mode=WAL` 鍦ㄨ繍琛屾椂鐢熸晥
- [x] `git grep -n "configure(" main/` 杩斿洖 0 缁撴灉锛堥櫎 Container锛?- [ ] `git grep -n "_engine_factory\|_scheduler_instance\|session_manager" main/` 浠呭湪 Container 涓?
### Must Have
- 闆嗘垚娴嬭瘯 10-15 涓叏閮ㄩ€氳繃
- SQLite WAL 妯″紡鐢熸晥
- 5 涓?Repository 鍏ㄩ儴瀹炵幇骞跺彲鐙珛鍗曞厓娴嬭瘯
- 鎵€鏈?API 绔偣閫氳繃 `Depends(get_db)` 鑾峰彇鏁版嵁搴撲細璇?- `BaseRepository[T]` 娉涘瀷鍩虹被鍙疄渚嬪寲
- DI 瀹瑰櫒鏀寔 singleton / factory 娉ㄥ唽
- ruff + ESLint 瑙勫垯閰嶇疆瀹屾垚
- pre-commit hooks 鍙繍琛?
### Must NOT Have (Guardrails)
- 鉂?鎷嗗垎 conversations.py (PHASE 2 鍏虫敞)
- 鉂?鎷嗗垎 workflow_engine.py (PHASE 2 鍏虫敞)
- 鉂?鍒囨崲鍒?async DB 椹卞姩
- 鉂?寮曞叆 Alembic 鎴?schema migration 宸ュ叿
- 鉂?淇敼 webui/锛堥櫎娣诲姞 ESLint 閰嶇疆锛?- 鉂?淇敼 Conversation / Workflow / Execution / Agent model schemas
- 鉂?娣诲姞鏂扮鐐规垨淇敼鐜版湁鍝嶅簲缁撴瀯
- 鉂?淇敼 data_maintenance 涓氬姟閫昏緫锛堜粎 SessionLocal鈫抦aintenance_repo 杩佺Щ锛?- 鉂?缁曡繃 Container 鍒涘缓妯″潡绾?repo 瀹炰緥
- 鉂?鏀瑰彉 ExecutionRepository 11 涓柟娉曠鍚嶏紙鍚戝悗鍏煎锛?
---

## Verification Strategy (MANDATORY)

> **ZERO HUMAN INTERVENTION** - ALL verification is agent-executed.

### Test Decision
- **Infrastructure exists**: NO (闇€浠庡ご鍒涘缓)
- **Automated tests**: **TDD** (Wave 2 鍏堝啓娴嬭瘯瑕嗙洊褰撳墠浠ｇ爜浣滀负瀹夊叏缃? Wave 3 鍐嶄负鏂?Repository 鍐欏崟鍏冩祴璇?
- **Framework**: pytest + pytest-asyncio (浠?PHASE1.md 鍐崇瓥)
- **Test DB**: 鍐呭瓨SQLite (`:memory:`) + 姣忔祴璇?class 閲嶅缓 schema

### QA Policy
姣忎釜浠诲姟 MUST 鍖呭惈 agent-executed QA 鍦烘櫙锛岃瘉鎹繚瀛樺埌 `.omo/evidence/task-{N}-{scenario-slug}.{ext}`銆?- **Backend (API/DB)**: 浣跨敤 `bash` (curl) + `pytest` - 鍙戦€佽姹? 鏂█鐘舵€佺爜 + 鍝嶅簲瀛楁
- **Python module**: 浣跨敤 `python -c "..."` 瀵煎叆楠岃瘉
- **WAL mode**: 杩炴帴鍒?sqlite, 鏂█ `PRAGMA journal_mode` 杩斿洖 `wal`
- **Configs**: 瑙ｆ瀽 TOML/YAML/JSON 楠岃瘉璇硶

---

## Execution Strategy

### Git Checkpoint Strategy (MANDATORY 鈥?Per-Wave + Per-Step)

> **鐢ㄦ埛瑕佹眰**: "姣忎竴涓獁ave鎴栬€呮楠ら兘瑕乬it瀛樻。" 鈥?浠讳綍涓柇鍚庡彲浠?git 鍘嗗彶鎭㈠
> **瀹炵幇**: 姣忎釜 Step (Task) 鍗曟 commit + 姣忎釜 Wave 瀹屾垚鍚?checkpoint commit + lightweight tag
> **楠岃瘉**: 姣忎釜 Wave 寮€濮嬪墠蹇呴』 `git status` 骞插噣, 瀹屾垚鍚庡繀椤?`git status` 骞插噣

**Pre-Flight Task 0 (Wave 0): Git Baseline Setup** 鈥?鍦?Wave 1 寮€濮嬪墠蹇呴』瀹屾垚:
- 楠岃瘉 git 鍦?PATH 涓紙Windows 鐜闇€鐢?`C:\Program Files\Git\bin\git.exe` 鍏ㄨ矾寰勬垨鍔犲叆 PATH锛?- 澶勭悊鐜版湁 5 涓?uncommitted deletions (ARCHITECTURE_AUDIT.md 绛?
- 鍒涘缓鍒嗘敮 `phase1-foundation`锛堝熀浜?master锛?- 鏇存柊 `.gitignore` 鎺掗櫎 `.omo/drafts/`, `.omo/notepads/`, `.omo/run-continuation/`锛?*淇濈暀** `.omo/evidence/` 鍜?`.omo/plans/`
- Baseline commit 閿佸畾褰撳墠鐘舵€?
**Per-Task (Step) Git 鎿嶄綔**:
```
git add <specific files from task>
git commit -m "<conventional commit message from task>"
```
姣忎釜浠诲姟鏈夌嫭绔?`Commit: YES` + 鍏蜂綋 message (宸插湪姣忎釜 task 涓畾涔?

**Per-Wave Checkpoint** (鍦?Wave 鍏ㄩ儴浠诲姟瀹屾垚鍚庢墽琛?:
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

**Wave 澶辫触鎭㈠**:
```
# 鎭㈠鍒颁笂涓€涓?wave
git checkout phase1-wave-N-complete
# 鎴栨仮澶嶅埌涓婁竴涓?task
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
- **1-7** (Wave 1): no deps 鈫?run immediately in parallel
- **8-11** (Wave 2): depend on 5 (conftest) 鈫?run in parallel after Wave 1
- **12-19** (Wave 3): depend on 7 (BaseRepository) 鈫?run in parallel after Wave 1
- **20-31** (Wave 4): sequential, depend on previous Wave 4 task completion + all Wave 3
- **32-35** (Wave 5): depend on all Wave 4 鈫?run in parallel

---

## TODOs

> Implementation + Test = ONE Task. Never separate.
> **FORMAT**: Task labels MUST use bare numbers: `1.`, `2.`, `3.` 鈥?NOT `T1.`, `Task 1.`, `Phase 1:`.
> Final Verification Wave labels MUST use `F1.`, `F2.`, etc. 鈥?NOT `T-F1.`, `F-1.`, `Final 1.`.
> **A task WITHOUT QA Scenarios is INCOMPLETE. No exceptions.**

### Wave 0: Pre-Flight (1涓换鍔?- 闃诲鎵€鏈夊叾浠?Waves)

- [x] 0. **Git 鍩虹嚎璁剧疆锛圥ATH銆佸垎鏀€?gitignore銆乽ncommitted docs锛?*

  **What to do**:
  - **姝ラ A - 楠岃瘉/淇 git PATH**:
    - 妫€鏌?git 鏄惁鍦?PATH锛歚where git` 鎴?`git --version`
    - **Windows 鐜扮姸**: git 鍦?`C:\Program Files\Git\bin\git.exe` 浣嗕笉鍦?PATH
    - **淇鏂规 A1 (鎺ㄨ崘)**: 灏?`C:\Program Files\Git\bin` 鍔犲叆鐢ㄦ埛 PATH (PowerShell):
      ```powershell
      [Environment]::SetEnvironmentVariable("Path", $env:Path + ";C:\Program Files\Git\bin", "User")
      $env:Path = [System.Environment]::GetEnvironmentVariable("Path","User")
      ```
    - **淇鏂规 A2**: 鍦ㄦ墍鏈?git 鍛戒护涓娇鐢ㄥ畬鏁磋矾寰?`C:\Program Files\Git\bin\git.exe`
  - **姝ラ B - 鏇存柊 .gitignore (鍏抽敭淇)**:
    - **褰撳墠闂**: `.gitignore` 绗?70 琛?`.omo/` 鏁寸洰褰曡蹇界暐锛屽鑷?`.omo/plans/phase1-foundation.md` (鏈鍒? 鏃犳硶鎻愪氦
    - **淇鏂规**: 灏?`.omo/` 鏀逛负缁嗙矑搴﹁鍒?
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
  - **姝ラ C - 澶勭悊 5 涓?uncommitted deletions** (ARCHITECTURE_AUDIT.md, REFACTORING_BLUEPRINT.md, REFACTORING_BLUEPRINT_PART1.md, REFACTORING_BLUEPRINT_PART2.md, REFACTORING_BLUEPRINT_PART3.md):
    - 杩欎簺鏄?PHASE 1 璁″垝鍙栦唬鐨勬棫鏂囨。锛屽垹闄ゆ槸棰勬湡琛屼负
    - 鎵ц锛歚git rm ARCHITECTURE_AUDIT.md REFACTORING_BLUEPRINT.md REFACTORING_BLUEPRINT_PART1.md REFACTORING_BLUEPRINT_PART2.md REFACTORING_BLUEPRINT_PART3.md`
    - 鍗曠嫭 commit: `chore(docs): remove superseded architecture audit and refactoring blueprint`
  - **姝ラ D - 鎻愪氦 3 涓?untracked 鏂囨。** (PHASE1.md, PHASE2.md, PHASE3.md):
    - 杩欎簺鏄」鐩幇鏈夌殑闃舵鏂囨。锛堥」鐩牴鐩綍锛夛紝闇€璺熻釜
    - `git add PHASE1.md PHASE2.md PHASE3.md`
    - 鍗曠嫭 commit: `docs: add PHASE 1/2/3 refactoring plans`
  - **姝ラ E - 鍒涘缓 phase1-foundation 鍒嗘敮**:
    - `git checkout -b phase1-foundation` 锛堝熀浜庡綋鍓?master锛?  - **姝ラ F - Baseline commit + tag**:
    - `git add .gitignore`
    - `git commit -m "chore(git): add fine-grained .omo ignore rules (track plans/ and evidence/)"`
    - `git tag pre-phase1-baseline`
  - **姝ラ G - 楠岃瘉 clean state**:
    - `git status` 搴旇緭鍑?"nothing to commit, working tree clean"

  **Must NOT do**:
  - 涓嶅垹闄?`main/`, `webui/`, `agents/`, `data/` 浠讳綍鏂囦欢
  - 涓嶄慨鏀?PHASE1.md, PHASE2.md, PHASE3.md 鍐呭锛堜粎棣栨 add+commit锛?  - 涓嶅己鍒?push (鐢ㄦ埛鍙悗缁?push)
  - 涓嶉噸鍐?git 鍘嗗彶
  - 涓嶄慨鏀?.git/ 鍐呴儴鏂囦欢

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: `["git-master"]`
  - **Reason**: 7 姝ユ爣鍑?git 娴佺▼, 闇€璋ㄦ厧鎿嶄綔閬垮厤鐮村潖鐜版湁 repo

  **Parallelization**:
  - **Can Run In Parallel**: NO (闃诲鎵€鏈夊叾浠?Wave)
  - **Parallel Group**: Wave 0 (Sequential pre-flight)
  - **Blocks**: 鎵€鏈?Wave 1-5 + Final
  - **Blocked By**: None (蹇呴』鏄涓€涓换鍔?

  **References**:
  - `D:\github_place\fin-agent\.git` - 鐜版湁 .git 鐩綍
  - `D:\github_place\fin-agent\.gitignore` - 鐜版湁 .gitignore (绗?70 琛?`.omo/` 闇€鏀逛负缁嗙矑搴?
  - `C:\Program Files\Git\bin\git.exe` - Windows git 瀹屾暣璺緞

  **Acceptance Criteria**:
  - [ ] `git --version` 杈撳嚭鎴愬姛锛圥ATH 淇鍚庯級
  - [ ] `git branch --show-current` 杈撳嚭 "phase1-foundation"
  - [ ] `git tag --list | grep pre-phase1-baseline` 杈撳嚭 "pre-phase1-baseline"
  - [ ] `git status` 杈撳嚭 "nothing to commit, working tree clean"
  - [ ] `cat .gitignore` 鍖呭惈 `.omo/drafts/` 鍜?`!.omo/plans/` (un-ignore 鏍囪)
  - [ ] `git check-ignore -v .omo/plans/phase1-foundation.md` 杈撳嚭 "::" (琛ㄧず NOT ignored)
  - [ ] `git log --oneline -5` 鏄剧ず baseline 绯诲垪 commits

  **QA Scenarios (MANDATORY)**:
  ```
  Scenario: Git 鍦?PATH 涓伐浣?    Tool: Bash (git)
    Steps:
      1. git --version
      2. 鏂█杈撳嚭 = "git version 2.47.0.windows.1" (鎴栨洿鏂?
    Expected Result: 鍖呭惈 "git version"
    Failure Indicators: "鏃犳硶鎵惧埌" 鎴?"not recognized"
    Evidence: .omo/evidence/task-0-git-version.txt

  Scenario: 鍒嗘敮鍒涘缓鎴愬姛
    Tool: Bash (git)
    Steps:
      1. git branch --show-current
      2. 鏂█杈撳嚭 = "phase1-foundation"
    Expected Result: "phase1-foundation"
    Evidence: .omo/evidence/task-0-branch.txt

  Scenario: Baseline tag 鍒涘缓鎴愬姛
    Tool: Bash (git)
    Steps:
      1. git tag --list
      2. 鏂█鍖呭惈 "pre-phase1-baseline"
    Expected Result: 杈撳嚭鍖呭惈 "pre-phase1-baseline"
    Evidence: .omo/evidence/task-0-tag.txt

  Scenario: plans/ 涓嶅啀琚拷鐣?    Tool: Bash (git)
    Steps:
      1. git check-ignore -v .omo/plans/phase1-foundation.md
      2. 鏂█杈撳嚭浠?"::" 寮€澶达紙琛ㄧず NOT ignored锛?    Expected Result: ":: .omo/plans/phase1-foundation.md" (NOT ignored)
    Failure Indicators: ".gitignore:XX:.omo/" (still ignored)
    Evidence: .omo/evidence/task-0-plans-tracked.txt

  Scenario (Negative): Working tree 涓嶅共鍑€鏃舵姤閿?    Tool: Bash (git)
    Preconditions: 鏁呮剰淇敼鏂囦欢涓嶆彁浜?    Steps:
      1. echo "test" > D:\github_place\fin-agent\test_uncommitted.txt
      2. git status --porcelain
      3. 楠岃瘉鏈夎緭鍑?(涓嶆槸绌虹殑)
      4. rm D:\github_place\fin-agent\test_uncommitted.txt
    Expected Result: git status 鏄剧ず鏈窡韪枃浠?    Evidence: .omo/evidence/task-0-dirty-tree.txt
  ```

  **Commit**: YES
  - Message: `chore(git): phase1-foundation pre-flight baseline (PATH + .gitignore + branch + tag)`
  - Files: `.gitignore`
  - Pre-commit: `git status` clean

---

### Wave 1: Foundation (骞惰, 7涓换鍔?

- [x] 1. **pyproject.toml + pytest + ruff 閰嶇疆**

  **What to do**:
  - 鍒涘缓 `pyproject.toml`锛屽寘鍚細
    - `[project]` section: name="fin-agent", version="0.1.0", requires-python=">=3.11"
    - `[tool.pytest.ini_options]`: testpaths=["tests"], asyncio_mode="auto"
    - `[tool.ruff]`: line-length=120, max-lines=500
    - `[tool.ruff.lint]`: select=["E","W","F","C","I","N","UP"]
    - `[tool.ruff.lint.mccabe]`: max-complexity=10
  - 閿佸畾鏍稿績渚濊禆鐗堟湰锛堜粠 `requirements.txt` 璇诲彇锛?
  **Must NOT do**:
  - 涓嶄慨鏀?`requirements.txt`锛堜繚鎸佸悜鍚庡吋瀹癸級
  - 涓嶆坊鍔犳柊渚濊禆

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: `[]`
  - **Skills Evaluated but Omitted**: type-check (TDD 闃舵涓嶉渶瑕?
  - **Reason**: 閰嶇疆鏂囦欢鐢熸垚锛屽崟鏂囦欢鍗曟鍐欏叆

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1
  - **Blocks**: Wave 2 (conftest闇€瑕乸ytest閰嶇疆), Wave 3 (ruff妫€鏌ヤ唬鐮佽川閲?
  - **Blocked By**: None

  **References**:
  - `requirements.txt` - 褰撳墠渚濊禆鍒楄〃
  - `main/framework/config.py:21-35` - 椤圭洰璁剧疆缁撴瀯鍙傝€?  - PHASE1.md 搂2.4.2 (line 393-409) - ruff 瀹屾暣閰嶇疆绀轰緥

  **Acceptance Criteria**:
  - [ ] `python -c "import tomllib; tomllib.load(open('pyproject.toml','rb'))"` exit 0
  - [ ] `ruff check main/ --config pyproject.toml` exit 0 (鐜版湁浠ｇ爜涓嶆姤閿?
  - [ ] `pytest --collect-only tests/` exit 0 (鍗充娇tests/涓虹┖)

  **QA Scenarios (MANDATORY)**:
  ```
  Scenario: pyproject.toml 璇硶姝ｇ‘
    Tool: Bash (python)
    Steps:
      1. python -c "import tomllib; tomllib.load(open('pyproject.toml','rb'))"
      2. assert exit code == 0
    Expected Result: 鏃犺緭鍑猴紝exit 0
    Failure Indicators: tomllib.TOMLDecodeError
    Evidence: .omo/evidence/task-1-pyproject-valid.txt

  Scenario: ruff 涓嶄細瀵圭幇鏈変唬鐮佹姤閿?    Tool: Bash (ruff)
    Steps:
      1. ruff check main/ --config pyproject.toml
      2. 璁板綍杈撳嚭
    Expected Result: "All checks passed!"
    Failure Indicators: 浠讳綍 F/E 绾у埆閿欒
    Evidence: .omo/evidence/task-1-ruff-clean.txt
  ```

  **Commit**: YES
  - Message: `chore(infra): add pyproject.toml with pytest + ruff config`
  - Files: `pyproject.toml`
  - Pre-commit: `ruff check main/`

- [x] 2. **.pre-commit-config.yaml 閰嶇疆**

  **What to do**:
  - 鍒涘缓 `.pre-commit-config.yaml`锛屽寘鍚?4 涓?hook锛堜粎寮曠敤 Task 1/3 宸插垱寤虹殑宸ュ叿锛夛細
    - `check-file-lines` (寮曠敤 scripts/check_lines.py from Task 3)
    - `ruff-check` (寮曠敤 Task 1 鐨?ruff)
    - `eslint-check` (寮曠敤 Task 6 鐨?eslint)
    - `dependency-check` (寮曠敤 scripts/check_dependencies.py from Task 3)
  - 鍏ㄩ儴浣跨敤 `language: system` + `entry:` 鏈湴鍛戒护
  - 璁剧疆 `default_install_hook_types: [pre-commit]`

  **Must NOT do**:
  - 涓嶅畨瑁?pre-commit 妗嗘灦鏈韩锛堢敤鎴疯嚜琛?`pre-commit install`锛?  - 涓嶅湪 hook 涓墽琛屾祴璇?
  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: `[]`
  - **Reason**: 绾厤缃枃浠讹紝鏃犱笟鍔￠€昏緫

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1
  - **Blocks**: 鏃狅紙pre-commit 鐙珛杩愯锛?  - **Blocked By**: None (寮曠敤 Task 3 鐨勮剼鏈矾寰勶紝Task 3 瀹屾垚鍚庢墠鐢熸晥)

  **References**:
  - PHASE1.md 搂2.4.3 (line 411-441) - pre-commit 瀹屾暣閰嶇疆
  - scripts/check_lines.py (Task 3 浜х墿)
  - scripts/check_dependencies.py (Task 3 浜х墿)

  **Acceptance Criteria**:
  - [ ] `.pre-commit-config.yaml` 瀛樺湪
  - [ ] `python -c "import yaml; yaml.safe_load(open('.pre-commit-config.yaml'))"` exit 0
  - [ ] 鏂囦欢鍖呭惈 4 涓?hooks

  **QA Scenarios (MANDATORY)**:
  ```
  Scenario: pre-commit 閰嶇疆璇硶姝ｇ‘
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
  - 鍒涘缓 `scripts/` 鐩綍
  - 鍒涘缓 `scripts/check_lines.py`锛?    - 閬嶅巻 `main/` 鍜?`webui/src/` 涓嬫墍鏈?`.py`/`.ts`/`.tsx` 鏂囦欢
    - 鎺掗櫎 `node_modules`, `dist`, `.git`, `__pycache__`, `venv`, `data/`, `.opencode/node_modules`
    - 鏂囦欢 > 500 琛屾椂鎵撳嵃 `鉂?{path}: {lines} 琛?(瓒呰繃 500 琛岄檺鍒?` 骞惰繑鍥?1
    - 鍏ㄩ儴閫氳繃杩斿洖 0
  - 鍒涘缓 `scripts/check_dependencies.py`锛?    - 闈欐€?AST 鎵弿
    - 瑙勫垯1: `main/framework/api/` 涓嶅緱 `import` 鍖呭惈 `SessionLocal` 鐨勬ā鍧?    - 瑙勫垯2: `main/framework/core/` 涓嶅緱 `import` 鍖呭惈 `SessionLocal` 鐨勬ā鍧楋紙闄?database.py锛?    - 瑙勫垯3: 涓嶅緱璺ㄦā鍧楄闂鏈夋垚鍛橈紙`from main.x import _y`锛?    - 杩濊鏃舵墦鍗拌鎯呭苟杩斿洖 1

  **Must NOT do**:
  - 涓嶄慨鏀圭幇鏈変唬鐮?  - 涓嶆墽琛屽疄闄呮祴璇?
  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: `[]`
  - **Reason**: 宸ュ叿鑴氭湰锛屽崟娆″紑鍙?
  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1
  - **Blocks**: Task 2 (pre-commit 寮曠敤)
  - **Blocked By**: None

  **References**:
  - PHASE1.md 搂2.4.4 (line 443-474) - check_lines.py 瀹屾暣绀轰緥
  - PHASE1.md 搂2.4.5 (line 476-537) - check_dependencies.py 瀹屾暣绀轰緥
  - `main/framework/api/` 鍜?`main/framework/core/` 褰撳墠鏂囦欢鍒楄〃

  **Acceptance Criteria**:
  - [ ] `python scripts/check_lines.py` exit 0 (褰撳墠浠ｇ爜搴斿湪闄愬埗鍐?
  - [ ] `python scripts/check_dependencies.py` exit 0
  - [ ] 娴嬭瘯锛氭晠鎰忓垱寤?`test_overflow.py` 鍚?501 琛?鈫?check_lines.py 閫€鍑虹爜 1

  **QA Scenarios (MANDATORY)**:
  ```
  Scenario: 琛屾暟妫€鏌ュ櫒鑳借瘑鍒秴闀挎枃浠?    Tool: Bash (python)
    Preconditions: 鏃?    Steps:
      1. 鍒涘缓 /tmp/test_overflow.py 鍚?501 琛岋紙echo 'x' 寰幆 501 娆★級
      2. cp /tmp/test_overflow.py main/framework/test_overflow.py
      3. python scripts/check_lines.py
      4. 璁板綍 exit code锛堟湡鏈?1锛?      5. rm main/framework/test_overflow.py
    Expected Result: exit code = 1, 杈撳嚭鍖呭惈 "test_overflow.py: 501 琛?
    Evidence: .omo/evidence/task-3-line-check-fail.txt

  Scenario: 鍒嗗眰妫€娴嬪櫒鑳借瘑鍒繚瑙?    Tool: Bash (python)
    Preconditions: 鏃?    Steps:
      1. 鍒涘缓 main/framework/api/_test_violation.py 鍚?`from main.framework.models.database import SessionLocal`
      2. python scripts/check_dependencies.py
      3. 璁板綍 exit code锛堟湡鏈?1锛?      4. rm main/framework/api/_test_violation.py
    Expected Result: exit code = 1, 杈撳嚭鍖呭惈 "_test_violation.py" + "SessionLocal"
    Evidence: .omo/evidence/task-3-dep-check-fail.txt
  ```

  **Commit**: YES
  - Message: `chore(infra): add line/dependency check scripts`
  - Files: `scripts/check_lines.py`, `scripts/check_dependencies.py`

- [x] 4. **SQLite WAL 妯″紡鍦?database.py 钀藉湴**

  **What to do**:
  - 淇敼 `main/framework/models/database.py`锛?    - 娣诲姞 `@event.listens_for(engine, "connect")` 瑁呴グ鍣?    - 鍦?connect 浜嬩欢涓墽琛岋細`PRAGMA journal_mode=WAL`, `PRAGMA busy_timeout=5000`, `PRAGMA synchronous=NORMAL`
  - 鍚屾椂涓?`data_maintenance/models/maintenance_db.py` 娣诲姞鐩稿悓澶勭悊
  - 涓嶄慨鏀?`SessionLocal` 鎴?`get_db` 鍑芥暟绛惧悕

  **Must NOT do**:
  - 涓嶈縼绉诲埌 `config/database.py`锛堝睘 Task 12锛?  - 涓嶆敼 DATABASE_URL 榛樿鍊?
  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: `[]`
  - **Reason**: 鍗曟枃浠朵慨鏀? 5-10 琛屽彉鏇?
  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1
  - **Blocks**: Wave 2 (闆嗘垚娴嬭瘯闇€瑕乄AL)
  - **Blocked By**: None

  **References**:
  - PHASE1.md 搂1.3 (line 219-233) - WAL 妯″紡瀹屾暣瀹炵幇
  - `main/framework/models/database.py` (褰撳墠 24 琛?
  - `main/data_maintenance/models/maintenance_db.py:1-65` (闇€娣诲姞鐩稿悓澶勭悊)

  **Acceptance Criteria**:
  - [ ] `python -c "from main.framework.models.database import engine; conn=engine.connect(); print(conn.execute(__import__('sqlalchemy').text('PRAGMA journal_mode')).scalar())"` 杈撳嚭 "wal"
  - [ ] `python -c "from main.framework.models.database import engine; conn=engine.connect(); print(conn.execute(__import__('sqlalchemy').text('PRAGMA busy_timeout')).scalar())"` 杈撳嚭 鈮?000
  - [ ] 涓嶅奖鍝嶇幇鏈?app 鍚姩锛堟墜鍔ㄩ獙璇?start.bat锛?
  **QA Scenarios (MANDATORY)**:
  ```
  Scenario: WAL 妯″紡杩愯鏃剁敓鏁?    Tool: Bash (python -c)
    Preconditions: 鏃?    Steps:
      1. python -c "from main.framework.models.database import engine,SessionLocal; from sqlalchemy import text; s=SessionLocal(); print(s.execute(text('PRAGMA journal_mode')).scalar()); s.close()"
      2. 鏂█杈撳嚭 == "wal"
    Expected Result: stdout = "wal"
    Failure Indicators: stdout = "delete" 鎴栧叾浠?    Evidence: .omo/evidence/task-4-wal-mode.txt

  Scenario: busy_timeout 璁剧疆鐢熸晥
    Tool: Bash (python -c)
    Steps:
      1. python -c "from main.framework.models.database import engine,SessionLocal; from sqlalchemy import text; s=SessionLocal(); print(s.execute(text('PRAGMA busy_timeout')).scalar()); s.close()"
      2. 鏂█杈撳嚭 >= 5000
    Expected Result: stdout 鈮?5000
    Evidence: .omo/evidence/task-4-busy-timeout.txt

  Scenario: maintenance 鏁版嵁搴撳悓鏍峰惎鐢?WAL
    Tool: Bash (python -c)
    Steps:
      1. python -c "from main.data_maintenance.models.maintenance_db import engine,SessionLocal; from sqlalchemy import text; s=SessionLocal(); print(s.execute(text('PRAGMA journal_mode')).scalar()); s.close()"
      2. 鏂█杈撳嚭 == "wal"
    Expected Result: stdout = "wal"
    Evidence: .omo/evidence/task-4-wal-maintenance.txt
  ```

  **Commit**: YES
  - Message: `perf(db): enable SQLite WAL mode + busy_timeout`
  - Files: `main/framework/models/database.py`, `main/data_maintenance/models/maintenance_db.py`
  - Pre-commit: `python scripts/check_lines.py`

- [x] 5. **tests/conftest.py + 闅旂娴嬭瘯 DB fixture**

  **What to do**:
  - 鍒涘缓 `tests/conftest.py`锛屽寘鍚細
    - `pytest` fixtures:
      - `test_engine` (scope="session") - 鍐呭瓨 SQLite 寮曟搸锛屽惎鐢?WAL
      - `test_session_factory` (scope="session") - sessionmaker 缁戝畾 test_engine
      - `db_session` (scope="function") - 姣忔閲嶇疆 schema 骞?yield Session
      - `client` (scope="function") - httpx AsyncClient + FastAPI app with overridden get_db
    - 瑕嗙洊 `main.framework.models.database.get_db` 浣跨敤 test session
    - 瑕嗙洊 `main.framework.core.container.Container._instances` 浣跨敤 test config
  - 鍒涘缓 `tests/__init__.py` 鍜?`tests/integration/__init__.py`銆乣tests/unit/__init__.py` 绌烘枃浠?
  **Must NOT do**:
  - 涓嶅啓瀹為檯娴嬭瘯锛堝睘 Wave 2锛?  - 涓嶄慨鏀?conftest.py 涔嬪鐨勬祴璇曟枃浠?
  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: `[]`
  - **Reason**: pytest fixture 璁捐闇€瑕佺悊瑙?FastAPI 渚濊禆娉ㄥ叆, 澶氬眰瑕嗙洊

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1
  - **Blocks**: Wave 2 (闆嗘垚娴嬭瘯渚濊禆 fixtures)
  - **Blocked By**: None (fixtures 鏄柊寤烘枃浠?

  **References**:
  - PHASE1.md 搂1.1-1.2 (line 60-210) - 娴嬭瘯鐩綍缁撴瀯鍜岀ず渚?  - `main/framework/main.py` - FastAPI app 瀹炰緥浣嶇疆
  - `main/framework/models/database.py:15-20` - get_db 鍑芥暟瀹氫箟

  **Acceptance Criteria**:
  - [ ] `pytest --collect-only tests/` 杈撳嚭鏄剧ず fixtures
  - [ ] 娴嬭瘯 demo锛歚def test_demo(db_session): assert db_session is not None` 閫氳繃
  - [ ] 娴嬭瘯 demo锛歚def test_demo_client(client): r=await client.get("/"); assert r.status_code in [200,404]` 閫氳繃

  **QA Scenarios (MANDATORY)**:
  ```
  Scenario: pytest 鑳藉彂鐜?fixtures
    Tool: Bash (pytest)
    Steps:
      1. pytest --collect-only tests/ 2>&1 | head -20
      2. 纭鏃犻敊璇?    Expected Result: "no tests ran" 鎴?"X items collected"锛堟棤閿欒锛?    Evidence: .omo/evidence/task-5-pytest-collect.txt

  Scenario: db_session fixture 宸ヤ綔
    Tool: Bash (pytest)
    Steps:
      1. 鍒涘缓 /tmp/test_conftest_demo.py:
         from main.framework.models.database import Base
         def test_db_session_works(db_session):
             assert db_session is not None
             assert db_session.bind is not None
      2. cp 鍒?tests/integration/_demo.py
      3. pytest tests/integration/_demo.py -v
      4. 璁板綍缁撴灉
      5. rm tests/integration/_demo.py
    Expected Result: "1 passed"
    Evidence: .omo/evidence/task-5-db-session.txt

  Scenario: test DB 涓庣湡瀹?DB 闅旂
    Tool: Bash (sqlite3)
    Steps:
      1. 澶囦唤 data/finagent.db size: cp data/finagent.db /tmp/finagent_before.db
      2. 杩愯 db_session fixture 鍒涘缓琛?+ insert
      3. 瀵规瘮 data/finagent.db 涓?/tmp/finagent_before.db 澶у皬锛堝簲涓€鑷达級
      4. diff /tmp/finagent_before.db data/finagent.db
    Expected Result: 涓ゆ枃浠剁浉鍚岋紝diff 鏃犺緭鍑?    Evidence: .omo/evidence/task-5-db-isolated.txt
  ```

  **Commit**: YES
  - Message: `test(infrastructure): add conftest.py with isolated test DB`
  - Files: `tests/conftest.py`, `tests/__init__.py`, `tests/integration/__init__.py`, `tests/unit/__init__.py`
  - Pre-commit: `pytest --collect-only tests/`

- [x] 6. **webui/.eslintrc.json 閰嶇疆**

  **What to do**:
  - 鍒涘缓 `webui/.eslintrc.json`锛屽寘鍚細
    - `rules.max-lines`: error 500 (per file)
    - `rules.max-lines-per-function`: error 50
    - `rules.no-magic-numbers`: warn (ignore [0,1,-1,200,404,500])
    - `rules.no-restricted-imports`: error 绂佹 axios
    - `rules.no-restricted-syntax`: error 绂佹 CallExpression[callee.name='fetch']
  - 纭繚 webui 宸插畨瑁?ESLint锛堟鏌?webui/node_modules锛岃嫢鏃犲垯鐢?`npm install --save-dev eslint`锛?
  **Must NOT do**:
  - 涓嶄慨澶?ESLint 閿欒锛堜粎鍒涘缓閰嶇疆锛?  - 涓嶄慨鏀?webui/ 涓氬姟浠ｇ爜
  - 涓嶆坊鍔犳柊渚濊禆鍒?webui/package.json锛堥櫎 eslint锛?
  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: `[]`
  - **Reason**: 閰嶇疆鏂囦欢鍒涘缓

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1
  - **Blocks**: 鏃?  - **Blocked By**: None

  **References**:
  - PHASE1.md 搂2.4.1 (line 372-391) - ESLint 瀹屾暣閰嶇疆
  - `webui/package.json` - 褰撳墠渚濊禆
  - `webui/src/pages/WorkflowEditor.tsx` - 宸茬煡瓒呭ぇ鏂囦欢 (1563 琛岋紝棰勬湡 ESLint 閿欒)

  **Acceptance Criteria**:
  - [ ] `webui/.eslintrc.json` 瀛樺湪涓斾负鍚堟硶 JSON
  - [ ] `cd webui && npx eslint --print-config src/App.tsx` 杈撳嚭鍖呭惈 max-lines 瑙勫垯
  - [ ] 涓嶅奖鍝?webui 鍚姩 (`npm run build` 涓嶅己鍒惰姹?

  **QA Scenarios (MANDATORY)**:
  ```
  Scenario: ESLint 閰嶇疆 JSON 鍚堟硶
    Tool: Bash (python json)
    Steps:
      1. python -c "import json; cfg=json.load(open('webui/.eslintrc.json')); assert 'max-lines' in cfg['rules']"
      2. assert exit code == 0
    Expected Result: exit 0
    Evidence: .omo/evidence/task-6-eslintrc-valid.txt

  Scenario: ESLint 鑳借鍙栭厤缃?    Tool: Bash (npx eslint)
    Steps:
      1. cd webui && npx eslint --print-config src/App.tsx | python -c "import json,sys; cfg=json.load(sys.stdin); assert cfg['rules']['max-lines'][0]=='error'"
      2. assert exit code == 0
    Expected Result: exit 0
    Evidence: .omo/evidence/task-6-eslint-readable.txt
  ```

  **Commit**: YES
  - Message: `chore(webui): add ESLint config with size restrictions`
  - Files: `webui/.eslintrc.json` (and webui/package.json if eslint added)

- [x] 7. **BaseRepository[T] 娉涘瀷鍩虹被**

  **What to do**:
  - 鍒涘缓 `main/framework/repositories/base.py`锛屽疄鐜帮細
    - `class BaseRepository(Generic[T])`:
      - `__init__(self, model: Type[T], db: Session)` - 鎺ユ敹 db锛屼笉鍒涘缓
      - `get(self, id: str) -> Optional[T]`
      - `list(self, **filters) -> List[T]`
      - `create(self, **kwargs) -> T` - 涓?commit锛堣皟鐢ㄦ柟鎺у埗锛?      - `update(self, id: str, **kwargs) -> Optional[T]` - 涓?commit
      - `delete(self, id: str) -> bool` - 涓?commit
    - 鎺ユ敹 `db: Session` 鑰岄潪 `session_factory`锛堝叧閿喅绛栵級
    - 鏂囨。瀛楃涓茶鏄庝簨鍔″綊灞?  - 涓嶄慨鏀圭幇鏈?`execution_repo.py`锛堝睘 Task 17锛?
  **Must NOT do**:
  - 涓嶅紩鍏ユ柊鐨?ORM 妯″瀷
  - 涓嶅疄鐜板叿浣?Repository锛堝睘 Task 13-16锛?  - 涓嶅湪 BaseRepository 鍐呴儴 commit

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: `[]`
  - **Reason**: 娉涘瀷璁捐闇€鐞嗚В SQLAlchemy 浜嬪姟妯″瀷 + 鐜版湁 execution_repo 妯″紡

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1
  - **Blocks**: Wave 3 (鍏蜂綋 Repository 渚濊禆鍩虹被)
  - **Blocked By**: None (鐙珛鏂版枃浠?

  **References**:
  - PHASE1.md 搂2.3 (line 348-359) - BaseRepository 绠€鍖栫ず渚?  - PHASE1.md 搂1.6 (line 287-313) - UnitOfWork 涓婁笅鏂?  - `main/framework/repositories/execution_repo.py` - 鐜版湁妯″紡鍙傝€冿紙浣嗗唴閮?SessionLocal 妯″紡闇€鏀硅繘锛?
  **Acceptance Criteria**:
  - [ ] `python -c "from main.framework.repositories.base import BaseRepository; from main.framework.models.agent import Agent; br=BaseRepository(Agent, None); assert br is not None"` exit 0
  - [ ] 鏂囦欢 < 100 琛?  - [ ] ruff 閫氳繃

  **QA Scenarios (MANDATORY)**:
  ```
  Scenario: BaseRepository 鍙疄渚嬪寲
    Tool: Bash (python -c)
    Steps:
      1. python -c "from main.framework.repositories.base import BaseRepository; from main.framework.models.agent import Agent; br=BaseRepository(Agent, None); print(type(br).__name__)"
      2. 鏂█杈撳嚭 == "BaseRepository"
    Expected Result: "BaseRepository"
    Evidence: .omo/evidence/task-7-base-instantiable.txt

  Scenario: BaseRepository 鍦ㄥ唴瀛?DB 涓婂伐浣?    Tool: Bash (pytest)
    Steps:
      1. 鍒涘缓 tests/unit/_test_base.py:
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
      3. 娓呯悊
    Expected Result: "1 passed"
    Evidence: .omo/evidence/task-7-base-works.txt
  ```

  **Commit**: YES
  - Message: `feat(data): add BaseRepository[T] generic class`
  - Files: `main/framework/repositories/base.py`
  - Pre-commit: `python scripts/check_lines.py`

### Wave 2: Safety Net (骞惰, 4涓换鍔?- 鍦ㄥ綋鍓嶄唬鐮佷笂鍐欓泦鎴愭祴璇?

- [x] 8. **闆嗘垚娴嬭瘯: conversation flow**

  **What to do**:
  - 鍒涘缓 `tests/integration/test_conversation_flow.py`
  - 鑷冲皯 3 涓祴璇曠敤渚嬶紙PHASE1.md 搂1.1 瑕佹眰锛?
    - `test_create_conversation`: POST /api/v1/conversations/ 鈫?200, 杩斿洖 id
    - `test_send_agent_message`: 鍒涘缓瀵硅瘽 鈫?POST /messages (mode=agent) 鈫?杞 GET /messages 鏈€澶?60 绉?鈫?楠岃瘉 assistant 鍥炲
    - `test_list_messages`: 鍒涘缓瀵硅瘽 鈫?鍙戦€佹秷鎭?鈫?楠岃瘉娑堟伅鍒楄〃
  - 浣跨敤 `tests/conftest.py` 鐨?`client` 鍜?`db_session` fixtures
  - 鏍囪 `@pytest.mark.asyncio`

  **Must NOT do**:
  - 涓?mock OpenCode 鍚庣锛堜繚鎸佺湡瀹炶矾寰勶級
  - 涓嶄慨鏀?conftest.py

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: `[]`
  - **Reason**: 寮傛 API 娴嬭瘯闇€鐞嗚В httpx AsyncClient + FastAPI 杞

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2
  - **Blocks**: Wave 4 (杩佺Щ conversation.py 鏃朵綔涓哄洖褰掓祴璇?
  - **Blocked By**: Task 5 (conftest.py)

  **References**:
  - PHASE1.md 搂1.1 (line 74-115) - 瀹屾暣娴嬭瘯浠ｇ爜绀轰緥
  - `main/framework/api/conversations.py:364-609` - API 绔偣瀹氫箟
  - `tests/conftest.py` - 鍏变韩 fixtures

  **Acceptance Criteria**:
  - [ ] `pytest tests/integration/test_conversation_flow.py -v` 3 passed
  - [ ] 鍏ㄩ儴娴嬭瘯鍦?60 绉掑唴瀹屾垚
  - [ ] 涓嶄慨鏀圭敓浜т唬鐮?
  **QA Scenarios (MANDATORY)**:
  ```
  Scenario: 鍒涘缓瀵硅瘽绔偣宸ヤ綔
    Tool: Bash (pytest)
    Steps:
      1. pytest tests/integration/test_conversation_flow.py::test_create_conversation -v
      2. 璁板綍杈撳嚭
    Expected Result: "1 passed"
    Failure Indicators: 500 閿欒, timeout
    Evidence: .omo/evidence/task-8-create-conv.txt

  Scenario: 瀹屾暣娴佺▼锛堝垱寤?娑堟伅+鍥炲锛?    Tool: Bash (pytest)
    Steps:
      1. pytest tests/integration/test_conversation_flow.py -v --tb=short
      2. 鏂█鎵€鏈?3 娴嬭瘯閫氳繃
    Expected Result: "3 passed"
    Evidence: .omo/evidence/task-8-conv-all.txt
  ```

  **Commit**: YES
  - Message: `test(integration): add conversation flow safety net`
  - Files: `tests/integration/test_conversation_flow.py`
  - Pre-commit: `pytest tests/integration/test_conversation_flow.py`

- [x] 9. **闆嗘垚娴嬭瘯: workflow flow**

  **What to do**:
  - 鍒涘缓 `tests/integration/test_workflow_flow.py`
  - 鑷冲皯 3 涓祴璇曠敤渚?
    - `test_create_and_execute_workflow`: POST /api/v1/workflows/ 鈫?200, 瑙﹀彂鎵ц 鈫?杞 GET /executions/{id} 鈫?楠岃瘉 completed
    - `test_list_workflows`: 鍒涘缓鍚?鈫?GET /workflows/ 楠岃瘉瀛樺湪
    - `test_workflow_with_parallel_nodes`: 鍒涘缓鍚苟琛岃妭鐐圭殑宸ヤ綔娴?鈫?瑙﹀彂 鈫?楠岃瘉澶氫釜鑺傜偣瀹屾垚
  - 浣跨敤 conftest fixtures

  **Must NOT do**:
  - 涓嶄慨鏀?workflow_engine.py
  - 涓嶈烦杩囦换浣曟祴璇曪紙鍗充娇鎱級

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: `[]`
  - **Reason**: 宸ヤ綔娴佹祴璇曢渶鐞嗚В DAG 鎷撴墤鍜屽苟琛屾墽琛?
  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2
  - **Blocks**: Wave 4 (workflow_engine.py 杩佺Щ鏃朵綔涓哄洖褰掓祴璇?
  - **Blocked By**: Task 5

  **References**:
  - PHASE1.md 搂1.1 (line 116-145) - workflow 娴嬭瘯绀轰緥
  - `main/framework/api/workflows.py` - 宸ヤ綔娴佺鐐?  - `main/framework/api/executions.py` - 鎵ц鏌ヨ绔偣

  **Acceptance Criteria**:
  - [ ] `pytest tests/integration/test_workflow_flow.py -v` 3 passed
  - [ ] 宸ヤ綔娴佸垱寤哄埌鎵ц瀹屾垚 < 120 绉?
  **QA Scenarios (MANDATORY)**:
  ```
  Scenario: 宸ヤ綔娴佸垱寤?鎵ц瀹屾垚
    Tool: Bash (pytest)
    Steps:
      1. pytest tests/integration/test_workflow_flow.py -v --tb=short
      2. 鏂█ 3 passed
    Expected Result: "3 passed"
    Evidence: .omo/evidence/task-9-workflow-all.txt
  ```

  **Commit**: YES
  - Message: `test(integration): add workflow flow safety net`
  - Files: `tests/integration/test_workflow_flow.py`

- [x] 10. **闆嗘垚娴嬭瘯: scheduled workflow**

  **What to do**:
  - 鍒涘缓 `tests/integration/test_scheduled_workflow.py`
  - 鑷冲皯 2 涓祴璇曠敤渚?
    - `test_schedule_workflow`: 鍒涘缓宸ヤ綔娴?鈫?POST /workflows/{id}/schedule (cron="0 9 * * 1-5") 鈫?GET /workflows/scheduled 楠岃瘉瀛樺湪
    - `test_manual_trigger_scheduled`: 璋冨害宸ヤ綔娴?鈫?POST /workflows/{id}/trigger 鎵嬪姩瑙﹀彂 鈫?楠岃瘉鎵ц寮€濮?  - 涓嶇瓑寰呭疄闄?cron 瑙﹀彂锛堢敤 manual_trigger 楠岃瘉閫昏緫锛?
  **Must NOT do**:
  - 涓嶅疄闄呯瓑寰?cron 鏃堕棿锛堥伩鍏嶆祴璇曡秴闀匡級
  - 涓嶄慨鏀?APScheduler 閰嶇疆

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: `[]`
  - **Reason**: 璋冨害娴嬭瘯闇€鐞嗚В APScheduler 鍜?mock 鏃堕棿

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2
  - **Blocks**: Wave 4 (scheduler.py 杩佺Щ鏃跺洖褰?
  - **Blocked By**: Task 5

  **References**:
  - PHASE1.md 搂1.1 (line 147-163) - scheduled 娴嬭瘯绀轰緥
  - `main/framework/api/scheduler_routes.py` - 璋冨害 API
  - `main/framework/core/scheduler.py` - APScheduler 闆嗘垚

  **Acceptance Criteria**:
  - [ ] `pytest tests/integration/test_scheduled_workflow.py -v` 2 passed
  - [ ] 璋冨害鍒涘缓鍒板垪鍑?< 5 绉?
  **QA Scenarios (MANDATORY)**:
  ```
  Scenario: 瀹氭椂宸ヤ綔娴佽皟搴?鍒楀嚭
    Tool: Bash (pytest)
    Steps:
      1. pytest tests/integration/test_scheduled_workflow.py -v --tb=short
      2. 鏂█ 2 passed
    Expected Result: "2 passed"
    Evidence: .omo/evidence/task-10-scheduled-all.txt
  ```

  **Commit**: YES
  - Message: `test(integration): add scheduled workflow safety net`
  - Files: `tests/integration/test_scheduled_workflow.py`

- [x] 11. **闆嗘垚娴嬭瘯: dispatch flow**

  **What to do**:
  - 鍒涘缓 `tests/integration/test_dispatch_flow.py`
  - 鑷冲皯 2 涓祴璇曠敤渚?
    - `test_sync_dispatch`: POST /api/v1/dispatch/sync (agent="macro-scout", prompt="...") 鈫?200, 楠岃瘉 response
    - `test_parallel_dispatch`: POST /api/v1/dispatch/parallel (agents=["a","b"], prompt="...") 鈫?200, 楠岃瘉澶氱粨鏋?  - 浣跨敤 conftest client

  **Must NOT do**:
  - 涓?mock OpenCode
  - 涓嶄慨鏀?dispatch.py

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: `[]`
  - **Reason**: Agent 璋冨害娴嬭瘯闇€鐞嗚В鍚屾/骞惰妯″紡

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2
  - **Blocks**: Wave 4 (dispatch 璺緞杩佺Щ鏃跺洖褰?
  - **Blocked By**: Task 5

  **References**:
  - `main/framework/api/dispatch.py` - dispatch 绔偣
  - `main/framework/core/agent_dispatcher.py` - 璋冨害鍣?
  **Acceptance Criteria**:
  - [ ] `pytest tests/integration/test_dispatch_flow.py -v` 2 passed
  - [ ] sync dispatch < 30 绉?  - [ ] parallel dispatch < 60 绉?
  **QA Scenarios (MANDATORY)**:
  ```
  Scenario: 鍚屾鍜屽苟琛?Agent 璋冨害
    Tool: Bash (pytest)
    Steps:
      1. pytest tests/integration/test_dispatch_flow.py -v --tb=short
      2. 鏂█ 2 passed
    Expected Result: "2 passed"
    Evidence: .omo/evidence/task-11-dispatch-all.txt
  ```

  **Commit**: YES
  - Message: `test(integration): add dispatch flow safety net`
  - Files: `tests/integration/test_dispatch_flow.py`

### Wave 3: Data Layer Build (骞惰, 8涓换鍔?- 浠呮柊寤烘枃浠?

- [x] 12. **config/ 鐩綍杩佺Щ锛坰ettings/constants/database锛?*

  **What to do**:
  - 鍒涘缓 `main/framework/config/` 鍖咃紙`__init__.py`锛?  - 鍒涘缓 `main/framework/config/settings.py`:
    - 浠?`main/framework/config.py` 杩佺Щ `Settings` 绫诲拰 `_find_opencode_bin`
    - 淇濇寔 `Settings` 瀛楁涓嶅彉
  - 鍒涘缓 `main/framework/config/constants.py`:
    - 鎻愬彇涓氬姟甯搁噺锛歚MAX_AGENT_RETRIES=3`, `DEFAULT_TIMEOUT=300`, `MAX_NODES_PER_WORKFLOW=20` 绛?    - 浠庢暎钀戒唬鐮侊紙workflow_engine.py, scheduler.py, etc.锛変腑璇嗗埆榄旀硶鏁板瓧
  - 鍒涘缓 `main/framework/config/database.py`:
    - 浠?`main/framework/models/database.py` 杩佺Щ `engine`, `SessionLocal`, `Base`, `get_db`, `init_db`
    - 淇濇寔 Task 4 娣诲姞鐨?WAL pragma
  - 娣诲姞 deprecation comment 鍒板師 `main/framework/config.py` 鎸囧悜鏂颁綅缃?  - 娣诲姞 compatibility re-export 鍒板師 `main/framework/models/database.py` 鎸囧悜鏂颁綅缃?  - **涓嶅垹闄?*鍘熸枃浠讹紙閬垮厤鐮村潖鐜版湁瀵煎叆锛夛紝閫氳繃 re-export 淇濇寔鍚戝悗鍏煎

  **Must NOT do**:
  - 涓嶅垹闄?`main/framework/config.py` 鎴?`main/framework/models/database.py`
  - 涓嶄慨鏀?Settings 瀛楁鍚?  - 涓嶆敼鍙?DATABASE_URL 榛樿鍊?
  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: `[]`
  - **Reason**: 澶氭枃浠惰縼绉婚渶璇嗗埆鎵€鏈夊紩鐢ㄥ苟淇濇寔鍏煎

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3
  - **Blocks**: Wave 4 (杩佺Щ鏂囦欢闇€瑕佹柊鐨?settings 璺緞)
  - **Blocked By**: None (鏂版枃浠?+ re-export)

  **References**:
  - PHASE1.md 搂2.1 (line 319-325) - config/ 鐩綍缁撴瀯
  - `main/framework/config.py:1-42` - 鐜版湁 Settings
  - `main/framework/models/database.py:1-24` - 鐜版湁 database 妯″潡

  **Acceptance Criteria**:
  - [ ] `python -c "from main.framework.config.settings import settings; assert settings.API_PORT==8000"` exit 0
  - [ ] `python -c "from main.framework.config.database import SessionLocal, get_db, Base; assert callable(get_db)"` exit 0
  - [ ] `python -c "from main.framework.config.constants import MAX_AGENT_RETRIES; assert isinstance(MAX_AGENT_RETRIES, int)"` exit 0
  - [ ] 鏃ц矾寰?`from main.framework.config import Settings` 浠嶅伐浣滐紙re-export锛?  - [ ] 鏃ц矾寰?`from main.framework.models.database import SessionLocal` 浠嶅伐浣滐紙re-export锛?
  **QA Scenarios (MANDATORY)**:
  ```
  Scenario: 鏂?config 璺緞鍙鍏?    Tool: Bash (python -c)
    Steps:
      1. python -c "from main.framework.config.settings import settings; from main.framework.config.database import SessionLocal, get_db, Base; from main.framework.config.constants import MAX_AGENT_RETRIES; print('OK')"
      2. 鏂█杈撳嚭 = "OK"
    Expected Result: "OK"
    Evidence: .omo/evidence/task-12-new-config.txt

  Scenario: 鏃?config 璺緞浠嶅吋瀹?    Tool: Bash (python -c)
    Steps:
      1. python -c "from main.framework.config import Settings; from main.framework.models.database import SessionLocal; print('OK')"
      2. 鏂█杈撳嚭 = "OK"
    Expected Result: "OK"锛堥獙璇?re-export 宸ヤ綔锛?    Evidence: .omo/evidence/task-12-legacy-compat.txt
  ```

  **Commit**: YES
  - Message: `refactor(config): migrate to config/ package with backward compat`
  - Files: `main/framework/config/__init__.py`, `main/framework/config/settings.py`, `main/framework/config/constants.py`, `main/framework/config/database.py`
  - Pre-commit: `python scripts/check_lines.py && ruff check main/framework/config/`

- [x] 13. **AgentRepository 瀹炵幇**

  **What to do**:
  - 鍒涘缓 `main/framework/repositories/agent_repo.py`
  - 瀹炵幇 `class AgentRepository(BaseRepository[Agent])`:
    - 缁ф壙 `BaseRepository`锛堝熀绫绘帴鏀?db via constructor锛?    - 棰濆鏂规硶锛歚get_by_name(name: str) -> Optional[Agent]`, `list_by_provider(provider: str) -> List[Agent]`
    - 涓嶅唴閮?commit
  - 鍒涘缓 `tests/unit/test_agent_repository.py`:
    - 5+ 鍗曞厓娴嬭瘯: test_create, test_get, test_list, test_update, test_get_by_name, test_list_by_provider
  - 浣跨敤鍐呭瓨 SQLite + 閲嶇疆 schema

  **Must NOT do**:
  - 涓嶅垱寤烘柊 Agent 妯″瀷
  - 涓嶄慨鏀?models/agent.py

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: `[]`
  - **Reason**: 鏍囧噯 CRUD + 绠€鍗曟煡璇㈡柟娉?
  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3
  - **Blocks**: Task 18 (Container 娉ㄥ唽)
  - **Blocked By**: Task 7 (BaseRepository)

  **References**:
  - `main/framework/models/agent.py` - Agent 妯″瀷
  - `main/framework/repositories/base.py` (Task 7 浜х墿) - 缁ф壙鐨勫熀绫?  - `main/framework/repositories/execution_repo.py` - 鐜版湁 Repository 椋庢牸鍙傝€?
  **Acceptance Criteria**:
  - [ ] `pytest tests/unit/test_agent_repository.py -v` 6+ passed
  - [ ] `python -c "from main.framework.repositories.agent_repo import AgentRepository; print('OK')"` exit 0
  - [ ] AgentRepository 鎺ユ敹 db via constructor

  **QA Scenarios (MANDATORY)**:
  ```
  Scenario: AgentRepository 鍗曞厓娴嬭瘯閫氳繃
    Tool: Bash (pytest)
    Steps:
      1. pytest tests/unit/test_agent_repository.py -v --tb=short
      2. 鏂█ 6+ passed
    Expected Result: "6 passed" 鎴栨洿澶?    Evidence: .omo/evidence/task-13-agent-repo.txt
  ```

  **Commit**: YES
  - Message: `feat(data): add AgentRepository with unit tests`
  - Files: `main/framework/repositories/agent_repo.py`, `tests/unit/test_agent_repository.py`
  - Pre-commit: `python scripts/check_lines.py`

- [x] 14. **WorkflowRepository 瀹炵幇**

  **What to do**:
  - 鍒涘缓 `main/framework/repositories/workflow_repo.py`
  - 瀹炵幇 `class WorkflowRepository(BaseRepository[Workflow])`:
    - 缁ф壙 BaseRepository
    - 棰濆鏂规硶锛歚list_active() -> List[Workflow]`, `get_by_name(name)`, `set_active(workflow_id, active: bool)`
  - 鍒涘缓 `tests/unit/test_workflow_repository.py` (5+ 娴嬭瘯)

  **Must NOT do**:
  - 涓嶅垱寤烘柊 Workflow 妯″瀷
  - 涓嶄慨鏀?models/workflow.py

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: `[]`
  - **Reason**: 鏍囧噯 CRUD + 涓氬姟鏌ヨ

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3
  - **Blocks**: Task 18
  - **Blocked By**: Task 7

  **References**:
  - `main/framework/models/workflow.py` - Workflow 妯″瀷
  - `main/framework/repositories/base.py` (Task 7)

  **Acceptance Criteria**:
  - [ ] `pytest tests/unit/test_workflow_repository.py -v` 5+ passed

  **QA Scenarios (MANDATORY)**:
  ```
  Scenario: WorkflowRepository 鍗曞厓娴嬭瘯閫氳繃
    Tool: Bash (pytest)
    Steps:
      1. pytest tests/unit/test_workflow_repository.py -v --tb=short
    Expected Result: "5 passed" 鎴栨洿澶?    Evidence: .omo/evidence/task-14-workflow-repo.txt
  ```

  **Commit**: YES
  - Message: `feat(data): add WorkflowRepository with unit tests`
  - Files: `main/framework/repositories/workflow_repo.py`, `tests/unit/test_workflow_repository.py`

- [x] 15. **ConversationRepository 瀹炵幇**

  **What to do**:
  - 鍒涘缓 `main/framework/repositories/conversation_repo.py`
  - 瀹炵幇 `class ConversationRepository(BaseRepository[Conversation])`:
    - 棰濆鏂规硶锛歚add_message(conv_id, role, content) -> Message`, `get_messages(conv_id) -> List[Message]`, `get_recent(limit=20)`, `delete_with_messages(conv_id) -> bool`
  - 鍖呭惈 Message 妯″瀷澶勭悊锛堝悓涓€鏂囦欢鎴栫嫭绔嬬被锛?  - 鍒涘缓 `tests/unit/test_conversation_repository.py` (8+ 娴嬭瘯)

  **Must NOT do**:
  - 涓嶅垱寤烘柊 Conversation/Message 妯″瀷
  - 涓嶄慨鏀?models/conversation.py

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: `[]`
  - **Reason**: 娑夊強涓や釜鍏宠仈妯″瀷 (Conversation + Message) 鐨勫叧绯绘搷浣?
  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3
  - **Blocks**: Task 18, Wave 4 (conversations.py 杩佺Щ)
  - **Blocked By**: Task 7

  **References**:
  - `main/framework/models/conversation.py` - Conversation + Message 妯″瀷
  - `main/framework/repositories/base.py` (Task 7)

  **Acceptance Criteria**:
  - [ ] `pytest tests/unit/test_conversation_repository.py -v` 8+ passed
  - [ ] add_message + get_messages 寰€杩斾竴鑷?
  **QA Scenarios (MANDATORY)**:
  ```
  Scenario: ConversationRepository 鍗曞厓娴嬭瘯
    Tool: Bash (pytest)
    Steps:
      1. pytest tests/unit/test_conversation_repository.py -v --tb=short
    Expected Result: "8 passed" 鎴栨洿澶?    Evidence: .omo/evidence/task-15-conv-repo.txt
  ```

  **Commit**: YES
  - Message: `feat(data): add ConversationRepository with unit tests`
  - Files: `main/framework/repositories/conversation_repo.py`, `tests/unit/test_conversation_repository.py`

- [x] 16. **MaintenanceRepository 瀹炵幇锛堢嫭绔?DB锛?*

  **What to do**:
  - 鍒涘缓 `main/data_maintenance/repositories/maintenance_repo.py`锛堟敞鎰忥細鍦?data_maintenance 瀛愮郴缁熶笅锛?  - 瀹炵幇 `class MaintenanceRepository`:
    - **涓?*缁ф壙 `BaseRepository`锛堝洜 MaintenanceBase 鐙珛浜庢鏋?Base锛?    - 鎺ユ敹 db: Session via constructor
    - 鏂规硶锛歚get_setting(key)`, `set_setting(key, value)`, `list_jobs() -> List[MaintenanceJob]`, `update_job_status(id, status, error=None)`
  - 鍒涘缓 `tests/unit/test_maintenance_repository.py` (4+ 娴嬭瘯)
  - 涓嶄慨鏀?`maintenance_db.py` 鐨?`_SessionLocal`锛堜繚鎸佸悜鍚庡吋瀹癸級

  **Must NOT do**:
  - 涓嶄慨鏀?MaintenanceBase 妯″瀷
  - 涓嶇粺涓€涓や釜鏁版嵁搴撶殑 Session锛圥HASE 1 淇濈暀鍙?DB 鏋舵瀯锛?  - 涓嶅湪 MaintenanceRepository 鍐呴儴 commit

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: `[]`
  - **Reason**: 绫讳技鍏朵粬 Repository锛屼絾鐙珛 DB 璺緞

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3
  - **Blocks**: Wave 4 (maintenance_db.py 杩佺Щ)
  - **Blocked By**: None (鐙珛瀛愮郴缁?

  **References**:
  - `main/data_maintenance/models/maintenance_db.py` - MaintenanceBase + 鐜版湁妯″瀷
  - PHASE1.md 搂3.1 maintenance_repo 瑙勮寖

  **Acceptance Criteria**:
  - [ ] `pytest tests/unit/test_maintenance_repository.py -v` 4+ passed
  - [ ] 鐙珛 DB 楠岃瘉: 娴嬭瘯 DB 涓庢鏋?DB 鍒嗙

  **QA Scenarios (MANDATORY)**:
  ```
  Scenario: MaintenanceRepository 鍗曞厓娴嬭瘯
    Tool: Bash (pytest)
    Steps:
      1. pytest tests/unit/test_maintenance_repository.py -v --tb=short
    Expected Result: "4 passed" 鎴栨洿澶?    Evidence: .omo/evidence/task-16-maint-repo.txt
  ```

  **Commit**: YES
  - Message: `feat(data): add MaintenanceRepository for data_maintenance subsystem`
  - Files: `main/data_maintenance/repositories/__init__.py`, `main/data_maintenance/repositories/maintenance_repo.py`, `tests/unit/test_maintenance_repository.py`

- [x] 17. **閲嶆瀯 execution_repo.py 缁ф壙 BaseRepository[T]锛堝悜鍚庡吋瀹癸級**

  **What to do**:
  - 淇敼 `main/framework/repositories/execution_repo.py`:
    - `ExecutionRepository` 鏀逛负缁ф壙 `BaseRepository` (鎴栫粍鍚?
    - **鍏抽敭**锛氫繚鐣?11 涓幇鏈夋柟娉曠鍚嶄笉鍙橈紙鍚戝悗鍏煎锛?    - **鍏抽敭**锛氫繚鐣?`__init__(self, session_factory=SessionLocal)` 鍙屾ā寮忥細
      - 榛樿妯″紡锛堟棤鍙傦級= 鏃ц涓猴紙鍐呴儴 SessionLocal锛?      - 娉ㄥ叆妯″紡锛堜紶 db 鎴?session_factory锛? 鏂拌涓?    - 鍐呴儴 `with self._sf() as db:` 妯″紡淇濈暀锛堥伩鍏嶇牬鍧忕幇鏈夎皟鐢ㄦ柟锛?  - 娣诲姞鏂版柟娉曪細`create_execution_v2(db: Session, **kwargs)` 鎺ユ敹澶栭儴 db
  - 涓嶄慨鏀?`executions.py`锛堝睘 Wave 4 Task 25锛?
  **Must NOT do**:
  - 涓嶅垹闄ょ幇鏈?11 涓柟娉?  - 涓嶆敼鍙樼幇鏈夋柟娉曠鍚?  - 涓嶅湪 Wave 3 淇敼 `executions.py`

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: `[]`
  - **Reason**: 鍏煎鎬ч噸鏋勶紝闇€淇濈暀涓ゅ API 鍚屾椂宸ヤ綔

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3
  - **Blocks**: Wave 4 (Task 25, 26, 27, 28, 29)
  - **Blocked By**: Task 7 (BaseRepository)

  **References**:
  - `main/framework/repositories/execution_repo.py:1-197` - 褰撳墠瀹炵幇
  - `main/framework/repositories/base.py` (Task 7 浜х墿)
  - `main/framework/api/executions.py:21` - 妯″潡绾?`repo = ExecutionRepository()` 璋冪敤

  **Acceptance Criteria**:
  - [ ] `pytest tests/integration/` 鍏ㄩ儴 10-15 娴嬭瘯浠嶉€氳繃锛堟棤 regression锛?  - [ ] 鐜版湁 11 涓柟娉曠鍚嶆湭鍙橈紙lsp_find_references 楠岃瘉锛?  - [ ] 鏂版柟娉?`create_execution_v2(db, ...)` 鍙嫭绔嬪崟鍏冩祴璇?  - [ ] 鏂囦欢 < 250 琛?
  **QA Scenarios (MANDATORY)**:
  ```
  Scenario: 鐜版湁闆嗘垚娴嬭瘯鏃?regression
    Tool: Bash (pytest)
    Steps:
      1. pytest tests/integration/ -v --tb=short
      2. 鏂█ 10-15 passed锛堜笌閲嶆瀯鍓嶄竴鑷达級
    Expected Result: "10-15 passed"
    Failure Indicators: 浠讳綍 FAIL 鎴?ERROR
    Evidence: .omo/evidence/task-17-no-regression.txt

  Scenario: 鏂?v2 鏂规硶鍙敤
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

- [x] 18. **Container 娉ㄥ唽鎵€鏈?5 涓?Repository**

  **What to do**:
  - 淇敼 `main/framework/core/container.py`:
    - 淇濈暀鐜版湁 `execution_repo` property锛堝悜鍚庡吋瀹癸級
    - 娣诲姞 `register_singleton(cls, instance)` 閫氱敤鏂规硶
    - 娣诲姞 `register_factory(cls, factory)` 閫氱敤鏂规硶
    - 娣诲姞鏂?properties: `agent_repo`, `workflow_repo`, `conversation_repo`, `maintenance_repo`
    - 鎵€鏈?new repos 鎺ュ彈鍙€?`db: Session` 鍙傛暟锛圢one 鏃剁敤 SessionLocal锛?  - **涓?*淇敼鐜版湁 backend / dispatcher / scheduler properties
  - 娣诲姞 `get_service(interface)` 鍑芥暟锛堝 PHASE1.md 搂2.2 绀轰緥锛変綔涓?FastAPI Depends 宸ュ巶

  **Must NOT do**:
  - 涓嶅垹闄?`execution_repo` property
  - 涓嶄慨鏀?backend/dispatcher 鍒涘缓閫昏緫
  - 涓嶅疄鐜拌嚜鍔ㄦ壂鎻忔敞鍐岋紙鎵嬪姩娉ㄥ唽 5 涓級

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: `[]`
  - **Reason**: DI 瀹瑰櫒澧炲己闇€鑰冭檻鍚戝悗鍏煎

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3
  - **Blocks**: Wave 4 鎵€鏈夎縼绉讳换鍔?  - **Blocked By**: Task 13, 14, 15, 16, 17 (鎵€鏈?Repository 蹇呴』鍏堝瓨鍦?

  **References**:
  - PHASE1.md 搂2.2 (line 327-345) - Container 澧炲己绀轰緥
  - `main/framework/core/container.py:1-90` - 鐜版湁瀹炵幇

  **Acceptance Criteria**:
  - [ ] `python -c "from main.framework.core.container import Container, get_service; from main.framework.repositories.agent_repo import AgentRepository; c=Container(...); assert c.agent_repo is not None"` exit 0
  - [ ] `python -c "from main.framework.core.container import get_service; dep=get_service(AgentRepository); assert callable(dep)"` exit 0
  - [ ] 鐜版湁 `container.execution_repo` 浠嶅伐浣?
  **QA Scenarios (MANDATORY)**:
  ```
  Scenario: Container 娉ㄥ唽 5 涓?Repository
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

  Scenario: get_service 宸ュ巶宸ヤ綔
    Tool: Bash (python -c)
    Steps:
      1. python -c "from main.framework.core.container import get_service; from main.framework.repositories.agent_repo import AgentRepository; dep=get_service(AgentRepository); assert callable(dep); print('OK')"
    Expected Result: "OK"
    Evidence: .omo/evidence/task-18-get-service.txt
  ```

  **Commit**: YES
  - Message: `feat(di): register all 5 Repositories in Container`
  - Files: `main/framework/core/container.py`

- [x] 19. **UnitOfWork 妯″紡锛堣法 Repository 浜嬪姟锛?*

  **What to do**:
  - 鍒涘缓 `main/framework/services/__init__.py`锛堟柊鍖咃級
  - 鍒涘缓 `main/framework/services/unit_of_work.py`:
    - 瀹炵幇 `class UnitOfWork`:
      - `__init__(self, db: Session = None)` - 榛樿浠?SessionLocal 鑾峰彇
      - `__enter__` / `__exit__` 绠＄悊浜嬪姟
      - `repository(name, model)` 鎳掑姞杞界紦瀛?repos
    - 閬靛惊 PHASE1.md 搂1.6 绀轰緥
  - 鍒涘缓 `tests/unit/test_unit_of_work.py` (3+ 娴嬭瘯)
    - test_commit_on_success
    - test_rollback_on_exception
    - test_cross_repo_transaction

  **Must NOT do**:
  - 涓嶅湪 UnitOfWork 鍐?commit 鍗曚釜 repo 鎿嶄綔
  - 涓嶅疄鐜板叿浣撲笟鍔?Service锛堝睘 PHASE 2锛?
  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: `[]`
  - **Reason**: 鏍囧噯 UoW 妯″紡, PHASE1.md 鏈夊畬鏁寸ず渚?
  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3
  - **Blocks**: Wave 4 (杩佺Щ鏃?UoW 鐢ㄤ簬璺?repo 鎿嶄綔)
  - **Blocked By**: None (鐙珛鏂版枃浠?

  **References**:
  - PHASE1.md 搂1.6 (line 287-313) - UnitOfWork 瀹屾暣绀轰緥
  - `main/framework/repositories/base.py` (Task 7)

  **Acceptance Criteria**:
  - [ ] `pytest tests/unit/test_unit_of_work.py -v` 3+ passed
  - [ ] 寮傚父鏃?rollback, 鎴愬姛鏃?commit

  **QA Scenarios (MANDATORY)**:
  ```
  Scenario: UnitOfWork 浜嬪姟绠＄悊
    Tool: Bash (pytest)
    Steps:
      1. pytest tests/unit/test_unit_of_work.py -v --tb=short
    Expected Result: "3 passed"
    Evidence: .omo/evidence/task-19-uow.txt
  ```

  **Commit**: YES
  - Message: `feat(data): add UnitOfWork for cross-Repository transactions`
  - Files: `main/framework/services/__init__.py`, `main/framework/services/unit_of_work.py`, `tests/unit/test_unit_of_work.py`

### Wave 4: Migration (椤哄簭鎵ц, 12涓换鍔?- 鎸夎€﹀悎搴︿粠浣庡埌楂?

> **鍏抽敭**: Wave 4 浠诲姟**蹇呴』鎸夐『搴?*鎵ц銆傛瘡涓縼绉诲彲鑳芥毚闇茶法鏂囦欢闂銆?> 姣忎釜浠诲姟瀹屾垚鍚庡繀椤婚€氳繃 `pytest tests/integration/` 楠岃瘉鏃?regression銆?
- [x] 20. **杩佺Щ agents.py (1 澶?SessionLocal)**

  **What to do**:
  - 淇敼 `main/framework/api/agents.py`:
    - 鍒犻櫎 1 澶?`SessionLocal()` 璋冪敤
    - 鏀圭敤 `Depends(get_service(AgentRepository))`
    - 绔偣鍑芥暟绛惧悕鍔?`repo: AgentRepository = Depends(get_service(AgentRepository))`
  - 琛屼负瀹屽叏涓嶅彉锛堥噸鏋勯潪鍔熻兘淇敼锛?
  **Must NOT do**:
  - 涓嶄慨鏀?Agent 妯″瀷
  - 涓嶆敼鍙?API 鍝嶅簲鏍煎紡

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: `[]`
  - **Reason**: 1 澶勮皟鐢紝鏈€浣庡鏉傚害

  **Parallelization**:
  - **Can Run In Parallel**: NO (Wave 4 椤哄簭)
  - **Parallel Group**: Wave 4 (Sequential, position 1)
  - **Blocks**: Task 21+ (鍚庣画杩佺Щ)
  - **Blocked By**: Task 18 (Container 娉ㄥ唽 AgentRepository)

  **References**:
  - `main/framework/api/agents.py` - 褰撳墠瀹炵幇
  - `main/framework/repositories/agent_repo.py` (Task 13)
  - `main/framework/core/container.py:get_service` (Task 18)

  **Acceptance Criteria**:
  - [ ] `pytest tests/integration/ -v` 鍏ㄩ儴閫氳繃 (鏃?regression)
  - [ ] `grep "SessionLocal" main/framework/api/agents.py` 浠呭湪 import (鏃犺皟鐢?
  - [ ] Agent 鍒楄〃/璇︽儏绔偣姝ｅ父宸ヤ綔

  **QA Scenarios (MANDATORY)**:
  ```
  Scenario: agents.py 杩佺Щ鍚庢棤 regression
    Tool: Bash (pytest)
    Preconditions: Task 8-11 闆嗘垚娴嬭瘯宸查€氳繃
    Steps:
      1. pytest tests/integration/ -v --tb=short
      2. 鏂█ 10-15 passed
    Expected Result: 鍏ㄩ儴閫氳繃
    Evidence: .omo/evidence/task-20-agents-no-regress.txt

  Scenario: SessionLocal 宸蹭粠 agents.py 绉婚櫎
    Tool: Bash (grep)
    Steps:
      1. grep -n "SessionLocal" main/framework/api/agents.py
      2. 楠岃瘉鏃?`SessionLocal()` 璋冪敤锛堜粎鍙兘 import锛?    Expected Result: 鏃?`SessionLocal()` 璋冪敤
    Evidence: .omo/evidence/task-20-agents-grep.txt
  ```

  **Commit**: YES
  - Message: `refactor(api): migrate agents.py to AgentRepository`
  - Files: `main/framework/api/agents.py`
  - Pre-commit: `pytest tests/integration/`

- [x] 21. **杩佺Щ system.py (1 澶?SessionLocal)**

  **What to do**:
  - 淇敼 `main/framework/api/system.py`:
    - 鍒犻櫎 1 澶?`SessionLocal()` (閫氬父鏄粺璁℃煡璇?
    - 鏀圭敤鍚堥€傜殑 Repository 鎴栦繚鐣?`Depends(get_db)`
  - 绔偣琛屼负涓嶅彉

  **Must NOT do**:
  - 涓嶄慨鏀圭郴缁熺姸鎬佸瓧娈?
  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: `[]`

  **Parallelization**:
  - **Can Run In Parallel**: NO (Wave 4 椤哄簭)
  - **Parallel Group**: Wave 4 (position 2)
  - **Blocked By**: Task 20

  **References**:
  - `main/framework/api/system.py` - 褰撳墠瀹炵幇

  **Acceptance Criteria**:
  - [ ] `pytest tests/integration/ -v` 鍏ㄩ儴閫氳繃
  - [ ] `grep "SessionLocal()" main/framework/api/system.py` exit 1 (no match)

  **QA Scenarios (MANDATORY)**:
  ```
  Scenario: system.py 杩佺Щ鍚庢棤 regression
    Tool: Bash (pytest)
    Steps:
      1. pytest tests/integration/ -v --tb=short
    Expected Result: 鍏ㄩ儴閫氳繃
    Evidence: .omo/evidence/task-21-system-no-regress.txt
  ```

  **Commit**: YES
  - Message: `refactor(api): migrate system.py to Repository pattern`
  - Files: `main/framework/api/system.py`

- [x] 22. **杩佺Щ performance.py (2 澶?SessionLocal)**

  **What to do**:
  - 淇敼 `main/framework/core/performance.py`:
    - 鍒犻櫎 2 澶?`SessionLocal()` (鎬ц兘璁℃暟鍣ㄥ啓鍏?
    - 鏀圭敤 `Depends(get_db)` 鎴栨瀯閫犳敞鍏?  - 淇濇寔鎬ц兘鎸囨爣琛屼负

  **Must NOT do**:
  - 涓嶄慨鏀规€ц兘鎸囨爣璇箟

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
  - [ ] `pytest tests/integration/ -v` 鍏ㄩ儴閫氳繃

  **QA Scenarios (MANDATORY)**:
  ```
  Scenario: performance.py 杩佺Щ鍚庢棤 regression
    Tool: Bash (pytest)
    Steps:
      1. pytest tests/integration/ -v --tb=short
    Expected Result: 鍏ㄩ儴閫氳繃
    Evidence: .omo/evidence/task-22-perf-no-regress.txt
  ```

  **Commit**: YES
  - Message: `refactor(core): migrate performance.py to Depends`
  - Files: `main/framework/core/performance.py`

- [x] 23. **杩佺Щ sessions.py (4 澶?SessionLocal)**

  **What to do**:
  - 淇敼 `main/framework/api/sessions.py`:
    - 鍒犻櫎 4 澶?`SessionLocal()` (鍙鏌ヨ ExecutionNode, Conversation)
    - 鏀圭敤 `Depends(get_service(ExecutionRepository))` 鍜?`Depends(get_service(ConversationRepository))`

  **Must NOT do**:
  - 涓嶄慨鏀?API 鍝嶅簲鏍煎紡

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
  - [ ] `pytest tests/integration/ -v` 鍏ㄩ儴閫氳繃
  - [ ] `grep "SessionLocal()" main/framework/api/sessions.py` exit 1

  **QA Scenarios (MANDATORY)**:
  ```
  Scenario: sessions.py 杩佺Щ鍚庢棤 regression
    Tool: Bash (pytest)
    Steps:
      1. pytest tests/integration/ -v --tb=short
    Expected Result: 鍏ㄩ儴閫氳繃
    Evidence: .omo/evidence/task-23-sessions-no-regress.txt
  ```

  **Commit**: YES
  - Message: `refactor(api): migrate sessions.py to ExecutionRepository + ConversationRepository`
  - Files: `main/framework/api/sessions.py`

- [x] 24. **杩佺Щ triggers.py (6 澶?SessionLocal)**

  **What to do**:
  - 淇敼 `main/framework/api/triggers.py`:
    - 鍒犻櫎 6 澶?`SessionLocal()` 璋冪敤
    - 鏀圭敤 `Depends(get_service(WorkflowRepository))` 鍜?`Depends(get_service(ExecutionRepository))`
    - 淇濈暀 `BackgroundTasks` 鎴?`asyncio.create_task` 妯″紡锛圥HASE 1 涓嶇粺涓€鍚庡彴浠诲姟锛?    - 鍚庡彴浠诲姟浣跨敤 `get_session_factory()` (Task 12 鎻愪緵鐨勫伐鍘傚嚱鏁?
  - 瑙﹀彂閫昏緫琛屼负涓嶅彉

  **Must NOT do**:
  - 涓嶆敼鍙?trigger 瑙﹀彂閫昏緫
  - 涓嶅疄鐜板悗鍙颁换鍔＄粺涓€锛圥HASE 2锛?
  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: `[]`
  - **Reason**: 6 澶勮皟鐢?+ 鍚庡彴浠诲姟妯″紡

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 4 (position 5)
  - **Blocked By**: Task 23

  **References**:
  - `main/framework/api/triggers.py` (6 澶?
  - `main/framework/repositories/workflow_repo.py` (Task 14)

  **Acceptance Criteria**:
  - [ ] `pytest tests/integration/ -v` 鍏ㄩ儴閫氳繃
  - [ ] `grep "SessionLocal()" main/framework/api/triggers.py` exit 1

  **QA Scenarios (MANDATORY)**:
  ```
  Scenario: triggers.py 杩佺Щ鍚庢棤 regression
    Tool: Bash (pytest)
    Steps:
      1. pytest tests/integration/ -v --tb=short
    Expected Result: 鍏ㄩ儴閫氳繃
    Evidence: .omo/evidence/task-24-triggers-no-regress.txt
  ```

  **Commit**: YES
  - Message: `refactor(api): migrate triggers.py to WorkflowRepository`
  - Files: `main/framework/api/triggers.py`

- [x] 25. **杩佺Щ executions.py (6 澶?SessionLocal) - 绉婚櫎妯″潡绾?repo**

  **What to do**:
  - 淇敼 `main/framework/api/executions.py`:
    - 鍒犻櫎 6 澶?`SessionLocal()` 璋冪敤
    - **鍏抽敭**锛氬垹闄ゆā鍧楃骇 `repo = ExecutionRepository()` (line 21)
    - 鏀圭敤 `Depends(get_service(ExecutionRepository))`
    - 淇濈暀鎵€鏈夌幇鏈?ExecutionRepository 鏂规硶璋冪敤
  - 杩欐槸鍚戠函 DI 杩囨浮鐨勫叧閿竴姝?
  **Must NOT do**:
  - 涓嶄慨鏀?ExecutionRepository 鐜版湁 11 涓柟娉曠鍚?  - 涓嶆敼鍙?API 琛屼负

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: `[]`
  - **Reason**: 绉婚櫎妯″潡绾у崟渚嬫槸鏋舵瀯鍏抽敭杞彉

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 4 (position 6)
  - **Blocked By**: Task 24, Task 17 (鍚戝悗鍏煎 ExecutionRepository)

  **References**:
  - `main/framework/api/executions.py:21` - 妯″潡绾?repo 瀹炰緥
  - `main/framework/repositories/execution_repo.py` (Task 17)
  - `main/framework/core/container.py:get_service` (Task 18)

  **Acceptance Criteria**:
  - [ ] `pytest tests/integration/ -v` 鍏ㄩ儴閫氳繃
  - [ ] `grep -n "^repo = ExecutionRepository" main/framework/api/executions.py` exit 1 (鏃犲尮閰?
  - [ ] `grep "SessionLocal()" main/framework/api/executions.py` exit 1

  **QA Scenarios (MANDATORY)**:
  ```
  Scenario: executions.py 杩佺Щ鍚庢棤 regression
    Tool: Bash (pytest)
    Steps:
      1. pytest tests/integration/ -v --tb=short
    Expected Result: 鍏ㄩ儴閫氳繃
    Evidence: .omo/evidence/task-25-exec-no-regress.txt

  Scenario: 妯″潡绾?repo 宸茬Щ闄?    Tool: Bash (grep)
    Steps:
      1. grep -n "^repo = ExecutionRepository\|^repo=ExecutionRepository" main/framework/api/executions.py
      2. 鏂█鏃犺緭鍑?    Expected Result: 鏃犺緭鍑?    Evidence: .omo/evidence/task-25-no-module-repo.txt
  ```

  **Commit**: YES
  - Message: `refactor(api): migrate executions.py to ExecutionRepository (remove module-level repo)`
  - Files: `main/framework/api/executions.py`

- [x] 26. **杩佺Щ retry_handler.py (2 澶?SessionLocal)**

  **What to do**:
  - 淇敼 `main/framework/core/retry_handler.py`:
    - 鍒犻櫎 2 澶?`SessionLocal()`
    - 鏀圭敤 `Depends(get_service(ExecutionRepository))` 鎴栨瀯閫犳敞鍏?
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
  - [ ] `pytest tests/integration/ -v` 鍏ㄩ儴閫氳繃

  **QA Scenarios (MANDATORY)**:
  ```
  Scenario: retry_handler.py 杩佺Щ鍚庢棤 regression
    Tool: Bash (pytest)
    Steps:
      1. pytest tests/integration/ -v --tb=short
    Expected Result: 鍏ㄩ儴閫氳繃
    Evidence: .omo/evidence/task-26-retry-no-regress.txt
  ```

  **Commit**: YES
  - Message: `refactor(core): migrate retry_handler.py to ExecutionRepository`
  - Files: `main/framework/core/retry_handler.py`

- [x] 27. **杩佺Щ session_cleanup.py (2 澶?SessionLocal)**

  **What to do**:
  - 淇敼 `main/framework/core/session_cleanup.py`:
    - 鍒犻櫎 2 澶?`SessionLocal()`
    - 鍒犻櫎 `configure(backend)` 鍑芥暟 (PHASE 1 鍏ㄥ眬鐘舵€佹竻鐞?
    - 鏀圭敤 Container 娉ㄥ叆

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: `[]`

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 4 (position 8)
  - **Blocked By**: Task 26

  **References**:
  - `main/framework/core/session_cleanup.py`
  - `main/framework/core/container.py:backend` property (Task 18 淇濈暀)

  **Acceptance Criteria**:
  - [ ] `pytest tests/integration/ -v` 鍏ㄩ儴閫氳繃
  - [ ] `grep "configure(" main/framework/core/session_cleanup.py` exit 1 (闄?Container)

  **QA Scenarios (MANDATORY)**:
  ```
  Scenario: session_cleanup.py 杩佺Щ鍚庢棤 regression
    Tool: Bash (pytest)
    Steps:
      1. pytest tests/integration/ -v --tb=short
    Expected Result: 鍏ㄩ儴閫氳繃
    Evidence: .omo/evidence/task-27-cleanup-no-regress.txt
  ```

  **Commit**: YES
  - Message: `refactor(core): migrate session_cleanup.py (remove configure global)`
  - Files: `main/framework/core/session_cleanup.py`

- [x] 28. **杩佺Щ scheduler.py (4 澶?SessionLocal) - 绉婚櫎 _engine_factory 鍏ㄥ眬**

  **What to do**:
  - 淇敼 `main/framework/core/scheduler.py`:
    - 鍒犻櫎 4 澶?`SessionLocal()`
    - **鍏抽敭**锛氬垹闄ゆā鍧楃骇 `_engine_factory` 鍏ㄥ眬鍙橀噺
    - **鍏抽敭**锛氬垹闄ゆā鍧楃骇 `_scheduler_instance` 鍏ㄥ眬鍙橀噺锛堝鏋滃湪锛?    - `WorkflowScheduler` 鏀逛负閫氳繃 Container 鍒涘缓 (宸插湪 container.create_scheduler)
    - 鏀逛负 `Depends(get_service(WorkflowRepository))` 鍜?`Depends(get_service(ExecutionRepository))`
    - `add_job(run_scheduled_workflow, ...)` 鏀逛负娉ㄥ唽 Container 鏂规硶
  - APScheduler 琛屼负涓嶅彉

  **Must NOT do**:
  - 涓嶄慨鏀?APScheduler 閰嶇疆
  - 涓嶆敼鍙?cron 瑙ｆ瀽閫昏緫

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: `[]`
  - **Reason**: 鍏ㄥ眬鐘舵€?+ APScheduler 闆嗘垚澶嶆潅

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 4 (position 9)
  - **Blocked By**: Task 27

  **References**:
  - `main/framework/core/scheduler.py:20` (`_engine_factory`), line 87 (`add_job`)
  - `main/framework/core/container.py:78-84` (`create_scheduler`)
  - `main/framework/repositories/workflow_repo.py`, `execution_repo.py`

  **Acceptance Criteria**:
  - [ ] `pytest tests/integration/ -v` 鍏ㄩ儴閫氳繃
  - [ ] `pytest tests/integration/test_scheduled_workflow.py` 2 passed (Task 10)
  - [ ] `grep "_engine_factory\|_scheduler_instance" main/framework/core/scheduler.py` exit 1

  **QA Scenarios (MANDATORY)**:
  ```
  Scenario: scheduler.py 杩佺Щ鍚庢棤 regression
    Tool: Bash (pytest)
    Steps:
      1. pytest tests/integration/ -v --tb=short
      2. 閲嶇偣楠岃瘉 test_scheduled_workflow.py
    Expected Result: 鍏ㄩ儴閫氳繃
    Evidence: .omo/evidence/task-28-sched-no-regress.txt

  Scenario: _engine_factory 鍏ㄥ眬宸茬Щ闄?    Tool: Bash (grep)
    Steps:
      1. grep -n "_engine_factory" main/framework/core/scheduler.py
      2. 鏂█鏃犺緭鍑?    Expected Result: 鏃犺緭鍑?    Evidence: .omo/evidence/task-28-no-factory-global.txt
  ```

  **Commit**: YES
  - Message: `refactor(core): migrate scheduler.py (remove _engine_factory global)`
  - Files: `main/framework/core/scheduler.py`

- [x] 29. **杩佺Щ workflow_engine.py (3 澶?SessionLocal) - engine session lifecycle**

  **What to do**:
  - 淇敼 `main/framework/core/workflow_engine.py`:
    - 鍒犻櫎 3 澶勭嫭绔?`SessionLocal()` (execute, execute_node, handle_failure)
    - **鍏抽敭鍐崇瓥**: 閫夋嫨 session lifecycle锛?      - 閫夐」A: `WorkflowEngine.__init__` 鎺ユ敹 `db: Session`锛屾暣涓墽琛屽鐢?      - 閫夐」B: 姣忎釜鏂规硶鐙珛 session (鏀圭敤 SessionLocal via Container)
    - 鎺ㄨ崘閫夐」A (璺ㄦ柟娉曚簨鍔′竴鑷存€?
    - 鎺ユ敹 `repo: ExecutionRepository` via Container
  - 鏆傛椂淇濈暀 `db.expire_all()` workarounds (Task 32 娓呯悊)

  **Must NOT do**:
  - 涓嶆媶鍒?execute_node (PHASE 2 鍏虫敞)
  - 涓嶆敼鍙?DAG 鎵ц琛屼负

  **Recommended Agent Profile**:
  - **Category**: `deep`
  - **Skills**: `[]`
  - **Reason**: 涓夐噸 session + 寮傛鏂规硶 + DAG 鐘舵€佺鐞? 闇€璋ㄦ厧璁捐

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 4 (position 10)
  - **Blocked By**: Task 28, Task 17 (ExecutionRepository v2)

  **References**:
  - `main/framework/core/workflow_engine.py:65,285,453` - 涓夊 SessionLocal
  - `main/framework/repositories/execution_repo.py` (Task 17 v2 鏂规硶)
  - `main/framework/core/container.py:create_workflow_engine` (Task 18 淇濈暀)

  **Acceptance Criteria**:
  - [ ] `pytest tests/integration/ -v` 鍏ㄩ儴閫氳繃
  - [ ] `pytest tests/integration/test_workflow_flow.py` 3 passed (Task 9)
  - [ ] `grep "SessionLocal()" main/framework/core/workflow_engine.py` exit 1
  - [ ] 鏂囦欢 < 350 琛岋紙鐩爣 300 琛? 鎺ュ彈鑷?350锛?
  **QA Scenarios (MANDATORY)**:
  ```
  Scenario: workflow_engine.py 杩佺Щ鍚庢棤 regression
    Tool: Bash (pytest)
    Steps:
      1. pytest tests/integration/ -v --tb=short
      2. 閲嶇偣楠岃瘉 test_workflow_flow.py
    Expected Result: 鍏ㄩ儴閫氳繃
    Evidence: .omo/evidence/task-29-engine-no-regress.txt

  Scenario: SessionLocal 宸茬Щ闄?    Tool: Bash (grep)
    Steps:
      1. grep -n "SessionLocal()" main/framework/core/workflow_engine.py
      2. 鏂█鏃犺緭鍑?    Expected Result: 鏃犺緭鍑?    Evidence: .omo/evidence/task-29-no-sessionlocal.txt
  ```

  **Commit**: YES
  - Message: `refactor(core): migrate workflow_engine.py to shared db session`
  - Files: `main/framework/core/workflow_engine.py`
  - Pre-commit: `pytest tests/integration/ && python scripts/check_lines.py`

- [x] 30. **杩佺Щ conversations.py (3+1 宓屽 SessionLocal) - 绉婚櫎 session_manager + 宓屽 db2**

  **What to do**:
  - 淇敼 `main/framework/api/conversations.py`:
    - 鍒犻櫎 3 澶?`SessionLocal()` + 1 澶?`db2 = SessionLocal()` (line 281 宓屽)
    - **鍏抽敭**锛氬垹闄ゆā鍧楃骇 `session_manager` 鍏ㄥ眬
    - 鏀圭敤 `Depends(get_service(ConversationRepository))` 鍜?`Depends(get_service(ExecutionRepository))`
    - 鍚庡彴浠诲姟 (`BackgroundTasks` 鎴?`asyncio.create_task`) 浣跨敤 `get_session_factory()` (Task 12)
    - 淇濈暀 `ConvSessionManager` 绫伙紝浣嗛€氳繃 ConversationService 绠＄悊锛堜笉鍏ㄥ眬锛?  - 杩欐槸鏈€澶嶆潅鐨勮縼绉?
  **Must NOT do**:
  - 涓嶆媶鍒?conversations.py (PHASE 2 鍏虫敞)
  - 涓嶆敼鍙樺璇濆垱寤?娑堟伅 API 琛屼负
  - 鏆傛椂淇濈暀 `db.expire_all()` (Task 32 娓呯悊)

  **Recommended Agent Profile**:
  - **Category**: `deep`
  - **Skills**: `[]`
  - **Reason**: 610 琛?+ 宓屽 db2 + 鍚庡彴浠诲姟 + 鍏ㄥ眬鐘舵€? 鏈€澶嶆潅杩佺Щ

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 4 (position 11, **鏈€鍚?*)
  - **Blocked By**: Task 29 (纭繚 engine 宸茶縼绉?

  **References**:
  - `main/framework/api/conversations.py:130` (session_manager), 281 (db2)
  - `main/framework/repositories/conversation_repo.py` (Task 15)
  - `main/framework/services/` (Task 19 UnitOfWork, for cross-repo ops)

  **Acceptance Criteria**:
  - [ ] `pytest tests/integration/ -v` 鍏ㄩ儴閫氳繃
  - [ ] `pytest tests/integration/test_conversation_flow.py` 3 passed (Task 8)
  - [ ] `grep "SessionLocal()" main/framework/api/conversations.py` exit 1
  - [ ] `grep -n "db2 = SessionLocal" main/framework/api/conversations.py` exit 1
  - [ ] `grep -n "^session_manager" main/framework/api/conversations.py` exit 1
  - [ ] conversations.py 琛屾暟涓嶅彉 (PHASE 1 涓嶆媶鍒?

  **QA Scenarios (MANDATORY)**:
  ```
  Scenario: conversations.py 杩佺Щ鍚庢棤 regression
    Tool: Bash (pytest)
    Steps:
      1. pytest tests/integration/ -v --tb=short
      2. 閲嶇偣楠岃瘉 test_conversation_flow.py
    Expected Result: 鍏ㄩ儴閫氳繃
    Evidence: .omo/evidence/task-30-conv-no-regress.txt

  Scenario: 宓屽 db2 宸叉秷闄?    Tool: Bash (grep)
    Steps:
      1. grep -n "db2 = SessionLocal" main/framework/api/conversations.py
      2. 鏂█鏃犺緭鍑?    Expected Result: 鏃犺緭鍑?    Evidence: .omo/evidence/task-30-no-nested-db2.txt

  Scenario: session_manager 鍏ㄥ眬宸茬Щ闄?    Tool: Bash (grep)
    Steps:
      1. grep -n "^session_manager" main/framework/api/conversations.py
      2. 鏂█鏃犺緭鍑?    Expected Result: 鏃犺緭鍑?    Evidence: .omo/evidence/task-30-no-session-mgr.txt
  ```

  **Commit**: YES
  - Message: `refactor(api): migrate conversations.py (remove session_manager + nested db2)`
  - Files: `main/framework/api/conversations.py`
  - Pre-commit: `pytest tests/integration/ && python scripts/check_lines.py`

- [x] 31. **杩佺Щ maintenance_db.py (2 澶?SessionLocal) - 鐙珛 DB**

  **What to do**:
  - 淇敼 `main/data_maintenance/models/maintenance_db.py`:
    - 鍒犻櫎 2 澶?`SessionLocal()` 璋冪敤锛堝鏋滃瓨鍦ㄤ簬姝ゆ枃浠讹級
    - 鏀圭敤 `Depends(get_service(MaintenanceRepository))` 鎴?`get_maintenance_db()` 鍙岃建
  - 濡傛灉 SessionLocal 鍦?`data_maintenance/api/` 涓嬶紝鍒欐敼瀵瑰簲鏂囦欢
  - 淇濇寔 MaintenanceBase 鐙珛

  **Must NOT do**:
  - 涓嶇粺涓€涓や釜鏁版嵁搴?  - 涓嶄慨鏀?MaintenanceBase 妯″瀷

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: `[]`
  - **Reason**: 鐙珛瀛愮郴缁? 2 澶勮皟鐢?
  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 4 (position 12, 鏈€鍚?
  - **Blocked By**: Task 30

  **References**:
  - `main/data_maintenance/models/maintenance_db.py:44,58` - 2 澶?SessionLocal
  - `main/data_maintenance/repositories/maintenance_repo.py` (Task 16)

  **Acceptance Criteria**:
  - [ ] `pytest tests/integration/ -v` 鍏ㄩ儴閫氳繃
  - [ ] `grep "SessionLocal()" main/data_maintenance/ --include="*.py" -r` 浠呭湪 `maintenance_db.py` 鐨?`_SessionLocal` 瀹氫箟

  **QA Scenarios (MANDATORY)**:
  ```
  Scenario: maintenance 杩佺Щ鍚庢棤 regression
    Tool: Bash (pytest)
    Steps:
      1. pytest tests/integration/ -v --tb=short
    Expected Result: 鍏ㄩ儴閫氳繃
    Evidence: .omo/evidence/task-31-maint-no-regress.txt

  Scenario: maintenance 瀛愮郴缁?SessionLocal 宸叉渶灏忓寲
    Tool: Bash (grep)
    Steps:
      1. grep -rn "SessionLocal()" main/data_maintenance/ --include="*.py"
      2. 楠岃瘉浠呭湪 maintenance_db.py 涓綔涓哄畾涔?    Expected Result: 浠?1-2 涓尮閰嶏紙瀹氫箟浣嶇疆锛?    Evidence: .omo/evidence/task-31-maint-grep.txt
  ```

  **Commit**: YES
  - Message: `refactor(maintenance): migrate data_maintenance to MaintenanceRepository`
  - Files: `main/data_maintenance/...` (depends on actual call locations)

### Wave 5: Cleanup (骞惰, 3涓换鍔?

- [x] 32. **绉婚櫎 db.expire_all() workarounds**

  **What to do**:
  - 鎼滅储鎵€鏈?`db.expire_all()` 鍜?`db.commit()` visibility hacks
  - 宸茬煡浣嶇疆: `conversations.py:295`, `scheduler.py:322`, `workflow_engine.py:70,103,131`
  - 鍒犻櫎鎴栭噸鍐欎负鏍囧噯 SQLAlchemy 妯″紡
  - 楠岃瘉 WAL 妯″紡涓嬫棤闇€杩欎簺 workaround

  **Must NOT do**:
  - 涓嶄慨鏀逛笟鍔¤涓?  - 涓嶅湪 PHASE 1 寮曞叆鏂?ORM 妯″紡

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: `[]`
  - **Reason**: SQLAlchemy 鍐呴儴鏈哄埗 + 璺ㄦ枃浠堕獙璇?
  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 5
  - **Blocks**: F1-F4 reviews
  - **Blocked By**: Wave 4 鍏ㄩ儴瀹屾垚

  **References**:
  - `main/framework/api/conversations.py:295`
  - `main/framework/core/scheduler.py:322`
  - `main/framework/core/workflow_engine.py:70,103,131`

  **Acceptance Criteria**:
  - [ ] `pytest tests/integration/ -v` 鍏ㄩ儴閫氳繃
  - [ ] `grep -rn "db.expire_all\|db.commit()" main/framework/ --include="*.py"` 浠呭湪 Repository (BaseRepository) 鍐?  - [ ] 鏂囦欢 < 500 琛?
  **QA Scenarios (MANDATORY)**:
  ```
  Scenario: 绉婚櫎 expire_all 鍚庢棤 regression
    Tool: Bash (pytest)
    Steps:
      1. pytest tests/integration/ -v --tb=short
    Expected Result: 鍏ㄩ儴閫氳繃
    Evidence: .omo/evidence/task-32-no-expire-regress.txt

  Scenario: db.expire_all 宸蹭粠涓氬姟浠ｇ爜绉婚櫎
    Tool: Bash (grep)
    Steps:
      1. grep -rn "db.expire_all" main/framework/ --include="*.py"
      2. 楠岃瘉浠呭湪 Repository 灞傦紙鏃犱笟鍔′唬鐮侊級
    Expected Result: 浠?Repository 鍐?    Evidence: .omo/evidence/task-32-expire-grep.txt
  ```

  **Commit**: YES
  - Message: `chore(cleanup): remove db.expire_all() workarounds`
  - Files: `main/framework/api/conversations.py`, `main/framework/core/scheduler.py`, `main/framework/core/workflow_engine.py`

- [x] 33. **绉婚櫎姝讳唬鐮? 妯″潡绾?ExecutionRepository 瀹炰緥鍖栬矾寰?*

  **What to do**:
  - 鎼滅储 `repo = ExecutionRepository()` 妯″紡
  - 楠岃瘉鎵€鏈夎皟鐢ㄦ柟宸茶縼绉昏嚦 `Depends` 娉ㄥ叆 (Task 25 宸插畬鎴?
  - 鍒犻櫎浠讳綍閬楃暀鐨勬ā鍧楃骇瀹炰緥鍖?  - 楠岃瘉 Container 浠嶆槸鍞竴鍒涘缓鐐?
  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: `[]`

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 5
  - **Blocked By**: Wave 4 鍏ㄩ儴瀹屾垚

  **References**:
  - `main/framework/core/container.py:55-58` - 鍞竴鍒涘缓鐐?  - PHASE1.md 搂0.2 (line 25-29) - 璺ㄥ眰璋冪敤瑙勮寖

  **Acceptance Criteria**:
  - [ ] `grep -rn "= ExecutionRepository()" main/ --include="*.py"` 浠呭湪 container.py 鍐?  - [ ] `pytest tests/integration/ -v` 鍏ㄩ儴閫氳繃

  **QA Scenarios (MANDATORY)**:
  ```
  Scenario: ExecutionRepository 鍞竴鍦?Container 鍒涘缓
    Tool: Bash (grep)
    Steps:
      1. grep -rn "= ExecutionRepository()" main/ --include="*.py"
      2. 鏂█浠?container.py 鍖归厤
    Expected Result: 1 涓尮閰?(container.py)
    Evidence: .omo/evidence/task-33-repo-creation.txt
  ```

  **Commit**: YES
  - Message: `chore(cleanup): remove dead ExecutionRepository instantiations`
  - Files: (TBD by grep results)

- [x] 34. **楠岃瘉鎵€鏈夊叏灞€鐘舵€佸凡鏇挎崲**

  **What to do**:
  - 鎼滅储 PHASE 1 璇嗗埆鐨?4 涓叏灞€鐘舵€佹ā寮?
    - `_engine_factory` (scheduler.py:20) - 搴斾粎鍦?Container
    - `_scheduler_instance` (scheduler.py:346) - 搴斾粎鍦?Container
    - `session_manager` (conversations.py:130) - 搴旈€氳繃 Service
    - `configure(` 鍑芥暟 - 搴斿叏閮ㄥ垹闄わ紙闄?Container 鍐呴儴锛?  - 鐢熸垚楠岃瘉鎶ュ憡
  - 濡傛灉鏈夐仐婕忥紝鏍囪涓哄悗缁?PHASE 2 浠诲姟

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: `[]`

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 5
  - **Blocked By**: Wave 4 鍏ㄩ儴瀹屾垚

  **References**:
  - Metis findings (draft 2026-06-09)
  - PHASE1.md 搂0.1 (line 19)

  **Acceptance Criteria**:
  - [ ] `grep -rn "_engine_factory\|_scheduler_instance\|session_manager" main/ --include="*.py"` 浠呭湪 container.py
  - [ ] `grep -rn "^def configure(" main/ --include="*.py"` 浠呭湪 container.py

  **QA Scenarios (MANDATORY)**:
  ```
  Scenario: 鍏ㄥ眬鍙橀噺宸叉敹鏁涘埌 Container
    Tool: Bash (grep)
    Steps:
      1. grep -rn "_engine_factory\|_scheduler_instance" main/ --include="*.py"
      2. grep -rn "session_manager" main/ --include="*.py"
      3. 涓よ€呴兘搴斾粎鍦?container.py 涓?    Expected Result: 浠?container.py 鍖归厤
    Evidence: .omo/evidence/task-34-globals-clean.txt

  Scenario: configure() 鍑芥暟宸插垹闄?    Tool: Bash (grep)
    Steps:
      1. grep -rn "^def configure(" main/ --include="*.py"
      2. 鏂█鏃犺緭鍑?    Expected Result: 鏃犺緭鍑?    Evidence: .omo/evidence/task-34-no-configure.txt
  ```

  **Commit**: NO (verification only, no code changes expected)

---

## Final Verification Wave (MANDATORY)

- [x] F1. **Plan Compliance Audit** 鈥?`oracle`
- [x] F2. **Code Quality Review** 鈥?`unspecified-high`
- [x] F3. **Real Manual QA** 鈥?`unspecified-high`
- [x] F4. **Scope Fidelity Check** 鈥?`deep`

### Discovered Issues (Wave 1-2) 鈥?Deferred to Final Wave

> **鐢ㄦ埛鎸囩ず**: "鎶婃瘡涓獁ave鍙戠幇鐨勯棶棰樺鐞嗛兘鏀惧埌final閲岄潰澶勭悊"

- [x] F5. **淇 Scheduler 璺敱 bug**: `GET /api/v1/workflows/scheduled` 琚?`/{workflow_id}` 褰卞瓙瑕嗙洊 鈥?鏀?router 娉ㄥ唽椤哄簭鎴栧姞 explicit path
- [x] F6. **淇 workflow_parser.validate_dag() 寰幆妫€娴?bug**: `defaultdict(str)` 榛樿鏄?`""` 涓嶆槸 `"white"` 鈥?cyclic DAG 闈欓粯閫氳繃
- [x] F7. **淇 API 璺緞涓嶄竴鑷?*: `/api/v1/workflows/` (POST) vs `/api/workflows/{id}/trigger` (鏃?/v1/) 鈥?缁熶竴鍓嶇紑
- [x] F8. **鏇存柊 pyproject.toml ruff rules**: Wave 1 闄愬埗涓?`["E","W","F"]` (215 legacy issues) 鈥?Wave 4 瀹屾垚鍚庡姞鍥?UP, I, B, SIM
- [x] F9. **鏇存柊 check_dependencies.py expected_violations**: 娣诲姞 `api/workflows.py` (Wave 2 Task 9 鍙戠幇 2 violations)

---

## Commit Strategy

### Per-Step (Task) Commits (姣忎釜浠诲姟涓€娆?

姣忎釜浠诲姟鍦ㄥ叾 `Commit: YES` 娈靛凡瀹氫箟鍏蜂綋 message锛屾寜 conventional commits 瑙勮寖:
- `chore(...)` - 閰嶇疆/宸ュ叿/鏃犲叧鍔熻兘
- `feat(...)` - 鏂板姛鑳?鏂版枃浠?- `refactor(...)` - 閲嶆瀯涓嶆敼琛屼负
- `test(...)` - 娴嬭瘯浠ｇ爜
- `fix(...)` - 淇

### Per-Wave Checkpoint Commits (姣忎釜 Wave 瀹屾垚鍚?

> **鐢ㄦ埛瑕佹眰**: "姣忎竴涓獁ave閮借git瀛樻。" 鈥?Wave 瀹屾垚鍚庡繀椤?checkpoint commit + tag

姣忎釜 Wave 鍏ㄩ儴浠诲姟 commit 瀹屾垚鍚庯紝鎵ц:

```bash
# 1. 楠岃瘉 working tree 骞插噣
git status

# 2. Wave checkpoint commit (绌?commit 浣滀负 marker)
git commit --allow-empty -m "chore(checkpoint): phase1-wave-N complete

Wave N summary:
- Tasks <X>-<Y>: <brief description>
- All QA scenarios passed
- Integration tests: <X/Y passed>

Tag: phase1-wave-N-complete
Executed-by: Sisyphus"

# 3. Lightweight tag (鍙仮澶嶅埌璇?wave)
git tag phase1-wave-N-complete

# 4. Push 鍒?origin (鍙€? 鐢辩敤鎴峰喅瀹?
git push origin phase1-foundation --tags
```

**Wave 鏍囩**:
| Wave | Tag | 鏃堕棿鐐?|
|------|-----|--------|
| Wave 0 | `pre-phase1-baseline` | Git 鐜灏辩华鍚?|
| Wave 1 | `phase1-wave-1-complete` | 7 涓?foundation 浠诲姟瀹屾垚鍚?|
| Wave 2 | `phase1-wave-2-complete` | 4 涓泦鎴愭祴璇曞畬鎴愬悗 |
| Wave 3 | `phase1-wave-3-complete` | 8 涓暟鎹眰浠诲姟瀹屾垚鍚?|
| Wave 4 | `phase1-wave-4-complete` | 12 涓縼绉讳换鍔″畬鎴愬悗 |
| Wave 5 | `phase1-wave-5-complete` | 3 涓竻鐞嗕换鍔″畬鎴愬悗 |
| Final | `phase1-complete` | F1-F4 鍏ㄩ儴 APPROVE 鍚?|

### 澶辫触鎭㈠绛栫暐

```bash
# 鎭㈠鍒颁笂涓€涓?wave
git checkout phase1-wave-(N-1)-complete
# 鎴栨仮澶嶅埌涓婁竴涓?task
git log --oneline | grep "task-N-"
git checkout <commit-sha>
# 閲嶅惎 Sisyphus 鏃跺畠浼氳嚜鍔ㄦ娴?git 鐘舵€佸苟鎭㈠涓婁笅鏂?```

### Wave-Specific Commit Aggregations (鍙傝€?

- **Wave 1 鍏ㄩ儴瀹屾垚鍚?*: 7 娆″崟浠诲姟 commit + 1 娆?checkpoint = 8 娆?commit
- **Wave 2 鍏ㄩ儴瀹屾垚鍚?*: 4 娆″崟浠诲姟 commit + 1 娆?checkpoint = 5 娆?commit
- **Wave 3 鍏ㄩ儴瀹屾垚鍚?*: 8 娆″崟浠诲姟 commit + 1 娆?checkpoint = 9 娆?commit
- **Wave 4 鍏ㄩ儴瀹屾垚鍚?*: 12 娆″崟浠诲姟 commit + 1 娆?checkpoint = 13 娆?commit
- **Wave 5 鍏ㄩ儴瀹屾垚鍚?*: 2-3 娆″崟浠诲姟 commit + 1 娆?checkpoint = 3-4 娆?commit
- **Final 鍏ㄩ儴瀹屾垚鍚?*: 0 娆′唬鐮?commit (鍙鏍? + 1 娆?`phase1-complete` tag

**鎬昏**: 绾?35 娆″崟浠诲姟 commit + 6 娆?wave checkpoint commit + 7 涓?tag

---

## Success Criteria

### Verification Commands
```bash
# 娴嬭瘯
pytest tests/integration/ -v    # Expected: 10-15 passed
pytest tests/unit/ -v           # Expected: 30+ passed

# SessionLocal 娑堥櫎
grep -r "SessionLocal()" main/ --include="*.py"  # Expected: 浠?database.py, maintenance_db.py (definition only)

# 鍏ㄥ眬鐘舵€佹秷闄?grep -rn "configure(" main/ --include="*.py"  # Expected: 0 results (闄?Container 鑷韩)
grep -rn "_engine_factory\|_scheduler_instance\|session_manager" main/ --include="*.py"  # Expected: 浠?Container

# 浠ｇ爜璐ㄩ噺
ruff check main/ webui/    # Expected: All checks passed
python scripts/check_lines.py    # Expected: 0 files > 500 lines
python scripts/check_dependencies.py    # Expected: 0 violations

# WAL mode 楠岃瘉
python -c "from main.framework.models.database import engine; conn = engine.connect(); print(conn.execute('PRAGMA journal_mode').scalar())"    # Expected: wal
```

### Final Checklist
- [x] All "Must Have" present
- [x] All "Must NOT Have" absent
- [x] 30+ Repository unit tests passing
- [x] 10-15 integration tests passing
- [x] WAL mode verified at runtime
- [x] All globals replaced
- [x] All 13 files migrated off SessionLocal() (闄ゅ畾涔夋枃浠?
- [x] ExecutionRepository 11 涓柟娉曠鍚嶄繚鎸佸悜鍚庡吋瀹?

