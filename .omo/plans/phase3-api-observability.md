# PHASE 3 — API Contract Hardening & Observability

**Status**: DRAFT (awaiting Start Work approval)
**Branch**: `phase3-api-observability`
**Plan file**: `.omo/plans/phase3-api-observability.md`
**Predecessor**: PHASE 2 (`tag: phase2-complete`, 35/35 tasks done)

---

## 0. Background & Rationale

### Why this phase
After PHASE 1 (foundation) and PHASE 2 (service-layer extraction), the framework has clean internal layering but inconsistent **external contracts**:

| Issue | Evidence | Impact |
|---|---|---|
| 11 of 12 routers are "fat handlers" | `api/workflows.py` (316 lines, 8 raise sites), `api/executions.py` (224 lines), `api/sessions.py` (250 lines), `system.py` (192 lines), etc. | Mixed concerns; HTTP + business logic in one file |
| Two parallel exception hierarchies | `core/exceptions.py` (5 classes, **0 call sites** = dead code) + `services/exceptions.py` (2 classes, only 1 file catches) | `NotFoundError` is re-caught 6 times in `controllers/conversations.py`; everywhere else hand-rolls `if not entity: raise 404` |
| No request-ID propagation | Zero matches for `request_id` / `trace_id` / `correlation_id`; only `APIKeyMiddleware` exists | Logs from one request can't be correlated; debugging async background tasks is painful |
| Plain-text logs | `logger.py:14-19` format `"%(asctime)s - %(name)s - %(levelname)s - %(message)s"`; `setup_logger()` is **never called** (every module uses `logging.getLogger(__name__)`) | Not machine-parseable; can't pipe to ELK/Loki without regex |
| `{"detail": ...}` errors | `main.py:72-85` only registers handlers for `HTTPException` and `Exception`; nothing for `NotFoundError`/`ServiceError`/`ValidationError` | Not RFC 7807; clients can't programmatically distinguish error categories |
| Inconsistent DI | Three patterns coexist: `Depends(get_db)`, `Depends(get_service(...))`, `request.app.state.container` | `_SERVICE_MAP` only covers repos; services require manual string-key registration |
| 33% endpoint coverage | 17 of 51 endpoints have integration tests; `system.py`, `sessions.py`, `tools.py`, `skills.py`, `data_maintenance.py`, `/health` have **zero** | Refactoring risk: changes break untested paths silently |

### User-confirmed scope (interview)
- **Direction**: API endpoint consolidation + Observability/error handling
- **Scenario**: 功能迭代期 (feature iteration phase — frequent changes, multi-contributor)
- **Scale**: Standard (30–45 tasks)
- **Observability stack**: Light — JSON logs + `trace_id` (no OpenTelemetry, no Prometheus)
- **OpenAPI**: FastAPI auto-generation (no separate schema authoring)
- **Error response format**: RFC 7807 problem+json

### Out of scope (deferred to PHASE 4+)
- Prometheus metrics / OpenTelemetry tracing
- Rate limiting / circuit breakers
- DB query optimization (PHASE 4 candidate)
- Authentication/authorization beyond API key (PHASE 5 candidate)
- API versioning (URL-based)
- Async/scheduler concurrency hardening

### Risk register
1. **Background tasks lose request_id context** — `triggers.py` runs workflows in `asyncio.create_task`; need to capture contextvar before scheduling.
2. **RFC 7807 breaks clients expecting `{"detail": ...}`** — any internal client code must be updated simultaneously.
3. **Fat handler migration might drop business logic** — pilot (Wave 2) validates the extraction pattern before scaling.
4. **Container changes break conftest.py** — the test fixture manually injects services (lines 112–124); must coordinate with Wave 4.
5. **JSON log format may not be backward-compatible** — if anything currently greps the text format, the change will break it. Audit before Wave 1 ships.

---

## 1. Definition of Done

- [ ] All 12 `api/*.py` routers migrated to `controllers/*.py` (matching the `conversations.py` re-export pattern)
- [ ] Single `core/exceptions.py` with unified `FrameworkError` tree + subclasses
- [ ] `@app.exception_handler(FrameworkError)` + `@app.exception_handler(RequestValidationError)` registered, returning RFC 7807 problem+json
- [ ] `RequestContextMiddleware` reads/generates `X-Request-ID`, populates `current_request_id: ContextVar`, attaches to all log records
- [ ] JSON log formatter with required fields: `timestamp`, `level`, `logger`, `message`, `request_id`, `module`
- [ ] `setup_logger()` is the single entry point (every module uses it, no raw `getLogger(__name__)`)
- [ ] `_SERVICE_MAP` extended to include all 4 service classes; manual string-key registration removed
- [ ] `Depends(get_service(...))` is the only DI pattern (no `Depends(get_db)`, no `request.app.state.container` in route handlers)
- [ ] `response_model=` declared on every route; OpenAPI spec accessible at `/openapi.json` with descriptions
- [ ] Integration test coverage ≥70% of endpoints (36+/51)
- [ ] All 149+ unit tests + 35+ integration tests pass
- [ ] `ruff check .` exits 0
- [ ] Branch tagged `phase3-complete`
- [ ] `git log --oneline phase2-complete..HEAD` shows wave-by-wave commits

---

## 2. Task Breakdown (37 tasks across 6 waves + Final Wave)

### Wave 1 — Foundation: Request Context, JSON Logging, Exception Unification (7 tasks)

**Parallelization**: ALL 7 tasks are parallelizable — different files, no shared deps.

- [ ] **1.1** Create `core/request_context.py` with `current_request_id: ContextVar[str | None]` + `get_request_id()` helper
  - File: `main/framework/core/request_context.py` (~25 lines)
  - Acceptance: `python -c "from main.framework.core.request_context import current_request_id, get_request_id; print(get_request_id())"` → outputs `None`

- [ ] **1.2** Create `RequestContextMiddleware` (reads/generates `X-Request-ID`, sets contextvar)
  - File: `main/framework/core/request_context.py` (add `RequestContextMiddleware(BaseHTTPMiddleware)`)
  - Acceptance: `curl -H 'X-Request-ID: test-123' http://localhost:8000/api/v1/health -i` → response includes `X-Request-ID: test-123` header
  - Pattern: existing `core/auth.py:7-22` `APIKeyMiddleware`

- [ ] **1.3** Create JSON log formatter (`JsonLogFormatter` with required fields)
  - File: `main/framework/core/logger.py` (replace text formatter)
  - Fields: `timestamp`, `level`, `logger`, `message`, `request_id`, `module`, `line`, `exc_info` (if present)
  - Acceptance: `python -c "from main.framework.core.logger import JsonLogFormatter; import logging; h=logging.StreamHandler(); h.setFormatter(JsonLogFormatter()); print(h.format(logging.LogRecord('x',logging.INFO,'/p','1','hi',None,None)))"` → outputs valid JSON with `request_id` field

- [ ] **1.4** Make `setup_logger()` the only entry point; add `LoggerAdapter` that auto-injects `request_id`
  - File: `main/framework/core/logger.py`
  - Replace `setup_logger()` body to use `JsonLogFormatter`
  - Add `get_logger(name) -> logging.LoggerAdapter` that auto-injects `current_request_id.get()`
  - Acceptance: `python -c "from main.framework.core.logger import get_logger; l=get_logger('test'); l.info('hello')"` → JSON output with `"request_id": null`

- [ ] **1.5** Unify exception taxonomy: delete `core/exceptions.py` dead code, expand `services/exceptions.py`
  - Delete: `main/framework/core/exceptions.py` (5 unused classes)
  - Expand: `main/framework/services/exceptions.py` to include `ValidationError`, `ConflictError`, `AuthenticationError` (if needed; only what callers actually need)
  - Map: `JobNotFoundError` → `NotFoundError(resource="job")`, `AgentNotFoundError` → `NotFoundError(resource="agent")`, `SchedulerError` → `ServiceError`
  - Acceptance: `grep -r "from main.framework.core.exceptions" main/ tests/` → 0 matches

- [ ] **1.6** Add global exception handlers in `main/main.py` for `ServiceError`, `RequestValidationError`
  - File: `main/framework/main.py` (add to lines 72–85)
  - Map `NotFoundError` → 404 problem+json, `ServiceError` → 500, `ValidationError` → 422, `RequestValidationError` → 422
  - Use `ProblemDetail` Pydantic model: `{"type": "...", "title": "...", "status": ..., "detail": "...", "instance": "..."}`
  - Acceptance: `curl http://localhost:8000/api/v1/conversations/00000000-0000-0000-0000-000000000000` → 404 with `application/problem+json` content-type and `{"type": "...", "title": "Not Found", "status": 404, ...}`

- [ ] **1.7** Add `ProblemDetail` Pydantic model + custom JSON response class
  - File: `main/framework/api/problems.py` (new, ~30 lines)
  - Class: `class ProblemDetail(BaseModel)` with fields per RFC 7807
  - Helper: `problem_response(status: int, title: str, detail: str, type_uri: str = "about:blank") -> JSONResponse` with `media_type="application/problem+json"`
  - Acceptance: `python -c "from main.framework.api.problems import ProblemDetail, problem_response; print(ProblemDetail(status=404, title='Not Found').model_dump())"` → dict with all RFC 7807 fields

**Wave 1 commit**: `chore(phase3-w1): request context + JSON logs + exception unification + RFC 7807 handlers`
**Wave 1 tag**: `phase3-wave-1-complete`

---

### Wave 2 — Pilot: Workflow Router Migration (6 tasks)

**Parallelization**: Tasks 2.2, 2.3, 2.4 sequential to each other; 2.1, 2.5, 2.6 parallel.

- [ ] **2.1** Create `services/workflow_query_service.py` (extracted business logic)
  - File: `main/framework/services/workflow_query_service.py` (~180 lines)
  - Methods: `list_workflows`, `get_workflow`, `get_workflow_stats`, `validate_workflow_dag`, `update_workflow`, `delete_workflow`, `trigger_workflow`
  - Pattern: existing `services/conversation_service.py` (210 lines, dependency-injected repo)
  - Acceptance: `python -c "from main.framework.services.workflow_query_service import WorkflowQueryService"` works

- [ ] **2.2** Create `controllers/workflows.py` with thin handlers (≤200 lines)
  - File: `main/framework/controllers/workflows.py` (~190 lines)
  - 7 handlers: list, create, get, get_stats, update, delete, trigger
  - Each handler: parse path/query/body, call service, wrap response
  - Pattern: existing `controllers/conversations.py` (215 lines)
  - Acceptance: `python -c "from main.framework.controllers.workflows import router; print(len(router.routes))"` → 7

- [ ] **2.3** Convert `api/workflows.py` to thin re-export (≤15 lines)
  - File: `main/framework/api/workflows.py` (overwrite, 3–5 lines)
  - Content: `from main.framework.controllers.workflows import router`
  - Acceptance: `wc -l main/framework/api/workflows.py` → ≤15

- [ ] **2.4** Register `WorkflowQueryService` in Container + `_SERVICE_MAP`
  - File: `main/framework/core/container.py` (add to `_SERVICE_MAP` ~line 270, add factory method)
  - Acceptance: `python -c "from main.framework.core.container import Container; c=Container(Settings()); print(c.workflow_query_service)"` → returns instance

- [ ] **2.5** Update `tests/integration/test_workflow_flow.py` for new endpoints
  - File: `tests/integration/test_workflow_flow.py`
  - Assert response shapes (RFC 7807 on errors), status codes, basic CRUD
  - Add 2 new tests: list, get_stats
  - Acceptance: `pytest tests/integration/test_workflow_flow.py -v` → all pass

- [ ] **2.6** Add `tests/integration/test_problem_details.py` (lock RFC 7807 contract)
  - File: `tests/integration/test_problem_details.py` (new, ~80 lines)
  - Tests: 404 returns `application/problem+json` with required fields; 422 returns problem+json for bad input
  - Acceptance: `pytest tests/integration/test_problem_details.py -v` → all pass

**Wave 2 commit**: `chore(phase3-w2): pilot — migrate workflows.py to controllers/workflows.py + ProblemDetail tests`
**Wave 2 tag**: `phase3-wave-2-complete`

---

### Wave 3 — Parallel Migration of 9 Remaining Routers (10 tasks)

**Parallelization**: ALL 10 tasks parallel — different files, no shared deps.

Pattern (apply identically to each router):
1. Create `controllers/<name>.py` with thin handlers calling service
2. Create `services/<name>_service.py` (only if business logic exists; skip if already thin)
3. Overwrite `api/<name>.py` to ≤10-line re-export
4. Update existing integration test (or add minimal test if none exists)

- [ ] **3.1** Migrate `executions.py` (224 lines, 5 routes, 6 raise sites, has `retry` business logic)
  - Files: `main/framework/controllers/executions.py` (new, ≤200 lines), `main/framework/api/executions.py` (≤10 lines), `main/framework/services/execution_query_service.py` (new, ~120 lines)
  - Service methods: `list_executions`, `get_execution`, `get_timeline`, `retry_execution`, `abort_execution`
  - Update: `tests/integration/test_workflow_flow.py` (existing retry coverage)

- [ ] **3.2** Migrate `sessions.py` (250 lines, 4 routes, 4 raise sites, reaches into private `_session()`)
  - Files: `main/framework/controllers/sessions.py` (new, ≤200 lines), `main/framework/api/sessions.py` (≤10 lines)
  - Service: skip (logic is mostly session-cleanup orchestration; keep in controller as composition)

- [ ] **3.3** Migrate `triggers.py` (181 lines, 3 routes, 3 raise sites, has background `_run_workflow_async`)
  - Files: `main/framework/controllers/triggers.py` (new, ≤150 lines), `main/framework/api/triggers.py` (≤10 lines)
  - **Special**: must capture `current_request_id` before `asyncio.create_task` so background logs keep correlation
  - Update: existing `test_workflow_flow.py` trigger smoke test

- [ ] **3.4** Migrate `agents.py` (82 lines, 3 routes, 1 raise, has 30-line `agent_stats` aggregation)
  - Files: `main/framework/controllers/agents.py` (new, ≤70 lines), `main/framework/api/agents.py` (≤10 lines)
  - Service: extract `agent_stats` aggregation to `services/agent_query_service.py` (~50 lines)

- [ ] **3.5** Migrate `tools.py` (51 lines, 3 routes, 1 raise, `/{name}/invoke` is a stub)
  - Files: `main/framework/controllers/tools.py` (new, ≤50 lines), `main/framework/api/tools.py` (≤10 lines)
  - Move `_load_tools_from_opencode()` call from import-time to lazy (service init)

- [ ] **3.6** Migrate `skills.py` (55 lines, 2 routes, 1 raise, `trigger_skill` is a stub)
  - Files: `main/framework/controllers/skills.py` (new, ≤50 lines), `main/framework/api/skills.py` (≤10 lines)

- [ ] **3.7** Migrate `system.py` (192 lines, 3 routes, 0 raise, multi-subsystem aggregator)
  - Files: `main/framework/controllers/system.py` (new, ≤170 lines), `main/framework/api/system.py` (≤10 lines)
  - Service: extract 3 aggregator methods to `services/system_query_service.py` (~140 lines)

- [ ] **3.8** Migrate `dispatch.py` (120 lines, 2 routes, 1 raise)
  - Files: `main/framework/controllers/dispatch.py` (new, ≤100 lines), `main/framework/api/dispatch.py` (≤10 lines)
  - Update: existing `tests/integration/test_dispatch_flow.py`

- [ ] **3.9** Migrate `scheduler_routes.py` (51 lines, 3 routes, 2 raise)
  - Files: `main/framework/controllers/scheduler.py` (new, ≤50 lines), `main/framework/api/scheduler_routes.py` (≤10 lines)

- [ ] **3.10** Migrate `data_maintenance.py` (142 lines, 9 routes, 7 raise)
  - Files: `main/data_maintenance/controllers/data_maintenance.py` (new, ≤140 lines), `main/data_maintenance/api/data_maintenance.py` (≤10 lines)
  - Update: add new test file `tests/integration/test_data_maintenance.py`

**Wave 3 commit**: `chore(phase3-w3): parallel migrate 9 remaining routers to controllers/*`
**Wave 3 tag**: `phase3-wave-3-complete`

---

### Wave 4 — Container & DI Hardening (4 tasks)

**Parallelization**: Tasks 4.1, 4.2, 4.3 are sequential; 4.4 parallel.

- [ ] **4.1** Extend `_SERVICE_MAP` to include all 4 service classes + new query services
  - File: `main/framework/core/container.py` (modify `_SERVICE_MAP` ~line 270)
  - Include: `WorkflowQueryService`, `ExecutionQueryService`, `AgentQueryService`, `SystemQueryService`, plus existing services
  - Acceptance: `python -c "from main.framework.core.container import Container, _SERVICE_MAP; print(sorted(_SERVICE_MAP.keys()))"` includes all services

- [ ] **4.2** Add `Container.register(name: str, instance: object)` helper + audit test conftest
  - File: `main/framework/core/container.py` (add `register()` method)
  - Refactor: `tests/conftest.py:112-124` (remove manual `_instances["SchedulerService"] = ...`)
  - Acceptance: `pytest tests/integration/ -v` → all 17+ tests pass with simplified conftest

- [ ] **4.3** Standardize DI to single `Depends(get_service(...))` pattern
  - Files: 11 controller files (Wave 2 + Wave 3 outputs)
  - Remove: any `Depends(get_db)` and `request.app.state.container` references from controllers/
  - Acceptance: `grep -rn "Depends(get_db)" main/framework/controllers/` → 0 matches
  - Acceptance: `grep -rn "request.app.state.container" main/framework/controllers/` → 0 matches

- [ ] **4.4** Add `tests/unit/test_container_service_map.py` (lock DI contract)
  - File: `tests/unit/test_container_service_map.py` (~60 lines)
  - Test: every service in `_SERVICE_MAP` is constructible; missing key raises descriptive error
  - Acceptance: `pytest tests/unit/test_container_service_map.py -v` → all pass

**Wave 4 commit**: `chore(phase3-w4): container hardening — _SERVICE_MAP + register() helper + standardized Depends()`
**Wave 4 tag**: `phase3-wave-4-complete`

---

### Wave 5 — Integration Test Backfill (9 tasks)

**Parallelization**: ALL 9 tasks parallel — different test files, no shared deps.

- [ ] **5.1** Add `tests/integration/test_health_endpoint.py` (1 endpoint: `GET /api/v1/health`)
  - Coverage: 200 OK, JSON body shape, `X-Request-ID` echo

- [ ] **5.2** Add `tests/integration/test_system_endpoints.py` (3 endpoints: status, logs/stats, cache)
  - Coverage: 200 with expected shape; logs/stats returns dict with counts

- [ ] **5.3** Add `tests/integration/test_sessions_endpoints.py` (4 endpoints)
  - Coverage: list, get by id, cleanup, force-clean; assert `X-Request-ID` propagation

- [ ] **5.4** Add `tests/integration/test_executions_endpoints.py` (4 endpoints: list, detail, timeline, DELETE abort)
  - Coverage: 200 with pagination, 404 for unknown id, DELETE returns 204

- [ ] **5.5** Add `tests/integration/test_triggers_endpoints.py` (2 endpoints: status, result)
  - Coverage: 200 for existing execution; 404 for missing

- [ ] **5.6** Add `tests/integration/test_agents_endpoints.py` (3 endpoints: list, stats, get by name)
  - Coverage: 200 with list shape; stats returns dict; 404 for unknown agent

- [ ] **5.7** Add `tests/integration/test_tools_endpoints.py` (3 endpoints)
  - Coverage: list 200, get by name 200, invoke stub returns documented error

- [ ] **5.8** Add `tests/integration/test_skills_endpoints.py` (2 endpoints)
  - Coverage: list 200, trigger stub returns documented response

- [ ] **5.9** Add `tests/integration/test_request_id_propagation.py` (lock trace_id contract)
  - File: `tests/integration/test_request_id_propagation.py` (~70 lines)
  - Test: client-provided `X-Request-ID` is echoed in response; auto-generated when absent; logger records same value

**Wave 5 commit**: `chore(phase3-w5): backfill integration tests — 35+ endpoints covered (33% → 70%+)`
**Wave 5 tag**: `phase3-wave-5-complete`

---

### Wave 6 — OpenAPI Hardening & Final Wiring (5 tasks)

**Parallelization**: Tasks 6.1, 6.2, 6.3 sequential; 6.4, 6.5 parallel.

- [ ] **6.1** Add descriptions, examples, `model_config = ConfigDict(json_schema_extra={...})` to all Pydantic response/request models
  - Files: 13 schemas (`schemas/conversation.py`, all response/request models in services)
  - Acceptance: `curl http://localhost:8000/openapi.json | jq '.components.schemas.ConversationResponse'` → has `description` and `example`

- [ ] **6.2** Add FastAPI `tags` to all route handlers (organize OpenAPI by resource)
  - Files: 12 controllers (Wave 2 + Wave 3 outputs)
  - Tags: `conversations`, `workflows`, `executions`, `sessions`, `triggers`, `agents`, `tools`, `skills`, `system`, `dispatch`, `scheduler`, `data-maintenance`, `health`
  - Acceptance: `curl http://localhost:8000/openapi.json | jq '.tags'` → all 13 tags present

- [ ] **6.3** Register `ProblemDetail` and standard error responses in OpenAPI
  - File: `main/framework/api/problems.py` (update)
  - Add `responses={404: {"model": ProblemDetail}, 422: {"model": ProblemDetail}, 500: {"model": ProblemDetail}}` to representative routes
  - Acceptance: `curl http://localhost:8000/openapi.json | jq '.components.responses'` → includes 404/422/500 with `application/problem+json`

- [ ] **6.4** Verify production wiring — `RequestContextMiddleware` registered first, exception handlers registered
  - File: `main/framework/main.py` (final wiring audit)
  - Middleware order: `RequestContextMiddleware` → `APIKeyMiddleware` → `CORSMiddleware`
  - Exception handlers: `RequestValidationError`, `ServiceError`, `HTTPException`, `Exception`
  - Acceptance: `python -c "from main.framework.main import app; print([m.cls.__name__ for m in app.user_middleware])"` → order is correct

- [ ] **6.5** Final integration sweep — run all integration tests, fix any cross-file breakage
  - Files: `tests/integration/` (all)
  - Acceptance: `pytest tests/integration/ -v` → all 35+ tests pass
  - Acceptance: `pytest tests/ -v` → all 149+ unit + 35+ integration pass

**Wave 6 commit**: `chore(phase3-w6): OpenAPI hardening + final wiring`
**Wave 6 tag**: `phase3-wave-6-complete`

---

### Final Verification Wave (4 tasks)

- [ ] **F1** Plan Compliance Audit — verify all DoD items satisfied
  - Category: `unspecified-high`
  - Skills: `["requesting-code-review"]`

- [ ] **F2** Code Quality Review — ruff, complexity, file size
  - Category: `unspecified-high`
  - Skills: `["typescript-best-practices", "improve-codebase-architecture"]`

- [ ] **F3** Real Manual QA — curl 10 representative endpoints, verify RFC 7807 + trace_id + JSON logs
  - Category: `unspecified-high`
  - Skills: `["agent-browser"]`

- [ ] **F4** Scope Fidelity Review — no out-of-scope changes leaked in
  - Category: `unspecified-high`
  - Skills: `["improve-codebase-architecture"]`

---

## 3. Plan Analysis

```
TASK ANALYSIS:
- Total tasks: 37 (33 implementation + 4 final wave)
- Implementation: 33
- Final Wave: 4

WAVE PARALLELIZATION:
- Wave 1: 7 tasks — ALL parallel (different files)
- Wave 2: 6 tasks — 4 parallel + 2 sequential after pilot
- Wave 3: 10 tasks — ALL parallel (different routers)
- Wave 4: 4 tasks — 3 sequential + 1 parallel
- Wave 5: 9 tasks — ALL parallel (different test files)
- Wave 6: 5 tasks — 3 sequential + 2 parallel
- Final Wave: 4 tasks — ALL parallel

MINIMUM PARALLEL BATCH SIZE: 7 (Wave 1, Wave 3 has 10, Wave 5 has 9)
MAXIMUM PARALLEL BATCH SIZE: 10 (Wave 3)

TOTAL SEQUENTIAL BOTTLENECKS: 4 (all in Wave 6 are minor)
```

---

## 4. Notepad Initialization

```bash
mkdir -p .omo/notepads/phase3-api-observability
touch .omo/notepads/phase3-api-observability/{learnings,decisions,issues,problems}.md
```

---

## 5. Tag & Branch Strategy

| Event | Tag | Branch |
|---|---|---|
| Plan approved | — | `phase3-api-observability` (cut from `phase2-complete`) |
| Wave 1 done | `phase3-wave-1-complete` | — |
| Wave 2 done | `phase3-wave-2-complete` | — |
| Wave 3 done | `phase3-wave-3-complete` | — |
| Wave 4 done | `phase3-wave-4-complete` | — |
| Wave 5 done | `phase3-wave-5-complete` | — |
| Wave 6 done | `phase3-wave-6-complete` | — |
| Final Wave passed | `phase3-complete` | (ready for merge) |

---

## 6. Estimated Effort

| Wave | Tasks | Parallelism | Wall-clock estimate |
|---|---|---|---|
| W1 | 7 | 7 parallel | ~15 min |
| W2 | 6 | 4 parallel + 2 seq | ~30 min |
| W3 | 10 | 10 parallel | ~45 min |
| W4 | 4 | 3 seq + 1 parallel | ~25 min |
| W5 | 9 | 9 parallel | ~30 min |
| W6 | 5 | 3 seq + 2 parallel | ~25 min |
| FW | 4 | 4 parallel | ~45 min |
| **Total** | **47** | — | **~3.5 hours** |

(Estimates based on PHASE 2 averages: 8m35s for biggest task, 38s for trivial.)

---

## 7. Decisions Resolved (interview 2026-06-10)

- [x] **W1.5 exception scope**: KEEP MINIMAL — `ServiceError` + `NotFoundError` only. `RequestValidationError` / `HTTPException` map directly in handlers; no `ValidationError`/`ConflictError` added.
- [x] **W3.10 scope**: INCLUDE `data_maintenance/api/data_maintenance.py` (142 lines, 9 endpoints). Creates `main/data_maintenance/controllers/data_maintenance.py`.
- [x] **W6.2 OpenAPI tags**: USE 13 default tags — `conversations`, `workflows`, `executions`, `sessions`, `triggers`, `agents`, `tools`, `skills`, `system`, `dispatch`, `scheduler`, `data-maintenance`, `health`.
- [x] **JSON log destination**: stdout (default — Docker/k8s/PM2 standard).

---

## 8. Ready to Start?

This plan is in DRAFT status. Two paths forward:

### A. Start Work (recommended)
- Cut branch `phase3-api-observability` from `phase2-complete`
- Initialize boulder
- Dispatch Wave 1 (7 parallel tasks)
- Auto-continue through Wave 6 + Final Wave

### B. Refine Plan First
- Adjust scope, reorder waves, split/merge tasks
- Resolve the 4 open decisions in section 7
- Re-run planning until you approve

Choose A or B (or specify changes).