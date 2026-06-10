# Task 6.4 — Production Wiring Audit

**Date**: 2026-06-10
**Branch**: phase3-api-observability
**File audited**: `main/framework/main.py` (268 lines)
**Status**: PASS — all wiring correct, no fixes needed

---

## 1. Middleware Order

**Requirement**: `RequestContextMiddleware` → `APIKeyMiddleware` → `CORSMiddleware` (execution order)

**Verification** (programmatic):
```
python -c "from main.framework.main import app; print([m.cls.__name__ for m in app.user_middleware])"
→ ['RequestContextMiddleware', 'APIKeyMiddleware', 'CORSMiddleware']
```

**Add-order in code** (Starlette last-added = outermost = first to execute):

| # | Line | Middleware | Role |
|---|------|-----------|------|
| 1 | 47 | `CORSMiddleware` | Added first → innermost (executes last) |
| 2 | 61 | `APIKeyMiddleware` | Added second → middle |
| 3 | 72 | `RequestContextMiddleware` | Added last → outermost (executes first) |

**Result**: ✅ PASS — RequestContextMiddleware is outermost, assigns `X-Request-ID` before any other middleware runs. CORS and APIKey can read `get_request_id()`.

---

## 2. Exception Handlers

| # | Line | Handler | Status Code | Format |
|---|------|---------|-------------|--------|
| 1 | 91 | `HTTPException` | per-exception | RFC 7807 ✅ |
| 2 | 118 | `Exception` | 500 | RFC 7807 ✅ |
| 3 | 141 | `ServiceError` | 500 | RFC 7807 ✅ |
| 4 | 166 | `NotFoundError` | 404 | RFC 7807 ✅ |
| 5 | 184 | `RequestValidationError` | 422 | RFC 7807 ✅ |

**Note**: Plan specified 4 handlers; code has 5. The extra `NotFoundError` handler (404) is a subclass-specific override that takes precedence over the generic `ServiceError` handler (500). This is correct — NotFoundError should return 404, not 500.

All handlers use `problem_response()` from `main/framework/api/problems.py` which returns `application/problem+json`.

**Result**: ✅ PASS — all 5 handlers registered, all return RFC 7807 envelopes.

---

## 3. Logger Setup

**Line 34**: `logger = get_logger(__name__)`

`get_logger()` (logger.py:79-89) calls `setup_logger()` internally on first invocation, which:
- Creates a `StreamHandler` to stdout
- Applies `JsonLogFormatter` (JSON per line with timestamp, level, logger, message, request_id, module, line)
- Sets `propagate=False` to prevent duplicate output

**Result**: ✅ PASS — `setup_logger()` is called at module load via `get_logger()`.

---

## 4. Router Inclusions

| # | Line | Router | Source Module |
|---|------|--------|---------------|
| 1 | 75 | `agents_router` | `main.framework.api.agents` |
| 2 | 76 | `tools_router` | `main.framework.api.tools` |
| 3 | 77 | `skills_router` | `main.framework.api.skills` |
| 4 | 80 | `scheduler_router` | `main.framework.api.scheduler_routes` |
| 5 | 81 | `workflows_router` | `main.framework.api.workflows` |
| 6 | 82 | `triggers_router` | `main.framework.api.triggers` |
| 7 | 83 | `system_router` | `main.framework.api.system` |
| 8 | 84 | `conversations_router` | `main.framework.api.conversations` |
| 9 | 85 | `sessions_router` | `main.framework.api.sessions` |
| 10 | 86 | `executions_router` | `main.framework.api.executions` |
| 11 | 87 | `dispatch_router` | `main.framework.api.dispatch` |
| 12 | 88 | `data_maintenance_router` | `main.data_maintenance.api.data_maintenance` |

**Note on `problems`**: `main.framework.api.problems` exports `ProblemDetail` and `problem_response` — it's a utility module with no `router`. It's correctly imported (line 16) and used by exception handlers. No router inclusion needed.

**Result**: ✅ PASS — all 12 routers included. `problems` is correctly treated as a utility.

**Scheduler ordering note** (line 78-79): Scheduler routes are intentionally included BEFORE workflows so that the explicit `/scheduled` path registers before the catch-all `/{workflow_id}`. This is correct.

---

## 5. Lifespan / Lifecycle

| Event | Line | Handler | Actions |
|-------|------|---------|---------|
| startup | 232 | `startup()` | Start scheduler, restore jobs from DB, init data maintenance, register `MaintenanceQueryService` factory |
| shutdown | 263 | `shutdown()` | Stop scheduler, cleanup sessions |

**Note**: Uses deprecated `@app.on_event("startup"/"shutdown")` decorators instead of modern `lifespan` context manager. Functional but will emit deprecation warnings in future FastAPI versions. Out of scope for this task.

**Result**: ✅ PASS — both lifecycle handlers present and functional.

---

## 6. Additional Observations

### Minor: Unused import
- Line 3: `timezone` imported but unused (only `UTC` is used at line 220)
- Impact: None (cosmetic)
- Recommendation: Clean up in a future linting pass

### Health endpoint
- Line 217-222: `/api/v1/health` returns `{"status": "ok", "timestamp": "..."}`
- Simple, no middleware dependencies — correct

---

## Summary

| Check | Result |
|-------|--------|
| Middleware order (RequestContext outermost) | ✅ PASS |
| Exception handlers (5 total, all RFC 7807) | ✅ PASS |
| setup_logger() called at module load | ✅ PASS |
| All routers included (12 + 1 utility) | ✅ PASS |
| Lifecycle handlers (startup + shutdown) | ✅ PASS |

**No fixes required.** Production wiring is correct and complete.
