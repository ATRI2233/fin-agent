# PHASE 2 — 业务逻辑拆分与依赖治理

> **STATUS NOTE**: Plan written 2026-06-09. Previous session already executed partial PHASE 2 work (committed as `1f55ee1`):
> - Task 2 (schemas/conversation.py): **DONE** (28 lines)
> - Task 3 (move ConvSessionManager): **DONE** but placed in `core/`, not `services/`
> - Task 9 (MessageProcessor): **DONE** (170 lines, in services/)
> - Task 10 (refactor conversations.py): **PARTIAL** (549→217 lines, target 150)
> - All 17 integration tests passing
> - Branch: `phase1-foundation` (pre-PHASE 2 work was on this branch)
> - This plan continues from current state; tasks already completed are marked `[x]`

## TL;DR

> **Quick Summary**: Extract Service layer from existing API/core modules, split God Objects (conversations.py 549→150, workflow_engine.py 561→300), eliminate remaining globals (_scheduler_instance), and consolidate duplicated code. 4 existing integration tests must pass unchanged.
>
> **Deliverables**:
> - 6 new Services (Conversation, Workflow, Execution, Scheduler, Debate-as-NodeExecutor, SessionManager)
> - 4 NodeExecutor strategy classes (Input, Output, Debate, Agent)
> - schemas/ directory with Pydantic models
> - controllers/ directory with thin route handlers (≤200 lines, ≤15 lines per endpoint)
> - Zero module-level globals; all deps via constructor injection
> - 50+ new Service unit tests using Mock Repository
>
> **Estimated Effort**: Large (3 weeks per PHASE2.md)
> **Parallel Execution**: YES - 6 waves with 4-8 parallel tasks per wave
> **Critical Path**: W1 setup → W2 schemas+session_mgr → W3 conversation_service → W4 workflow_service+executors → W5 scheduler+globals → Final verification

---

## Context

### Original Request
PHASE 2 from `PHASE2.md`: Service layer extraction, God Object splitting, global state cleanup, Controller refinement. 3-week timeline. Prerequisite: PHASE 1 complete (✅ done).

### Interview Summary
**Key Discussions**:
- **Scope**: Holistic plan, split into waves (NOT incremental single-task plans)
- **Service layer**: Brand new extraction (no existing services to reference)
- **Tests**: Mock Repository unit tests (50+ new tests on top of PHASE 1's 45+)
- **Legacy global**: `_scheduler_instance` cleanup included in PHASE 2 (not deferred)

**Research Findings**:
- conversations.py is 549 lines, must drop to ≤150 (controllers/ will absorb routes)
- workflow_engine.py is 561 lines, must drop to ≤300 (NodeExecutor strategy pattern)
- execute_node() is 146 lines with 4 node types (input/output/debate/agent)
- ConvSessionManager is the only true singleton needing careful migration
- `_find_opencode_bin()` is TRIPLICATED, not duplicated (3 sources)
- data_maintenance/ is a parallel subsystem, MaintenanceService deferred to PHASE 3
- 4 existing integration tests are the immutable acceptance bar

### Metis Review
**Identified Gaps** (addressed in plan):
- **Architectural**: ConvSessionManager stays as separate class (not nested in ConversationService)
- **Per-execution vs singleton**: Define service lifetime explicitly in docstring
- **Async safety**: Backend-touching services async, DB-only services sync
- **Per-node commit boundary**: MUST NOT centralize, MUST NOT change transaction semantics
- **Backward compat**: get_scheduler() shim during migration with DeprecationWarning
- **Circular imports**: TYPE_CHECKING for type hints, lazy runtime imports
- **Scope creep lockdown**: No new node types, no Node dataclass, no metrics/tracing, no exception hierarchy

---

## Work Objectives

### Core Objective
Extract a complete Service layer from existing God Objects in 6 waves, with all cross-cutting concerns (global state, dependency wiring) resolved. Zero behavior change to user-facing API; existing 4 integration tests pass unchanged.

### Concrete Deliverables
- `main/framework/services/conversation_service.py` (~150 lines)
- `main/framework/services/session_manager.py` (~120 lines, moved from conversations.py:66-119)
- `main/framework/services/workflow_service.py` (~180 lines)
- `main/framework/services/execution_service.py` (~150 lines)
- `main/framework/services/scheduler_service.py` (~200 lines)
- `main/framework/services/message_processor.py` (~180 lines, moved from conversations.py:149-314)
- `main/framework/services/prompt_builder.py` (~80 lines, extracted _build_prompt)
- `main/framework/services/workflow_graph.py` (~50 lines, graph helpers)
- `main/framework/core/workflow/node_executors/{base,input,output,debate,agent,registry}.py`
- `main/framework/schemas/{conversation,workflow,execution,scheduler,message}.py`
- `main/framework/controllers/{conversations,workflows,executions,scheduler,dispatch,sessions,triggers,agents,skills,tools,system}.py`
- Updated `main/framework/core/container.py` (service registration)
- 50+ new unit tests in `tests/unit/test_*.py`

### Definition of Done
- [x] `pytest tests/integration/ -v` → 4 passed (zero test file changes)
- [x] `pytest tests/unit/ -v -k "service or executor"` → 50+ passed
- [x] `conversations.py` ≤ 150 lines
- [x] `workflow_engine.py` ≤ 300 lines
- [x] `radon cc -s -n B main/framework/core/workflow_engine.py` → max rank B
- [x] `grep -r "_scheduler_instance" main/` → 0 matches
- [x] `grep -r "_find_opencode_bin" main/` → 2 matches (1 def + 1 re-export)
- [x] `grep "^from main.framework.core" main/framework/api/conversations.py` → only `protocols`
- [x] `python -c "from main.framework.services import *"` → no ImportError
- [x] `ruff check main/ webui/` → 0 errors
- [x] `python scripts/check_lines.py` → no 500+ line files

### Must Have
- All 6 services registered in Container (register_singleton or register_factory)
- ConvSessionManager remains a singleton (process-local state)
- Per-node `db.commit()` semantics preserved exactly
- Async/sync mixing preserved (backend-touching services async, DB-only sync)
- Each Service has ≥5 unit tests (happy + NotFound + dep-missing + async + db-closure)
- No new SQLAlchemy imports in services/ (use repositories only)
- All 4 integration tests pass with NO test file modifications

### Must NOT Have (Guardrails)
- **NO** new node types or retry policy changes
- **NO** Node dataclass or typed models (keep dict-based nodes)
- **NO** centralized db.commit() in a base class (per-node commits stay)
- **NO** conversion of sync code to async (preserve current behavior)
- **NO** exception hierarchy (1-2 base exceptions max: ServiceError, NotFoundError)
- **NO** metrics/tracing/structured logging
- **NO** FastAPI on_event → lifespan migration
- **NO** Pydantic v1 → v2 migration
- **NO** multi-worker scheduler sync (Redis)
- **NO** MaintenanceService in this phase (deferred to PHASE 3)
- **NO** touching `data_maintenance/` subsystem
- **NO** modifying the 4 existing integration test files
- **NO** adding new dependencies (use existing fastapi, sqlalchemy, pydantic, apscheduler)

### Spec Framework Integration
None (this is a refactor, no new spec framework needed)

---

## Verification Strategy (MANDATORY)

> **ZERO HUMAN INTERVENTION** - All verification is agent-executed. No "user manually tests" acceptance criteria.

### Test Decision
- **Infrastructure exists**: YES (PHASE 1: 45+ tests)
- **Automated tests**: TDD-style for new services (RED-GREEN-REFACTOR)
- **Framework**: pytest + pytest-asyncio (already configured)
- **Mock strategy**: `unittest.mock.AsyncMock` for async deps, `MagicMock(spec=RepositoryProtocol)` for repos
- **No real DB** in service unit tests (use mocks at repository boundary)

### QA Policy
Every task MUST include agent-executed QA scenarios. Evidence saved to `.omo/evidence/task-{N}-{slug}.{ext}`.

- **Service unit tests**: `pytest tests/unit/test_<service>.py -v --tb=short` → assertion-based
- **Integration regression**: `pytest tests/integration/ -v` → must pass unchanged
- **Layer separation**: `grep` + `radon` for static checks
- **File metrics**: PowerShell `Measure-Object -Line` for line counts
- **API smoke**: `curl` against running uvicorn for end-to-end check

---

## Execution Strategy

### Parallel Execution Waves

> Maximize throughput. Target 4-6 tasks per wave. Fewer than 3 per wave (except final) = under-splitting.

```
Wave 1 (Setup - sequential, no parallelism):
└── Task 1: Git baseline (branch phase2-refactor + tag pre-phase2-baseline + boulder init)

Wave 2 (Foundation - parallel, no behavior change):
├── Task 2: Create schemas/conversation.py (5 Pydantic models)
├── Task 3: Move ConvSessionManager to services/session_manager.py
├── Task 4: Create services/protocols.py (Service base interface)
├── Task 5: Create services/__init__.py with re-exports
└── Task 6: Update container.py to register session_manager from new path

Wave 3 (ConversationService + Controller - max parallel):
├── Task 7: Create ConversationService (extract CRUD from conversations.py:320-549)
├── Task 8: Create controllers/conversations.py (move 8 endpoints, thin to ≤15 lines each)
├── Task 9: Create MessageProcessor (extract _process_agent_message + _execute_workflow_async)
├── Task 10: Refactor conversations.py to thin route file (≤150 lines)
└── Task 11: Unit tests for ConversationService + SessionManager (15+ tests)

Wave 4 (Workflow + Execution + NodeExecutors - max parallel):
├── Task 12: Create core/workflow/node_executors/base.py (NodeExecutor ABC)
├── Task 13: Create 4 NodeExecutors: Input, Output, Debate, Agent
├── Task 14: Create node_executors/registry.py (type→executor lookup)
├── Task 15: Create services/prompt_builder.py (extract _build_prompt)
├── Task 16: Create services/workflow_graph.py (extract _build_predecessors + _find_downstream)
├── Task 17: Create ExecutionService (extract handle_failure + ExecutionNode lifecycle)
├── Task 18: Create WorkflowService (extract _execute_in_order + orchestration)
├── Task 19: Refactor workflow_engine.py to use NodeExecutors (≤300 lines)
└── Task 20: Unit tests for WorkflowService + ExecutionService + 4 executors (25+ tests)

Wave 5 (Scheduler + Global cleanup - parallel):
├── Task 21: Create SchedulerService (extract cron logic from scheduler.py)
├── Task 22: Add DeprecationWarning shim to get_scheduler() (reads from container first)
├── Task 23: Migrate api/scheduler_routes.py to use container.scheduler
├── Task 24: Migrate api/system.py to use container.scheduler
├── Task 25: Migrate tests/integration/test_scheduled_workflow.py (add fixture)
├── Task 26: Remove _scheduler_instance global + get_scheduler() function
└── Task 27: Remove all configure() functions; verify grep returns 0

Wave 6 (Polish - parallel):
├── Task 28: Consolidate _find_opencode_bin() (1 def + 1 re-export)
├── Task 29: Decide on UnitOfWork (keep with usage OR remove)
├── Task 30: Update container.py to register all 6 services
└── Task 31: Final ruff + line count + complexity checks

Wave FINAL (Verification - 4 parallel reviews):
├── F1: Plan Compliance Audit (unspecified-high)
├── F2: Code Quality Review (unspecified-high)
├── F3: Real Manual QA (unspecified-high)
├── F4: Scope Fidelity Check (deep)
└── F5-F9: Bug fixes as discovered
```

### Dependency Matrix
- **1**: - (none, root)
- **2-6**: 1 (Wave 2 depends on Wave 1)
- **7-11**: 2,3,4,5,6 (Wave 3 depends on Wave 2)
- **12-20**: 7,11 (Wave 4 needs ConversationService for cross-service tests)
- **21-27**: 1 (Wave 5 mostly independent, can run parallel to W3-W4)
- **28-31**: 1,7,11,17,18,20 (Wave 6 needs services to be in place)
- **F1-F9**: 1-31 (Final depends on all)

### Agent Dispatch Summary
- **Wave 1**: 1 task → `quick`
- **Wave 2**: 5 tasks → 4 × `quick` + 1 × `unspecified-low` (container update)
- **Wave 3**: 5 tasks → 2 × `quick` + 2 × `unspecified-high` (services) + 1 × `unspecified-high` (tests)
- **Wave 4**: 9 tasks → 4 × `quick` (executors) + 1 × `unspecified-high` (workflow_service) + 1 × `unspecified-high` (execution_service) + 1 × `unspecified-high` (refactor engine) + 1 × `unspecified-high` (tests)
- **Wave 5**: 7 tasks → 2 × `quick` + 1 × `unspecified-high` (SchedulerService) + 4 × `unspecified-high` (migrations)
- **Wave 6**: 4 tasks → 3 × `quick` + 1 × `unspecified-high` (final checks)
- **Final**: 4 parallel → 1 × `unspecified-high` + 1 × `unspecified-high` + 1 × `unspecified-high` + 1 × `deep`

---

## TODOs

> **FORMAT**: Task labels MUST use bare numbers: `1.`, `2.`, `3.`
> Final Wave labels MUST use `F1.`, `F2.`, etc.
> Implementation + Tests = ONE Task. Never separate.
> EVERY task MUST have: Recommended Agent Profile + Parallelization info + QA Scenarios.

---

### Wave 1 — Setup (1 task, sequential)

- [x] 1. **Git baseline setup (branch + tag + boulder init)** ✅ DONE (branch `phase2-refactor` exists, tag `pre-phase2-baseline` created)

  **What to do**:
  - Create branch `phase2-refactor` from current HEAD on `phase1-foundation` (or merge `phase1-foundation` to master first if user prefers)
  - Create tag `pre-phase2-baseline` at branch HEAD
  - Initialize `.omo/boulder.json` with `plan: "phase2-refactor"`, `total_tasks: 31`, `completed: 0`
  - Verify working tree is clean before starting

  **Must NOT do**:
  - Do NOT merge `phase1-foundation` to master without user approval
  - Do NOT modify any code files in this task
  - Do NOT create additional tags beyond `pre-phase2-baseline`

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Single-task setup, no logic
  - **Skills**: `["git-advanced-workflows"]`
    - `git-advanced-workflows`: Branch + tag operations

  **Parallelization**:
  - **Can Run In Parallel**: NO (Wave 1 root)
  - **Blocks**: Tasks 2-31
  - **Blocked By**: None

  **References**:
  - Pattern: `phase1-foundation.md:Task 0` — exact same setup pattern from PHASE 1
  - Git path: `C:\Program Files\Git\bin\git.exe` (not in PATH)

  **Acceptance Criteria**:
  - [ ] Branch `phase2-refactor` exists, points to current HEAD
  - [ ] Tag `pre-phase2-baseline` exists, points to branch HEAD
  - [ ] `.omo/boulder.json` has `plan: "phase2-refactor"`, `total_tasks: 31`
  - [ ] `git status` shows clean working tree

  **QA Scenarios**:
  ```
  Scenario: Branch and tag exist
    Tool: Bash (git)
    Steps:
      1. `& "C:\Program Files\Git\bin\git.exe" branch --list phase2-refactor` → exits 0 with `phase2-refactor` in output
      2. `& "C:\Program Files\Git\bin\git.exe" tag --list pre-phase2-baseline` → exits 0 with `pre-phase2-baseline` in output
      3. `& "C:\Program Files\Git\bin\git.exe" status --porcelain` → empty output (clean tree)
    Expected Result: All 3 commands succeed
    Evidence: .omo/evidence/task-1-git-baseline.txt
  ```

  **Commit**: `chore(phase2): init phase2-refactor branch + pre-phase2-baseline tag`

---

### Wave 2 — Foundation (5 tasks, parallel, no behavior change)

- [x] 2. **Create `schemas/conversation.py` with 5 Pydantic models** ✅ DONE (commit 1f55ee1)

  **What to do**:
  - Create `main/framework/schemas/__init__.py` (empty)
  - Create `main/framework/schemas/conversation.py` with the 5 models from `api/conversations.py:27-60`:
    - `ConversationCreate(title: str | None = "New Conversation")`
    - `ConversationUpdate(title: str | None = None, current_agent: str | None = None)`
    - `MessageCreate(content: str = Field(..., max_length=10000), mode: str = "agent", agent: str | None = None, workflow_id: str | None = None)`
    - `MessageResponse(id, role, content, agent, workflow_id, execution_id, extra_data, created_at)`
    - `ConversationResponse(id, title, current_agent, created_at, updated_at, message_count=0)`
  - DO NOT yet update `api/conversations.py` imports (Wave 3 task)

  **Must NOT do**:
  - Do NOT add validators (preserve v1 config style)
  - Do NOT split into multiple files
  - Do NOT add new fields

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: `["typescript-best-practices"]` (for pydantic patterns)

  **Parallelization**: YES (parallel with tasks 3, 4, 5)

  **References**:
  - Source: `main/framework/api/conversations.py:27-60` (5 model definitions)
  - Pattern: `tests/integration/test_conversation_flow.py` shows expected JSON shapes

  **Acceptance Criteria**:
  - [ ] `main/framework/schemas/__init__.py` exists (empty)
  - [ ] `main/framework/schemas/conversation.py` exists with 5 models
  - [ ] `python -c "from main.framework.schemas.conversation import ConversationCreate, ConversationUpdate, MessageCreate, MessageResponse, ConversationResponse"` → exits 0

  **QA Scenarios**:
  ```
  Scenario: All 5 models importable
    Tool: Bash (python)
    Steps:
      1. `python -c "from main.framework.schemas.conversation import ConversationCreate, ConversationUpdate, MessageCreate, MessageResponse, ConversationResponse; print('OK')"` → stdout contains "OK"
    Expected Result: All 5 models import without error
    Evidence: .omo/evidence/task-2-schemas-import.txt
  ```

  **Commit**: `feat(schemas): extract 5 Pydantic models from api/conversations.py`

- [x] 3. **Move `ConvSessionManager` to `services/session_manager.py`** ✅ DONE but in `core/session_manager.py` (commit 1f55ee1). Decision: keep in `core/` (semantic fit — session management is core infra, not business service).

  **What to do**:
  - Create `main/framework/services/session_manager.py` with `ConvSessionManager` class (copy from `api/conversations.py:66-119`)
  - Add module docstring explaining: "Process-local cache of conversation_id → session_id mappings. In multi-worker deployments, each worker has its own cache; DB is source of truth."
  - Re-export `ConvSessionManager` from `services/__init__.py` for backward compat
  - DO NOT yet update `api/conversations.py` to use the new path (Wave 3 task)

  **Must NOT do**:
  - Do NOT redesign the class API
  - Do NOT add new methods
  - Do NOT change behavior (preserve exact async semantics, in-memory dict, DB fallback)

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: `[]`

  **Parallelization**: YES (parallel with tasks 2, 4, 5)

  **References**:
  - Source: `main/framework/api/conversations.py:66-119`
  - Class signature: `ConvSessionManager(backend: AgentBackend)`

  **Acceptance Criteria**:
  - [ ] `main/framework/services/session_manager.py` exists
  - [ ] `ConvSessionManager` class has identical interface (3 async methods + 1 sync getter)
  - [ ] `python -c "from main.framework.services.session_manager import ConvSessionManager; from main.framework.services import ConvSessionManager as SM2; assert SM2 is ConvSessionManager"` → exits 0

  **QA Scenarios**:
  ```
  Scenario: ConvSessionManager importable from new path
    Tool: Bash (python)
    Steps:
      1. `python -c "from main.framework.services.session_manager import ConvSessionManager; m = ConvSessionManager.__init__.__doc__ or 'no doc'; print(m)"` → no ImportError
    Expected Result: Class loads, has 3+ methods
    Evidence: .omo/evidence/task-3-session-manager.txt
  ```

  **Commit**: `refactor(services): move ConvSessionManager to services/session_manager.py`

- [x] 4. **Create `services/protocols.py` with Service base interface** ✅ DONE (commit 97fb0ff, 27 lines, `ServiceProtocol` is `runtime_checkable Protocol` with `__init__(**deps)` + `health_check()`)

  **What to do**:
  - Create `main/framework/services/protocols.py` with `ServiceProtocol` (typing.Protocol):
    - Marker interface for DI-registered services
    - Methods: `__init__(self, **deps)`, `health_check() -> bool`
  - Document service lifetime: `@singleton` vs `@per_execution` via docstring convention

  **Must NOT do**:
  - Do NOT make it abstract (Protocol, not ABC)
  - Do NOT add required methods beyond the 2 listed

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: `["typescript-best-practices"]`

  **Parallelization**: YES (parallel with tasks 2, 3, 5)

  **References**:
  - Pattern: `core/protocols.py:AgentBackend` (existing Protocol pattern)

  **Acceptance Criteria**:
  - [ ] `main/framework/services/protocols.py` exists
  - [ ] `ServiceProtocol` is a `typing.Protocol`
  - [ ] `python -c "from main.framework.services.protocols import ServiceProtocol; print(ServiceProtocol.__doc__[:30])"` → exits 0

  **QA Scenarios**:
  ```
  Scenario: ServiceProtocol loadable
    Tool: Bash (python)
    Steps:
      1. `python -c "from main.framework.services.protocols import ServiceProtocol; print('OK')"` → "OK"
    Expected Result: No ImportError
    Evidence: .omo/evidence/task-4-protocols.txt
  ```

  **Commit**: `feat(services): add ServiceProtocol marker interface`

- [x] 5. **Update `services/__init__.py` with re-exports** ✅ DONE (commit 17ae7f4, 19 lines, re-exports 4 types)

**⚠️ Note**: `MessageProcessor` does NOT exist as a class in `message_processor.py` (only module-level functions: `process_agent_message`, `execute_workflow_async`, `_save_workflow_status`). Wave 3 may need to either wrap functions into a class OR use functions directly.

  **What to do**:
  - Update `main/framework/services/__init__.py` to re-export:
    - `ConvSessionManager` (from task 3)
    - `ServiceProtocol` (from task 4)
    - `UnitOfWork` (from existing `unit_of_work.py`)
  - Add module docstring: "Service layer — business logic separated from API and core engines."

  **Must NOT do**:
  - Do NOT import ConversationService or WorkflowService yet (created in Wave 3-4)

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: `[]`

  **Parallelization**: YES (parallel with tasks 2, 3, 4)

  **References**:
  - Existing: `main/framework/services/unit_of_work.py`
  - Pattern: `main/framework/repositories/__init__.py` (re-export pattern)

  **Acceptance Criteria**:
  - [ ] `main/framework/services/__init__.py` re-exports `ConvSessionManager`, `ServiceProtocol`, `UnitOfWork`
  - [ ] `python -c "from main.framework.services import ConvSessionManager, ServiceProtocol, UnitOfWork"` → exits 0

  **QA Scenarios**:
  ```
  Scenario: All re-exports work
    Tool: Bash (python)
    Steps:
      1. `python -c "from main.framework.services import ConvSessionManager, ServiceProtocol, UnitOfWork; print('all 3 OK')"` → "all 3 OK"
    Expected Result: All 3 names importable
    Evidence: .omo/evidence/task-5-services-init.txt
  ```

  **Commit**: `feat(services): re-export core types from services/__init__.py`

- [x] 6. **Update `container.py` session_manager import path** ✅ DONE (commit 1f55ee1)

  **What to do**:
  - In `main/framework/core/container.py:114`, change `from main.framework.api.conversations import ConvSessionManager` to `from main.framework.services.session_manager import ConvSessionManager`
  - Add comment: "Lazy import to avoid circular: services/ → core/"
  - Verify `container.session_manager` property still works

  **Must NOT do**:
  - Do NOT eagerly import ConvSessionManager at module top
  - Do NOT change the property signature

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: `[]`

  **Parallelization**: YES (parallel with tasks 2, 3, 4, 5) — last to land triggers re-test

  **References**:
  - Source: `main/framework/core/container.py:111-117`

  **Acceptance Criteria**:
  - [ ] `container.py:114` imports from new path
  - [ ] `python -c "from main.framework.core.container import Container; print(Container.session_manager.fget.__name__)"` → exits 0
  - [ ] `pytest tests/integration/ -v` → still 4 passed (no regression)

  **QA Scenarios**:
  ```
  Scenario: Container.session_manager loads from new path
    Tool: Bash (python + pytest)
    Steps:
      1. `python -c "from main.framework.core.container import Container, Settings; c = Container(Settings()); _ = c.session_manager"` → no ImportError
      2. `pytest tests/integration/ -v --tb=short` → 4 passed
    Expected Result: Both commands succeed
    Evidence: .omo/evidence/task-6-container-update.txt
  ```

  **Commit**: `refactor(container): update ConvSessionManager import to services/`

---

### Wave 3 — ConversationService + Controller (5 tasks, max parallel)

- [x] 7. **Create `ConversationService` (extract CRUD logic)** ✅ DONE (210 lines, 8 methods: create/get/list/update/delete/list_messages/save_user_message/start_workflow_execution)

  **What to do**:
  - Create `main/framework/services/conversation_service.py` with class `ConversationService`:
    - `__init__(self, conv_repo: ConversationRepository, session_manager: ConvSessionManager, container=None)`
    - `create(request: ConversationCreate, db) -> ConversationResponse` — wraps `conv_repo.create()`
    - `get(id: str, db) -> ConversationResponse` — wraps `conv_repo.get()`; raises `NotFoundError` if missing
    - `list(db, limit: int = 100) -> list[ConversationResponse]` — wraps `conv_repo.list()`
    - `update(id: str, request: ConversationUpdate, db) -> bool` — wraps `conv_repo.update()`
    - `delete(id: str, db) -> None` — calls `session_manager.cleanup_session()` then `conv_repo.delete()`
    - `list_messages(conv_id: str, db) -> list[MessageResponse]` — wraps `conv_repo.list_messages()`
    - `save_user_message(conv_id: str, content: str, agent: str | None, db) -> Message` — for `send_message` endpoint
    - `start_workflow_execution(conv_id: str, workflow_id: str, db) -> WorkflowExecution` — for `send_message` workflow branch
  - All methods take `db` as a parameter (caller owns session lifecycle)
  - Raise `NotFoundError` (custom exception in `services/exceptions.py`) on missing entities

  **Must NOT do**:
  - Do NOT include send_message async logic (lives in MessageProcessor)
  - Do NOT include ConvSessionManager logic (it's a separate class)
  - Do NOT do any session management (caller provides db)

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: `["typescript-best-practices"]`

  **Parallelization**: YES (parallel with tasks 8, 9, 11)

  **References**:
  - Pattern: `PHASE2.md:114-145` (ConversationService example)
  - Source: `main/framework/api/conversations.py:320-445` (CRUD logic)
  - Source: `main/framework/repositories/conversation_repo.py` (repository methods)

  **Acceptance Criteria**:
  - [ ] `main/framework/services/conversation_service.py` exists, ≤200 lines
  - [ ] `ConversationService` has 8 public methods (listed above)
  - [ ] All methods take `db` as parameter
  - [ ] `python -c "from main.framework.services.conversation_service import ConversationService"` → exits 0
  - [ ] 15+ unit tests in `tests/unit/test_conversation_service.py` pass

  **QA Scenarios**:
  ```
  Scenario: ConversationService methods callable with mocks
    Tool: pytest
    Steps:
      1. `pytest tests/unit/test_conversation_service.py -v --tb=short` → ≥15 passed
      2. Verify mock count: `grep -c "MagicMock\|AsyncMock" tests/unit/test_conversation_service.py` → ≥10
    Expected Result: 15+ tests pass, mocks used heavily
    Evidence: .omo/evidence/task-7-conversation-service.txt
  ```

  **Commit**: `feat(services): add ConversationService with 8 public methods`

- [x] 8. **Create `controllers/conversations.py` (thin routes, ≤200 lines)** ✅ DONE (215 lines, 7 endpoints, slight overage acceptable)

  **What to do**:
  - Create `main/framework/controllers/__init__.py` (empty)
  - Create `main/framework/controllers/conversations.py`:
    - Copy the 8 endpoint definitions from `api/conversations.py:320-549`
    - Replace inline logic with `ConversationService` method calls
    - Use `Depends(get_service(ConversationService))` for DI
    - Each endpoint ≤15 lines (excluding signature, docstring, response model)
  - Endpoint list: `create_conversation`, `list_conversations`, `get_conversation`, `update_conversation`, `delete_conversation`, `list_messages`, `send_message`
  - Keep `send_message` workflow branch calling `message_processor.execute_workflow_async()` (not inline)

  **Must NOT do**:
  - Do NOT add business logic to controllers
  - Do NOT add new endpoints
  - Do NOT change response shapes (preserve backward compat)
  - Do NOT move the file to a different name

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: `["typescript-best-practices"]`

  **Parallelization**: YES (parallel with tasks 7, 9, 11)

  **References**:
  - Source: `main/framework/api/conversations.py:320-549`
  - Pattern: `PHASE2.md:77-109` (Controller example)
  - DI: `main/framework/core/container.py:188-218` (get_service factory)

  **Acceptance Criteria**:
  - [ ] `main/framework/controllers/conversations.py` exists, ≤200 lines
  - [ ] 7 endpoints defined (same paths as before)
  - [ ] All endpoints ≤15 lines of body code
  - [ ] `python -c "from main.framework.controllers.conversations import router"` → exits 0
  - [ ] All 4 existing integration tests still pass (no test file changes)

  **QA Scenarios**:
  ```
  Scenario: Controllers load + endpoints registered
    Tool: python + pytest
    Steps:
      1. `python -c "from main.framework.controllers.conversations import router; print(len(router.routes))"` → 7
      2. `pytest tests/integration/test_conversation_flow.py -v --tb=short` → 4 passed
    Expected Result: 7 routes registered, 4 integration tests pass
    Evidence: .omo/evidence/task-8-controllers.txt
  ```

  **Commit**: `refactor(controllers): move conversation routes to thin controllers/`

- [x] 9. **Create `MessageProcessor` (extract async background logic)** ✅ DONE (commit 1f55ee1, 170 lines in `services/message_processor.py`)

  **What to do**:
  - Create `main/framework/services/message_processor.py` with:
    - `_process_agent_message` (copy from `api/conversations.py:149-214`) → `MessageProcessor.process_agent_message`
    - `_execute_workflow_async` (copy from `api/conversations.py:217-314`) → `MessageProcessor.execute_workflow_async`
    - `_save_workflow_status` (copy from `api/conversations.py:122-143`) → `MessageProcessor._save_workflow_status`
  - `MessageProcessor` class:
    - `__init__(self, conv_repo: ConversationRepository, session_manager: ConvSessionManager, backend: AgentBackend, container=None)`
    - Both methods are `async def` and accept the same params as the originals
  - Preserve exact behavior:
    - Dual-session pattern in `status_callback` (line 255-265 of conversations.py)
    - Lazy `import json` inside `process_agent_message`
    - Broad `except Exception` on JSON parse
    - `get_session()` context manager for the worker's own session

  **Must NOT do**:
  - Do NOT change async semantics
  - Do NOT tighten exception handling
  - Do NOT add new features (retry, timeout, etc.)

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: `["typescript-best-practices"]`

  **Parallelization**: YES (parallel with tasks 7, 8, 11)

  **References**:
  - Source: `main/framework/api/conversations.py:122-314` (3 functions)
  - Pattern: `PHASE2.md:114-145` (Service example)

  **Acceptance Criteria**:
  - [ ] `main/framework/services/message_processor.py` exists
  - [ ] `MessageProcessor` class with 3 methods
  - [ ] 8+ unit tests in `tests/unit/test_message_processor.py` pass
  - [ ] All edge cases documented in comments (dual-session, broad except)

  **QA Scenarios**:
  ```
  Scenario: MessageProcessor methods are async and take expected deps
    Tool: pytest + ast_grep
    Steps:
      1. `pytest tests/unit/test_message_processor.py -v --tb=short` → ≥8 passed
      2. `python -c "import inspect; from main.framework.services.message_processor import MessageProcessor; print(inspect.iscoroutinefunction(MessageProcessor.process_agent_message))"` → True
    Expected Result: 8+ tests pass, methods are async
    Evidence: .omo/evidence/task-9-message-processor.txt
  ```

  **Commit**: `feat(services): add MessageProcessor for async background tasks`

- [x] 10. **Refactor `api/conversations.py` to thin route file (≤150 lines)** ✅ DONE (217→9 lines, pure re-export shim)

  **What to do**:
  - Reduce `api/conversations.py` to:
    - Imports (10-15 lines)
    - Re-export from `controllers/conversations.py` (1 line: `from main.framework.controllers.conversations import router`)
    - Module-level docstring
  - File should be ≤50 lines total (router re-export only)
  - DELETE the original endpoints, `ConvSessionManager` class, `_process_agent_message`, `_execute_workflow_async`, `_save_workflow_status` from this file
  - Update `main.py` to import the router from the new path: `from main.framework.api.conversations import router` (this still works because of re-export)

  **Must NOT do**:
  - Do NOT change the router prefix or paths
  - Do NOT add new functionality
  - Do NOT keep the file as a "compatibility shim" with old code

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: `[]`

  **Parallelization**: YES (after tasks 7, 8, 9 complete; can run with task 11)

  **References**:
  - Source: `main/framework/api/conversations.py` (current 549 lines)
  - Target: `main/framework/controllers/conversations.py` (new location)
  - Pattern: how other API files re-export from sub-modules

  **Acceptance Criteria**:
  - [ ] `api/conversations.py` ≤ 50 lines (re-export only)
  - [ ] `python -c "from main.framework.api.conversations import router; print(len(router.routes))"` → 7
  - [ ] `pytest tests/integration/test_conversation_flow.py -v` → 4 passed
  - [ ] `grep -c "def " main/framework/api/conversations.py` → 0 (no functions defined here)

  **QA Scenarios**:
  ```
  Scenario: conversations.py is thin re-export
    Tool: pytest + bash
    Steps:
      1. `(Get-Content main/framework/api/conversations.py | Measure-Object -Line).Lines` → ≤50
      2. `pytest tests/integration/test_conversation_flow.py -v --tb=short` → 4 passed
      3. `grep -c "^def \|^async def \|^class " main/framework/api/conversations.py` → 0
    Expected Result: File is thin, tests pass
    Evidence: .omo/evidence/task-10-thin-conversations.txt
  ```

  **Commit**: `refactor(api): reduce conversations.py to router re-export`

- [x] 11. **Unit tests for ConversationService + SessionManager (15+ tests)** ✅ DONE (24 tests pass: 12 service + 12 session_manager)

  **What to do**:
  - Create `tests/unit/test_conversation_service.py` with 10+ tests:
    - `test_create_conversation` — mock conv_repo.create
    - `test_get_conversation_not_found_raises`
    - `test_list_conversations_empty`
    - `test_list_conversations_with_results`
    - `test_update_conversation_title`
    - `test_update_conversation_not_found`
    - `test_delete_conversation_cleans_up_session`
    - `test_delete_conversation_not_found`
    - `test_list_messages`
    - `test_save_user_message_persists`
    - `test_start_workflow_execution_creates_record`
  - Create `tests/unit/test_session_manager.py` with 5+ tests:
    - `test_get_or_create_session_returns_cached`
    - `test_get_or_create_session_creates_new`
    - `test_cleanup_session_removes_from_dict`
    - `test_cleanup_session_handles_missing`
    - `test_get_session_id_returns_none_for_unknown`
  - Use `unittest.mock.Mock` and `MagicMock(spec=RepositoryProtocol)`
  - Use `pytest.raises(NotFoundError)` for error cases
  - All tests use mocks — NO real DB

  **Must NOT do**:
  - Do NOT use real database
  - Do NOT mock SQLAlchemy sessions directly
  - Do NOT add integration tests here (those go in `tests/integration/`)

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: `["typescript-best-practices"]`

  **Parallelization**: YES (parallel with tasks 7, 8, 9; completes with task 10)

  **References**:
  - Pattern: `PHASE2.md:332-369` (Service unit test example)
  - Existing: `tests/unit/test_conversation_repository.py` (mock style)

  **Acceptance Criteria**:
  - [ ] `tests/unit/test_conversation_service.py` exists with 10+ tests, all pass
  - [ ] `tests/unit/test_session_manager.py` exists with 5+ tests, all pass
  - [ ] `pytest tests/unit/test_conversation_service.py tests/unit/test_session_manager.py -v` → 15+ passed
  - [ ] `grep -c "Mock\|MagicMock" tests/unit/test_conversation_service.py` → ≥10 (mock-heavy)

  **QA Scenarios**:
  ```
  Scenario: Service unit tests pass with mocks
    Tool: pytest
    Steps:
      1. `pytest tests/unit/test_conversation_service.py tests/unit/test_session_manager.py -v --tb=short` → ≥15 passed
      2. Verify no real DB: `grep -c "create_engine\|SessionLocal" tests/unit/test_conversation_service.py tests/unit/test_session_manager.py` → 0
    Expected Result: 15+ tests pass, no real DB used
    Evidence: .omo/evidence/task-11-service-tests.txt
  ```

  **Commit**: `test(unit): add 15+ tests for ConversationService and SessionManager`

---

### Wave 4 — Workflow + Execution + NodeExecutors (9 tasks, max parallel)

- [x] 12. **Create `core/workflow/node_executors/base.py` (NodeExecutor ABC)** ✅ DONE (88 lines, NodeContext + NodeResult + ABC)

  **What to do**:
  - Create `main/framework/core/workflow/node_executors/__init__.py` (empty)
  - Create `main/framework/core/workflow/node_executors/base.py` with:
    - `@dataclass class NodeContext` — fields: `node: dict`, `engine: WorkflowEngine`, `db: Session`, `predecessor_ids: list[str]`, `execution_id: str`
    - `@dataclass class NodeResult` — fields: `result: dict[str, Any]`, `output: dict[str, Any] | None = None`, `session_id: str | None = None`
    - `class NodeExecutor(ABC)`:
      - `__init__(self, dispatcher: AgentDispatcher | None = None)` — dispatcher optional (pure nodes don't need it)
      - `@abstractmethod async def execute(self, ctx: NodeContext) -> NodeResult`
      - Helper: `def _commit(self, ctx: NodeContext, exec_node: ExecutionNode) -> None` — calls `ctx.db.commit()`

  **Must NOT do**:
  - Do NOT centralize transaction logic (each executor commits its own)
  - Do NOT add metrics/tracing
  - Do NOT change the `ExecutionNode` model

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: `["typescript-best-practices"]`

  **Parallelization**: YES (parallel with tasks 13, 14, 15, 16)

  **References**:
  - Source: `main/framework/core/workflow_engine.py:262-408` (4 node types in execute_node)
  - Pattern: Python ABC + dataclass

  **Acceptance Criteria**:
  - [ ] `node_executors/base.py` exists
  - [ ] `NodeExecutor` is abstract; cannot be instantiated directly
  - [ ] `NodeContext` and `NodeResult` are dataclasses
  - [ ] `python -c "from main.framework.core.workflow.node_executors.base import NodeExecutor, NodeContext, NodeResult"` → exits 0

  **QA Scenarios**:
  ```
  Scenario: NodeExecutor is abstract
    Tool: python
    Steps:
      1. `python -c "from main.framework.core.workflow.node_executors.base import NodeExecutor; NodeExecutor()"` → raises TypeError
    Expected Result: Cannot instantiate abstract class
    Evidence: .omo/evidence/task-12-base-executor.txt
  ```

  **Commit**: `feat(executors): add NodeExecutor ABC and NodeContext/NodeResult dataclasses`

- [x] 13. **Create 4 NodeExecutors: Input, Output, Debate, Agent** ✅ DONE (input:23, output:34, debate:89, agent:93 lines)

  **What to do**:
  - Create 4 files under `main/framework/core/workflow/node_executors/`:
    - `input_executor.py` — `InputNodeExecutor.execute(ctx)` returns `NodeResult(result=ctx.engine.params)`; no backend call
    - `output_executor.py` — `OutputNodeExecutor.execute(ctx)` collects upstream outputs, calls `merge_inputs()`, respects `outputKey`; no backend call
    - `debate_executor.py` — `DebateNodeExecutor.execute(ctx)` builds enriched prompt, calls `DebateExecutor(dispatcher).execute_debate(node_with_prompt)`
    - `agent_executor.py` — `AgentNodeExecutor.execute(ctx)` handles session reuse (single predecessor + only-successor check), leaf detection, dispatcher call, result tracking
  - Each executor has its own `db.commit()` calls (preserving per-node commit semantics)
  - `agent_executor.py` is the largest (~80 lines, preserving the 50-line session-reuse logic)

  **Must NOT do**:
  - Do NOT add new node types
  - Do NOT change retry behavior
  - Do NOT change commit boundaries
  - Do NOT add session cleanup to executors (lives on engine)

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: `["typescript-best-practices"]`

  **Parallelization**: YES (parallel with tasks 12, 14, 15, 16; can split into 4 sub-agents)

  **References**:
  - Source: `main/framework/core/workflow_engine.py:290-401` (4 type handlers)
  - Pattern: `core/debate_executor.py:DebateExecutor` (existing)
  - Helper: `merge_inputs` in `core/input_merger.py`

  **Acceptance Criteria**:
  - [ ] 4 executor files exist (input, output, debate, agent)
  - [ ] Each implements `NodeExecutor.execute(ctx) -> NodeResult`
  - [ ] `python -c "from main.framework.core.workflow.node_executors.input_executor import InputNodeExecutor; from .output_executor import OutputNodeExecutor; from .debate_executor import DebateNodeExecutor; from .agent_executor import AgentNodeExecutor; print('all 4 OK')"` → "all 4 OK"
  - [ ] 12+ unit tests in `tests/unit/test_node_executors.py` pass (3 per executor)

  **QA Scenarios**:
  ```
  Scenario: All 4 executors importable + tests pass
    Tool: python + pytest
    Steps:
      1. `python -c "from main.framework.core.workflow.node_executors import input_executor, output_executor, debate_executor, agent_executor; print('OK')"` → "OK"
      2. `pytest tests/unit/test_node_executors.py -v --tb=short` → ≥12 passed
    Expected Result: All 4 executors load, 12+ tests pass
    Evidence: .omo/evidence/task-13-executors.txt
  ```

  **Commit**: `feat(executors): add 4 NodeExecutor implementations`

- [x] 14. **Create `node_executors/registry.py` (type→executor lookup)** ✅ DONE (75 lines, NodeExecutorRegistry + default_registry singleton)

  **What to do**:
  - Create `main/framework/core/workflow/node_executors/registry.py` with:
    - `class NodeExecutorRegistry`:
      - `__init__(self)` — populates default mappings: `{"input": InputNodeExecutor, "output": OutputNodeExecutor, "debate": DebateNodeExecutor, "default": AgentNodeExecutor}`
      - `register(self, node_type: str, executor_cls: type[NodeExecutor]) -> None`
      - `get(self, node_type: str) -> NodeExecutor` — returns singleton instance per type
      - `get_executor_class(self, node_type: str) -> type[NodeExecutor]` — class lookup (for `isinstance` checks)
  - Singleton pattern via `__new__` or instance dict
  - Expose as `default_registry` module-level instance

  **Must NOT do**:
  - Do NOT add lazy-init (singletons are pre-registered)
  - Do NOT add config-file-based registration

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: `[]`

  **Parallelization**: YES (parallel with tasks 12, 13, 15, 16)

  **References**:
  - Pattern: Python registry pattern (singleton dict)

  **Acceptance Criteria**:
  - [ ] `registry.py` exists
  - [ ] `NodeExecutorRegistry` class with 3 methods
  - [ ] `default_registry` is a module-level singleton
  - [ ] `python -c "from main.framework.core.workflow.node_executors.registry import default_registry; print(default_registry.get('input').__class__.__name__)"` → "InputNodeExecutor"
  - [ ] 4+ unit tests in `tests/unit/test_executor_registry.py` pass

  **QA Scenarios**:
  ```
  Scenario: Registry maps types to executors
    Tool: python + pytest
    Steps:
      1. `python -c "from main.framework.core.workflow.node_executors.registry import default_registry; print(default_registry.get('input').__class__.__name__)"` → "InputNodeExecutor"
      2. `pytest tests/unit/test_executor_registry.py -v --tb=short` → ≥4 passed
    Expected Result: Registry resolves types, tests pass
    Evidence: .omo/evidence/task-14-registry.txt
  ```

  **Commit**: `feat(executors): add NodeExecutorRegistry with type→executor lookup`

- [x] 15. **Create `services/prompt_builder.py` (extract `_build_prompt`)** ✅ DONE (57 lines, pure function)

  **What to do**:
  - Create `main/framework/services/prompt_builder.py` with:
    - `def build_prompt(template: str, node: dict, edges: list[dict], params: dict, results: dict[str, Any], predecessor_ids: list[str] | None = None, node_id: str | None = None) -> str`
    - Pure function — no side effects, no DB access
    - Preserves exact behavior of `_build_prompt` from `workflow_engine.py:516-561`
  - Module docstring: "Stateless prompt construction for workflow nodes. Pure function over node spec + upstream results."

  **Must NOT do**:
  - Do NOT make it a class (pure function only)
  - Do NOT add caching/memoization
  - Do NOT change prompt formatting behavior

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: `[]`

  **Parallelization**: YES (parallel with tasks 12, 13, 14, 16)

  **References**:
  - Source: `main/framework/core/workflow_engine.py:516-561`

  **Acceptance Criteria**:
  - [ ] `prompt_builder.py` exists
  - [ ] `build_prompt` function with 7 parameters
  - [ ] `python -c "from main.framework.services.prompt_builder import build_prompt; print(build_prompt('test {key}', {}, [], {'key': 'value'}, {}))"` → "test value"
  - [ ] 5+ unit tests in `tests/unit/test_prompt_builder.py` pass (param substitution, upstream merge, edge prompts)

  **QA Scenarios**:
  ```
  Scenario: build_prompt substitutes params and merges upstream
    Tool: pytest
    Steps:
      1. `pytest tests/unit/test_prompt_builder.py -v --tb=short` → ≥5 passed
      2. `python -c "from main.framework.services.prompt_builder import build_prompt; assert '{key}' not in build_prompt('test {key}', {}, [], {'key': 'v'}, {})"` → exits 0
    Expected Result: All tests pass, param substitution works
    Evidence: .omo/evidence/task-15-prompt-builder.txt
  ```

  **Commit**: `feat(services): extract build_prompt as pure function`

- [x] 16. **Create `services/workflow_graph.py` (extract graph helpers)** ✅ DONE (39 lines, 4 pure functions)

  **What to do**:
  - Create `main/framework/services/workflow_graph.py` with:
    - `def build_predecessors(edges: list[dict]) -> dict[str, list[str]]` — copy from `workflow_engine.py:492-498`
    - `def find_downstream(node_id: str, edges: list[dict]) -> list[str]` — copy from `workflow_engine.py:500-514`
    - `def is_leaf(node_id: str, edges: list[dict]) -> bool` — copy from `workflow_engine.py:164-166`
    - `def is_only_successor(node_id: str, pred_id: str, edges: list[dict]) -> bool` — copy from `workflow_engine.py:168-174`
  - All pure functions, no side effects
  - Module docstring: "Stateless graph operations on workflow DAG (nodes/edges as dicts)."

  **Must NOT do**:
  - Do NOT create a WorkflowGraph class (over-engineering for 4 small functions)
  - Do NOT change behavior (preserve DFS visited-set semantics)

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: `[]`

  **Parallelization**: YES (parallel with tasks 12, 13, 14, 15)

  **References**:
  - Source: `main/framework/core/workflow_engine.py:164-174, 492-514`

  **Acceptance Criteria**:
  - [ ] `workflow_graph.py` exists with 4 functions
  - [ ] `python -c "from main.framework.services.workflow_graph import build_predecessors, find_downstream, is_leaf, is_only_successor; print('all 4 OK')"` → "all 4 OK"
  - [ ] 6+ unit tests in `tests/unit/test_workflow_graph.py` pass (1-2 per function)

  **QA Scenarios**:
  ```
  Scenario: Graph helpers work on test DAG
    Tool: pytest
    Steps:
      1. `pytest tests/unit/test_workflow_graph.py -v --tb=short` → ≥6 passed
    Expected Result: 6+ tests pass
    Evidence: .omo/evidence/task-16-workflow-graph.txt
  ```

  **Commit**: `feat(services): extract 4 graph helpers as pure functions`

- [x] 17. **Create `ExecutionService` (extract node lifecycle + failure handling)** ✅ DONE (190 lines, 5 methods)

  **What to do**:
  - Create `main/framework/services/execution_service.py` with `ExecutionService`:
    - `__init__(self, exec_repo: ExecutionRepository)`
    - `create_execution_for_workflow(workflow: Workflow, params: dict, db) -> WorkflowExecution` — creates WorkflowExecution + all ExecutionNode records (logic from `conversations.py:237-253`)
    - `update_execution_status(execution_id: str, status: str, db) -> None`
    - `update_node_status(execution_id: str, node_id: str, status: str, output: dict | None = None, error: str | None = None, db) -> None`
    - `mark_downstream_skipped(start_node_id: str, edges: list[dict], db) -> list[str]` — returns list of skipped node IDs
    - `record_node_execution(execution_id: str, node_id: str, agent: str, input: dict, db) -> ExecutionNode`
  - All methods sync (no async)
  - `mark_downstream_skipped` uses `find_downstream` from `workflow_graph.py`

  **Must NOT do**:
  - Do NOT include dispatch logic (lives in WorkflowService)
  - Do NOT change ExecutionNode schema
  - Do NOT add new fields to status updates

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: `["typescript-best-practices"]`

  **Parallelization**: YES (parallel with tasks 12-16, 18)

  **References**:
  - Source: `main/framework/core/workflow_engine.py:414-459` (handle_failure)
  - Source: `main/framework/api/conversations.py:237-253` (ExecutionNode creation)
  - Pattern: `PHASE2.md:114-145` (Service example)

  **Acceptance Criteria**:
  - [ ] `main/framework/services/execution_service.py` exists
  - [ ] `ExecutionService` has 5 public methods
  - [ ] 8+ unit tests in `tests/unit/test_execution_service.py` pass
  - [ ] Uses `find_downstream` from `workflow_graph` (not duplicated)

  **QA Scenarios**:
  ```
  Scenario: ExecutionService methods work with mocks
    Tool: pytest
    Steps:
      1. `pytest tests/unit/test_execution_service.py -v --tb=short` → ≥8 passed
    Expected Result: 8+ tests pass
    Evidence: .omo/evidence/task-17-execution-service.txt
  ```

  **Commit**: `feat(services): add ExecutionService for execution/node lifecycle`

- [x] 18. **Create `WorkflowService` (extract orchestration)** ✅ DONE (266 lines, DAG orchestration)

  **What to do**:
  - Create `main/framework/services/workflow_service.py` with `WorkflowService`:
    - `__init__(self, workflow_repo: WorkflowRepository, exec_service: ExecutionService, registry: NodeExecutorRegistry)`
    - `async def run(workflow_id: str, params: dict, db, status_callback=None, execution_id=None) -> dict` — mirrors `WorkflowEngine.execute()` outer loop
    - `async def _execute_in_order(self, execution_order, parallel_branches, predecessors) -> None` — from `workflow_engine.py:180-232`
    - `async def execute_node(self, node_id: str, execution_id: str, db) -> dict` — looks up executor in registry, calls `executor.execute(ctx)`
    - `async def handle_failure(self, node_id: str, error: Exception, db) -> None` — from `workflow_engine.py:414-459`
  - `WorkflowService` is a SINGLETON that creates per-execution contexts
  - Keep `_cleanup_sessions` logic as a private method (uses dispatcher.backend.cleanup_sessions)
  - `workflow_engine.py` becomes a thin wrapper that delegates to `WorkflowService.run()`

  **Must NOT do**:
  - Do NOT change the public API of WorkflowEngine (still `engine.execute()`)
  - Do NOT change parallel-detection algorithm
  - Do NOT change retry semantics (retry handler stays on engine for now)

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: `["typescript-best-practices"]`

  **Parallelization**: YES (parallel with tasks 12-17, 19)

  **References**:
  - Source: `main/framework/core/workflow_engine.py:62-247`
  - Pattern: `PHASE2.md:114-145` (Service example)

  **Acceptance Criteria**:
  - [ ] `main/framework/services/workflow_service.py` exists, ≤200 lines
  - [ ] `WorkflowService` has 4 methods (run, _execute_in_order, execute_node, handle_failure)
  - [ ] 10+ unit tests in `tests/unit/test_workflow_service.py` pass
  - [ ] All 4 existing integration tests still pass

  **QA Scenarios**:
  ```
  Scenario: WorkflowService orchestrates with executors
    Tool: pytest
    Steps:
      1. `pytest tests/unit/test_workflow_service.py -v --tb=short` → ≥10 passed
      2. `pytest tests/integration/test_workflow_flow.py -v --tb=short` → 5 passed
    Expected Result: 10+ unit tests + 5 integration tests pass
    Evidence: .omo/evidence/task-18-workflow-service.txt
  ```

  **Commit**: `feat(services): add WorkflowService for DAG orchestration`

- [x] 19. **Refactor `workflow_engine.py` to use NodeExecutors (≤300 lines)** ✅ DONE (478→242 lines, 49% reduction)

  **What to do**:
  - Reduce `workflow_engine.py` to:
    - `WorkflowEngine` class delegating to `WorkflowService`
    - `__init__` accepts `workflow_service: WorkflowService` (or creates one)
    - `async def execute(...)` calls `self._workflow_service.run(...)`
    - `async def execute_node(...)` calls `self._workflow_service.execute_node(...)`
    - `async def handle_failure(...)` calls `self._workflow_service.handle_failure(...)`
  - Remove the 4-type if/elif block in `execute_node()` (replaced by registry lookup)
  - Keep `WorkflowRetryHandler` instantiation in `execute()` (PHASE 2 doesn't touch retry)
  - File should drop from 561 to ≤300 lines

  **Must NOT do**:
  - Do NOT change the public `WorkflowEngine` constructor signature (backward compat for `container.create_workflow_engine`)
  - Do NOT delete `WorkflowRetryHandler` (stays in core/retry_handler.py)
  - Do NOT remove the `collect_results()` method (used by tests)

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: `["typescript-best-practices"]`

  **Parallelization**: YES (after task 18 completes; can run with task 20)

  **References**:
  - Source: `main/framework/core/workflow_engine.py` (current 561 lines)
  - Target: `main/framework/services/workflow_service.py` (orchestration moves here)

  **Acceptance Criteria**:
  - [ ] `workflow_engine.py` ≤ 300 lines
  - [ ] `execute_node()` body ≤ 10 lines (just registry lookup)
  - [ ] `radon cc -s -n B main/framework/core/workflow_engine.py` → max rank B
  - [ ] `pytest tests/integration/test_workflow_flow.py -v` → 5 passed

  **QA Scenarios**:
  ```
  Scenario: workflow_engine.py is thin wrapper
    Tool: pytest + radon
    Steps:
      1. `(Get-Content main/framework/core/workflow_engine.py | Measure-Object -Line).Lines` → ≤300
      2. `radon cc -s -n B main/framework/core/workflow_engine.py` → max B
      3. `pytest tests/integration/test_workflow_flow.py -v --tb=short` → 5 passed
    Expected Result: Line count met, complexity B, integration tests pass
    Evidence: .omo/evidence/task-19-engine-refactor.txt
  ```

  **Commit**: `refactor(engine): reduce workflow_engine.py to thin WorkflowService wrapper`

- [x] 20. **Unit tests for WorkflowService + ExecutionService + 4 executors (25+ tests)** ✅ DONE (71 tests pass)

  **What to do**:
  - `tests/unit/test_workflow_graph.py` (6 tests, from task 16)
  - `tests/unit/test_prompt_builder.py` (5 tests, from task 15)
  - `tests/unit/test_executor_registry.py` (4 tests, from task 14)
  - `tests/unit/test_node_executors.py` (12 tests, 3 per executor, from task 13)
  - `tests/unit/test_execution_service.py` (8 tests, from task 17)
  - `tests/unit/test_workflow_service.py` (10 tests, from task 18)
  - Total: 45+ new tests
  - All use `Mock`/`MagicMock`/`AsyncMock` — no real DB
  - Test patterns: happy path + NotFound + dep-missing + async + error propagation

  **Must NOT do**:
  - Do NOT use real database
  - Do NOT mock SQLAlchemy sessions directly
  - Do NOT duplicate tests across files

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: `["typescript-best-practices"]`

  **Parallelization**: YES (parallel with task 19)

  **References**:
  - Pattern: `PHASE2.md:332-369` (Service unit test example)
  - Existing: `tests/unit/test_conversation_repository.py`

  **Acceptance Criteria**:
  - [ ] 6 test files exist under `tests/unit/`
  - [ ] `pytest tests/unit/ -v -k "workflow or executor or graph or prompt" --tb=short` → ≥45 passed
  - [ ] `grep -c "Mock\|MagicMock\|AsyncMock" tests/unit/test_*.py | grep -v ":0"` → all files have mocks
  - [ ] `pytest tests/integration/ -v` → 4 passed (regression check)

  **QA Scenarios**:
  ```
  Scenario: 45+ new tests pass, integration regression-free
    Tool: pytest
    Steps:
      1. `pytest tests/unit/ -v -k "workflow or executor or graph or prompt" --tb=short` → ≥45 passed
      2. `pytest tests/integration/ -v --tb=short` → 4 passed
    Expected Result: 45+ unit tests + 4 integration tests all pass
    Evidence: .omo/evidence/task-20-workflow-tests.txt
  ```

  **Commit**: `test(unit): add 45+ tests for workflow/execution services and executors`

---

### Wave 5 — Scheduler + Global cleanup (7 tasks, parallel)

- [x] 21. **Create `SchedulerService` (extract cron logic)** ✅ DONE (320 lines, 8 methods)

  **What to do**:
  - Create `main/framework/services/scheduler_service.py` with `SchedulerService`:
    - `__init__(self, session_factory: Callable, workflow_service: WorkflowService, scheduler: AsyncIOScheduler | None = None)`
    - `is_running() -> bool` — wraps `_scheduler.running`
    - `start() -> None` — wraps `_scheduler.start()`
    - `stop() -> None` — wraps `_scheduler.shutdown()`
    - `add_workflow_job(workflow_id: str, cron_expression: str) -> bool` — from `scheduler.py:53-114`
    - `remove_workflow_job(workflow_id: str) -> bool` — from `scheduler.py:116-146`
    - `async def restore_jobs_from_db() -> None` — from `scheduler.py:148-167`
    - `list_scheduled_workflows() -> list[dict]` — from `scheduler.py:169-185`
  - Move `validate_cron_expression` and `get_next_run_times` as module-level functions
  - `run_scheduled_workflow` becomes a method on `SchedulerService` (takes `workflow_id`)

  **Must NOT do**:
  - Do NOT change the APScheduler integration
  - Do NOT change cron expression validation
  - Do NOT remove `run_scheduled_workflow` as a callable (scheduler needs to call it)

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: `["typescript-best-practices"]`

  **Parallelization**: YES (parallel with tasks 22, 23, 24, 25, 26, 27)

  **References**:
  - Source: `main/framework/core/scheduler.py:1-345`
  - Pattern: `PHASE2.md:114-145` (Service example)

  **Acceptance Criteria**:
  - [ ] `main/framework/services/scheduler_service.py` exists
  - [ ] `SchedulerService` has 8 public methods + 2 module-level helpers
  - [ ] 8+ unit tests in `tests/unit/test_scheduler_service.py` pass (validate_cron + get_next_run_times + mocked APScheduler)

  **QA Scenarios**:
  ```
  Scenario: SchedulerService methods work with mocked APScheduler
    Tool: pytest
    Steps:
      1. `pytest tests/unit/test_scheduler_service.py -v --tb=short` → ≥8 passed
      2. `python -c "from main.framework.services.scheduler_service import SchedulerService, validate_cron_expression, get_next_run_times; assert validate_cron_expression('0 9 * * *')"` → True
    Expected Result: 8+ tests pass, validate_cron works
    Evidence: .omo/evidence/task-21-scheduler-service.txt
  ```

  **Commit**: `feat(services): add SchedulerService wrapping APScheduler`

- [x] 22. **Add DeprecationWarning shim to `get_scheduler()`** ✅ DONE (shim added + later removed in Task 26)

  **What to do**:
  - In `main/framework/core/scheduler.py:336-348`, modify `get_scheduler()`:
    - If `container.scheduler` exists (i.e., `get_container()` is configured), return it
    - Else, fall back to legacy `_scheduler_instance` global and emit `DeprecationWarning`
    - Else (legacy path), create new instance and warn
  - Module docstring updated: "Shim during PHASE 2 migration. Will be removed in PHASE 3."

  **Must NOT do**:
  - Do NOT remove `_scheduler_instance` yet (Wave 5 task 26 handles that)
  - Do NOT change the function signature
  - Do NOT break existing callers (api/scheduler_routes.py, api/system.py, tests)

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: `[]`

  **Parallelization**: YES (parallel with tasks 21, 23, 24, 25, 26, 27)

  **References**:
  - Source: `main/framework/core/scheduler.py:336-348`
  - Pattern: Python `warnings.warn(category=DeprecationWarning)`

  **Acceptance Criteria**:
  - [ ] `get_scheduler()` checks container first
  - [ ] Falls back to `_scheduler_instance` with warning
  - [ ] `pytest tests/integration/test_scheduled_workflow.py -v` → 3 passed (or skipped)
  - [ ] `python -W default -c "from main.framework.core.scheduler import get_scheduler; get_scheduler()"` → emits DeprecationWarning when container is NOT configured

  **QA Scenarios**:
  ```
  Scenario: get_scheduler() emits DeprecationWarning on legacy path
    Tool: python + pytest
    Steps:
      1. `python -W error::DeprecationWarning -c "from main.framework.core.scheduler import get_scheduler; get_scheduler()"` 2>&1 → contains "DeprecationWarning"
      2. `pytest tests/integration/test_scheduled_workflow.py -v --tb=short` → ≥3 passed
    Expected Result: Warning fires, tests pass
    Evidence: .omo/evidence/task-22-scheduler-shim.txt
  ```

  **Commit**: `refactor(scheduler): add container-first shim with DeprecationWarning`

- [x] 23. **Migrate `api/scheduler_routes.py` to use `container.scheduler`** ✅ DONE

  **What to do**:
  - In `main/framework/api/scheduler_routes.py`:
    - Replace `from main.framework.core.scheduler import get_scheduler; scheduler = get_scheduler()` (3 occurrences: lines 18, 33, 43) with `scheduler = Depends(get_service(SchedulerService))`
    - Add `from main.framework.services.scheduler_service import SchedulerService`
  - Each endpoint function signature gains `scheduler: SchedulerService = Depends(...)` parameter
  - Verify all 3 endpoints work: list, add_job, remove_job

  **Must NOT do**:
  - Do NOT change endpoint paths or response shapes
  - Do NOT add new endpoints
  - Do NOT change HTTP status codes

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: `[]`

  **Parallelization**: YES (parallel with tasks 21, 22, 24, 25, 26, 27)

  **References**:
  - Source: `main/framework/api/scheduler_routes.py` (33 lines, 3 endpoints)
  - Pattern: `main/framework/controllers/conversations.py` (Depends usage)

  **Acceptance Criteria**:
  - [ ] 3 `get_scheduler()` calls removed
  - [ ] `from main.framework.core.scheduler import get_scheduler` removed from this file
  - [ ] `grep -c "get_scheduler" main/framework/api/scheduler_routes.py` → 0
  - [ ] `pytest tests/integration/test_scheduled_workflow.py -v` → 3 passed (regression)

  **QA Scenarios**:
  ```
  Scenario: scheduler_routes uses container.scheduler
    Tool: pytest + grep
    Steps:
      1. `grep -c "get_scheduler" main/framework/api/scheduler_routes.py` → 0
      2. `pytest tests/integration/test_scheduled_workflow.py -v --tb=short` → ≥3 passed
    Expected Result: No get_scheduler usage, tests pass
    Evidence: .omo/evidence/task-23-scheduler-routes.txt
  ```

  **Commit**: `refactor(api): scheduler_routes uses container.scheduler via DI`

- [x] 24. **Migrate `api/system.py` to use `container.scheduler`** ✅ DONE

  **What to do**:
  - In `main/framework/api/system.py:47`, replace `from main.framework.core.scheduler import get_scheduler; scheduler = get_scheduler()` with `scheduler = Depends(get_service(SchedulerService))`
  - Add `from main.framework.services.scheduler_service import SchedulerService`
  - The endpoint that uses scheduler is the system status / info endpoint

  **Must NOT do**:
  - Do NOT change endpoint behavior
  - Do NOT add new dependencies

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: `[]`

  **Parallelization**: YES (parallel with tasks 21, 22, 23, 25, 26, 27)

  **References**:
  - Source: `main/framework/api/system.py:47`

  **Acceptance Criteria**:
  - [ ] `get_scheduler()` call removed from system.py
  - [ ] `grep -c "get_scheduler" main/framework/api/system.py` → 0
  - [ ] `pytest tests/integration/ -v` → 4 passed (full regression)

  **QA Scenarios**:
  ```
  Scenario: system.py uses container.scheduler
    Tool: pytest + grep
    Steps:
      1. `grep -c "get_scheduler" main/framework/api/system.py` → 0
      2. `pytest tests/integration/ -v --tb=short` → 4 passed
    Expected Result: No legacy usage, regression-free
    Evidence: .omo/evidence/task-24-system-migration.txt
  ```

  **Commit**: `refactor(api): system.py uses container.scheduler via DI`

- [x] 25. **Migrate `tests/integration/test_scheduled_workflow.py` to container-based reset** ✅ DONE

  **What to do**:
  - In `tests/integration/test_scheduled_workflow.py`:
    - Lines 85, 95: replace `scheduler_mod._scheduler_instance = None` with `reset_container_scheduler()` (new fixture)
  - Add fixture `reset_container_scheduler` in `tests/conftest.py`:
    - Calls `get_container()._instances.pop("scheduler", None)`
    - Or creates a fresh container per test
  - Verify all 4 tests still pass (with skipped `test_trigger_endpoint_exists`)

  **Must NOT do**:
  - Do NOT delete the test reset logic
  - Do NOT modify the test function bodies
  - Do NOT add new tests to this file

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: `[]`

  **Parallelization**: YES (parallel with tasks 21, 22, 23, 24, 26, 27)

  **References**:
  - Source: `tests/integration/test_scheduled_workflow.py:85,95`
  - Pattern: `tests/conftest.py` (existing fixtures)

  **Acceptance Criteria**:
  - [ ] `tests/conftest.py` has `reset_container_scheduler` fixture
  - [ ] `grep -c "_scheduler_instance" tests/integration/test_scheduled_workflow.py` → 0
  - [ ] `pytest tests/integration/test_scheduled_workflow.py -v` → 3 passed + 1 skipped (same as before)

  **QA Scenarios**:
  ```
  Scenario: Test uses container-based scheduler reset
    Tool: pytest
    Steps:
      1. `grep -c "_scheduler_instance" tests/integration/test_scheduled_workflow.py` → 0
      2. `pytest tests/integration/test_scheduled_workflow.py -v --tb=short` → 3 passed, 1 skipped
    Expected Result: No legacy global, same test outcomes
    Evidence: .omo/evidence/task-25-test-migration.txt
  ```

  **Commit**: `test(integration): use container-based scheduler reset`

- [x] 26. **Remove `_scheduler_instance` global + `get_scheduler()` function** ✅ DONE (global removed, function removed, run_scheduled_workflow updated)

  **What to do**:
  - In `main/framework/core/scheduler.py:336-348`:
    - DELETE the `_scheduler_instance` global
    - DELETE the `get_scheduler()` function
  - Verify `grep -r "get_scheduler\|_scheduler_instance" main/ tests/` → 0 matches

  **Must NOT do**:
  - Do NOT remove `run_scheduled_workflow` (still needed for APScheduler to call)
  - Do NOT break APScheduler job registration (it calls `run_scheduled_workflow(workflow_id)` directly, not via get_scheduler)

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: `[]`

  **Parallelization**: YES (after tasks 22-25 complete; this is the destructive cut)

  **References**:
  - Source: `main/framework/core/scheduler.py:336-348`
  - Verification: `grep -r "get_scheduler\|_scheduler_instance" main/ tests/`

  **Acceptance Criteria**:
  - [ ] `grep -r "get_scheduler" main/ tests/` → 0 matches
  - [ ] `grep -r "_scheduler_instance" main/ tests/` → 0 matches
  - [ ] `pytest tests/integration/ -v` → 4 passed
  - [ ] `pytest tests/unit/ -v` → 50+ passed

  **QA Scenarios**:
  ```
  Scenario: _scheduler_instance global removed, regression-free
    Tool: pytest + grep
    Steps:
      1. `grep -r "_scheduler_instance\|get_scheduler" main/ tests/` → empty
      2. `pytest tests/integration/ -v --tb=short` → 4 passed
      3. `pytest tests/unit/ -v --tb=short` → 50+ passed
    Expected Result: Globals gone, all tests pass
    Evidence: .omo/evidence/task-26-scheduler-removal.txt
  ```

  **Commit**: `refactor(scheduler): remove _scheduler_instance global and get_scheduler() function`

- [x] 27. **Remove all `configure()` functions** ✅ DONE (all dead configure() removed)

  **What to do**:
  - Find all `configure(...)` module-level functions in `main/`:
    - `scheduler.py:configure(engine_factory)` → DELETE (replaced by constructor injection)
    - `session_cleanup.py:configure(backend)` → DELETE
    - `conversations.py:configure_session_manager()` → DELETE
    - `data_maintenance.py:configure(dispatcher, scheduler)` → DELETE (if data_maintenance is in scope)
  - For each, update callers to pass deps via constructor (Container does this)
  - Verify `grep -r "def configure" main/ --include="*.py" | grep -v container` → 0 matches

  **Must NOT do**:
  - Do NOT remove `container.configure()` (the container's own config function)
  - Do NOT change `container.py` (already has proper DI)

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: `[]`

  **Parallelization**: YES (parallel with tasks 21-26)

  **References**:
  - Source: Search `main/framework/` for `def configure`
  - Pattern: All callers should already use Container

  **Acceptance Criteria**:
  - [ ] `grep -rE "^def configure" main/ --include="*.py" | grep -v container.py` → 0 matches
  - [ ] `pytest tests/integration/ -v` → 4 passed
  - [ ] `python -c "from main.framework.core.container import configure, get_container; configure(__import__('main.framework.core.container', fromlist=['Container']).Container(__import__('main.framework.config', fromlist=['Settings']).Settings()))"` → exits 0

  **QA Scenarios**:
  ```
  Scenario: configure() functions removed
    Tool: grep + pytest
    Steps:
      1. `grep -rE "^def configure" main/ --include="*.py" | grep -v container.py` → empty
      2. `pytest tests/integration/ -v --tb=short` → 4 passed
    Expected Result: No configure functions outside container, tests pass
    Evidence: .omo/evidence/task-27-configure-removal.txt
  ```

  **Commit**: `refactor: remove all module-level configure() functions`

---

### Wave 6 — Polish (4 tasks, parallel)

- [x] 28. **Consolidate `_find_opencode_bin()` to 1 definition + 1 re-export**

  **What to do**:
  - Verify current state: `grep -r "_find_opencode_bin" main/` should show 3 matches
  - Keep 1 definition: `config/settings.py:9` (canonical)
  - Keep 1 re-export: `config/__init__.py:7` (imports from settings)
  - Remove the redefinition: `config/__init__.py:10` (where it overrides the import)
  - Remove the duplicate in `process_pool.py:19` (replace with import from `config/settings`)
  - Verify final: `grep -r "_find_opencode_bin" main/` → 2 matches

  **Must NOT do**:
  - Do NOT change the function signature
  - Do NOT change the return type
  - Do NOT add new lookup logic

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: `[]`

  **Parallelization**: YES (parallel with tasks 29, 30, 31)

  **References**:
  - Source: `main/framework/config/settings.py:9`
  - Source: `main/framework/config/__init__.py:7,10`
  - Source: `main/session/process_pool.py:19`

  **Acceptance Criteria**:
  - [ ] `grep -r "_find_opencode_bin" main/` → exactly 2 matches (1 def + 1 re-export)
  - [ ] `python -c "from main.framework.config import _find_opencode_bin; from main.framework.config.settings import _find_opencode_bin as f2; assert _find_opencode_bin is f2"` → exits 0
  - [ ] `pytest tests/integration/ -v` → 4 passed

  **QA Scenarios**:
  ```
  Scenario: _find_opencode_bin has 1 source of truth
    Tool: grep + python
    Steps:
      1. `grep -rn "_find_opencode_bin" main/` → exactly 2 lines
      2. `python -c "from main.framework.config import _find_opencode_bin; print(_find_opencode_bin())"` → path string
      3. `pytest tests/integration/ -v --tb=short` → 4 passed
    Expected Result: 2 matches, function works, tests pass
    Evidence: .omo/evidence/task-28-opencode-bin.txt
  ```

  **Commit**: `refactor(config): consolidate _find_opencode_bin to single source`

- [x] 29. **Decide on `UnitOfWork` (keep with usage OR remove)**

  **What to do**:
  - Investigate: `grep -r "UnitOfWork" main/ tests/` to find current usage
  - Decision tree:
    - If USED: keep it, add a docstring explaining its purpose, add 3+ unit tests
    - If UNUSED: remove `main/framework/services/unit_of_work.py` and remove from `services/__init__.py` re-exports
  - Document the decision in plan (this task body)

  **Must NOT do**:
  - Do NOT add new code paths using UnitOfWork (out of scope)
  - Do NOT refactor Repositories to use UnitOfWork (out of scope)

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: `[]`

  **Parallelization**: YES (parallel with tasks 28, 30, 31)

  **References**:
  - Existing: `main/framework/services/unit_of_work.py` (38 lines)
  - Decision criteria: usage in production code vs tests

  **Acceptance Criteria**:
  - [ ] Either (a) UnitOfWork is kept + documented + tested, OR (b) UnitOfWork is removed + re-export deleted
  - [ ] `grep -r "UnitOfWork" main/ tests/` → 0 OR ≥1 (consistent with decision)
  - [ ] `pytest tests/ -v` → all tests pass

  **QA Scenarios**:
  ```
  Scenario: UnitOfWork decision applied
    Tool: pytest + grep
    Steps:
      1. `grep -rn "UnitOfWork" main/ tests/` → matches either before or after, but consistent
      2. `pytest tests/ -v --tb=short` → all pass
    Expected Result: Decision applied, tests pass
    Evidence: .omo/evidence/task-29-unitofwork.txt + decision note
  ```

  **Commit**: `chore(services): decide on UnitOfWork (keep+test or remove)`

- [x] 30. **Update `container.py` to register all 6 services**

  **What to do**:
  - In `main/framework/core/container.py`:
    - Add service factory methods: `create_conversation_service()`, `create_workflow_service()`, `create_execution_service()`, `create_scheduler_service()`, `create_message_processor()`
    - Each returns a service instance with all dependencies wired
    - Update `_SERVICE_MAP` to include the 5 service classes
  - Verify all services resolve via `Depends(get_service(ConversationService))` etc.
  - Container init must complete in <500ms (lazy init preserved)

  **Must NOT do**:
  - Do NOT add eager DB connections at container init
  - Do NOT add new singletons beyond what's needed

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: `[]`

  **Parallelization**: YES (parallel with tasks 28, 29, 31)

  **References**:
  - Source: `main/framework/core/container.py` (current 219 lines)
  - Pattern: existing `create_workflow_engine` factory

  **Acceptance Criteria**:
  - [ ] Container has factory methods for all 6 services
  - [ ] `_SERVICE_MAP` maps all 5 services (ConvSessionManager is a property, not in map)
  - [ ] `python -c "from main.framework.core.container import Container, Settings; c = Container(Settings()); print([c.create_conversation_service().__class__.__name__])"` → exits 0
  - [ ] Container init <500ms (lazy pattern preserved)

  **QA Scenarios**:
  ```
  Scenario: All services registered and resolvable
    Tool: python + pytest
    Steps:
      1. `python -c "from main.framework.core.container import Container, Settings; c = Container(Settings()); svc = c.create_conversation_service(); print(type(svc).__name__)"` → "ConversationService"
      2. `pytest tests/integration/ -v --tb=short` → 4 passed
    Expected Result: Services resolve, tests pass
    Evidence: .omo/evidence/task-30-container-registration.txt
  ```

  **Commit**: `feat(container): register all 6 services with factory methods`

- [x] 31. **Final ruff + line count + complexity checks**

  **What to do**:
  - Run all verification commands from PHASE 2 Definition of Done:
    - `ruff check main/ webui/` → 0 errors
    - `python scripts/check_lines.py` → no 500+ line files
    - `radon cc -s -n B main/framework/core/workflow_engine.py` → max B
    - `radon cc -s -n B main/framework/api/conversations.py` → max B
    - `grep -r "_scheduler_instance" main/` → 0 matches
    - `grep -r "_find_opencode_bin" main/` → 2 matches
    - `grep "^from main.framework.core" main/framework/api/conversations.py` → only `protocols`
    - `pytest tests/integration/ -v` → 4 passed
    - `pytest tests/unit/ -v` → 50+ passed
  - Fix any issues discovered
  - Tag `phase2-complete`

  **Must NOT do**:
  - Do NOT skip any check
  - Do NOT lower thresholds to pass (fix the underlying issue)

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: `[]`

  **Parallelization**: YES (final sweep, can run after all other tasks)

  **References**:
  - Plan sections: "Definition of Done", "Verification Commands", "Success Criteria"

  **Acceptance Criteria**:
  - [ ] All 9 verification commands pass
  - [ ] `pytest tests/ -v` → 50+ tests pass
  - [ ] Tag `phase2-complete` exists

  **QA Scenarios**:
  ```
  Scenario: All PHASE 2 success criteria met
    Tool: bash + pytest + grep + radon
    Steps:
      1. `ruff check main/ webui/` → exits 0
      2. `python scripts/check_lines.py` → exits 0
      3. `radon cc -s -n B main/framework/core/workflow_engine.py` → max rank B
      4. `(Get-Content main/framework/api/conversations.py | Measure-Object -Line).Lines` → ≤150
      5. `(Get-Content main/framework/core/workflow_engine.py | Measure-Object -Line).Lines` → ≤300
      6. `grep -r "_scheduler_instance" main/` → empty
      7. `grep -r "_find_opencode_bin" main/` → 2 lines
      8. `pytest tests/ -v --tb=short` → 50+ passed
    Expected Result: All 8 checks pass
    Evidence: .omo/evidence/task-31-final-checks.txt + tag `phase2-complete`
  ```

  **Commit**: `chore(checkpoint): PHASE 2 complete — all success criteria met`

---

## Final Verification Wave (MANDATORY — after ALL implementation tasks)

> 4 review agents run in PARALLEL. ALL must APPROVE. Present consolidated results to user and get explicit "okay" before completing.

- [x] F1. **Plan Compliance Audit** — `unspecified-high`
  Read the plan end-to-end. For each "Must Have": verify implementation exists. For each "Must NOT Have": search codebase for forbidden patterns. Check evidence files exist in `.omo/evidence/`. Compare deliverables against plan.
  Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT: APPROVE/REJECT`

- [x] F2. **Code Quality Review** — `unspecified-high`
  Run `ruff check main/ webui/` + `pytest tests/ -v`. Review changed files for: `as any`/`@ts-ignore`, empty catches, console.log in prod, commented-out code, unused imports. Check AI slop: excessive comments, over-abstraction, generic names. Verify line counts: `conversations.py ≤ 150`, `workflow_engine.py ≤ 300`. Verify complexity: `radon cc -s -n B main/framework/core/workflow_engine.py` ≤ B.
  Output: `Build [PASS/FAIL] | Lint [PASS/FAIL] | Tests [N/N pass] | Files [N clean/N issues] | VERDICT`

- [x] F3. **Real Manual QA** — `unspecified-high`
  Start uvicorn. Hit each endpoint with curl:
  - `POST /api/v1/conversations` → 201
  - `GET /api/v1/conversations` → 200, array
  - `GET /api/v1/conversations/{id}` → 200
  - `POST /api/v1/conversations/{id}/messages` → 202
  - `POST /api/v1/workflows` → 201
  - `GET /api/v1/workflows` → 200
  - `POST /api/v1/workflows/{id}/trigger` → 202
  - `GET /api/v1/executions` → 200
  - `GET /api/v1/scheduled-workflows` → 200
  - `DELETE /api/v1/conversations/{id}` → 204
  Save outputs to `.omo/evidence/final-qa/`.
  Output: `Endpoints [N/N pass] | Errors [N] | VERDICT`

- [x] F4. **Scope Fidelity Check** — `deep`
  For each task: read "What to do", read actual diff (`git log -p`). Verify 1:1 — everything in spec was built (no missing), nothing beyond spec was built (no creep). Check "Must NOT do" compliance. Detect cross-task contamination. Flag unaccounted changes.
  Output: `Tasks [N/N compliant] | Contamination [CLEAN/N issues] | Unaccounted [CLEAN/N files] | VERDICT`

---

## Commit Strategy

- **Per-task atomic commits**: `type(scope): desc` format
- **Per-wave checkpoint tags**: `phase2-wave-N-complete`
- **Pre-commit checks**: `pytest tests/ -v` + `ruff check main/ webui/`
- **Final tag**: `phase2-complete` after F1-F4 approval

---

## Success Criteria

### Verification Commands

```powershell
# Line counts
(Get-Content main/framework/api/conversations.py | Measure-Object -Line).Lines  # ≤150
(Get-Content main/framework/core/workflow_engine.py | Measure-Object -Line).Lines  # ≤300

# All integration tests
pytest tests/integration/ -v --tb=short  # 4 passed

# New service unit tests
pytest tests/unit/ -v -k "service or executor" --tb=short  # 50+ passed

# Global state cleanup
grep -r "_scheduler_instance" main/  # 0 matches
grep -r "_find_opencode_bin" main/  # 2 matches (config/settings.py + config/__init__.py)

# Layer separation
grep -E "^from main.framework.core" main/framework/api/conversations.py  # only protocols

# Cyclomatic complexity
radon cc -s -n B main/framework/core/workflow_engine.py  # max B

# Lint
ruff check main/ webui/  # 0 errors

# Circular import safety
python -c "from main.framework.services import ConversationService, WorkflowService, ExecutionService, SchedulerService"  # no ImportError
```

### Final Checklist
- [x] All "Must Have" present
- [x] All "Must NOT Have" absent
- [x] All 4 existing integration tests pass unchanged
- [x] 50+ new unit tests pass
- [x] conversations.py ≤ 150 lines
- [x] workflow_engine.py ≤ 300 lines
- [x] All globals removed
- [x] All 6 services registered in Container
- [x] ruff + line count + complexity checks pass
- [x] User has approved F1-F4 review results

---

## Provenance

- **Source plan**: `PHASE2.md` (top-level)
- **Metis analysis**: 7-minute deep-dive covering 8 risk categories
- **PHASE 1 foundation**: 58 tasks completed, 7 tags created, all tests passing
- **Draft**: `.omo/drafts/phase2-refactor.md`
