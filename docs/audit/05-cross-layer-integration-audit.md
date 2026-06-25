# Cross-Layer Integration Audit Report

**Date:** 2026-06-25
**Scope:** Full-stack integration gaps between frontend (React/TypeScript), backend (Fastify/TypeScript), database (SQLite/Drizzle), and agent adapter (OpenClaw)
**Audit Type:** Cross-layer contract, type, config, error propagation, workflow engine, and agent adapter consistency

---

## Severity Summary

| Severity | Count | Description |
|----------|-------|-------------|
| CRITICAL | 16 | Causes runtime failure (crash, undefined access, silent wrong data, unreachable code paths) |
| HIGH | 8 | Causes incorrect behavior, data loss, or significant maintainability debt |
| MEDIUM | 12 | Causes degraded UX, dead code, or moderate architectural debt |
| LOW | 4 | Causes observability or debuggability issues |

**Total Findings: 40**

---

## 1. API Contract Mismatches

### Critical

| # | Issue | Files | Lines |
|---|-------|-------|-------|
| 1 | `POST /api/v1/conversations/:id/messages` — frontend sends `{content, mode?, agent?, workflow_id?}` but no `role`. Backend validates `role` as `"user"\|"assistant"\|"system"`. Every call fails ValidationError. | FE: `webui/src/api/conversations.ts:99-104`; BE: `server/api/v1/routes/conversations.ts:42-48` |
| 2 | `GET /api/v1/conversations/:id` — frontend expects `{conversation, messages}`. Backend returns bare `Conversation` object. `payload.conversation` and `payload.messages` both `undefined`. | FE: `api/conversations.ts:71-80`; BE: `routes/conversations.ts:19-24` |
| 3 | `POST /api/v1/executions/:id/abort` — frontend calls this but backend has no such route. Returns 404. | FE: `api/executions.ts:95-105`; BE: `routes/executions.ts:1-27` |
| 4 | `POST /api/v1/conversations` — frontend sends `agent_name`. Backend hardcodes `"fin-orchestrator"`, discarding client's agent choice. | FE: `api/conversations.ts:49-52`; BE: `routes/conversations.ts:13-14` |

### High

| # | Issue | Files | Lines |
|---|-------|-------|-------|
| 5 | `POST /api/v1/workflows` — frontend sends to create workflow. Backend only has GET, GET/:id, POST/:id/trigger. Returns 404. | FE: `api/workflows.ts:63`; BE: `routes/workflows.ts:1-38` |
| 6 | `GET /api/v1/executions` — frontend expects `{executions, total, offset, limit}`. Backend returns flat `{data: [], trace_id}` (TODO stub). | FE: `api/executions.ts:65`; BE: `routes/executions.ts:8` |
| 7 | `GET /api/v1/executions/:id` — frontend expects `Execution` (with `workflow_id`, `status`, `started_at`). Backend returns `{id, nodes}` — entirely different shape. | FE: `api/executions.ts:80-82`; BE: `routes/executions.ts:12-18` |
| 8 | `POST /api/v1/executions/:execId/nodes/:nodeId/retry` — frontend calls retry endpoint. Backend has no matching route. Returns 404. | FE: `api/executions.ts:120-125`; BE: `routes/executions.ts:1-27` |
| 9 | `GET /api/v1/agents/:name` — backend returns only `{name}`. Frontend expects `AgentDetail` with `description`, `mode`, `executions`, `success_rate`, `last_active`. | FE: `api/agents.ts:25-27`; BE: `routes/agents.ts:11-13` |
| 10 | `POST /api/v1/workflows/:id/trigger` — backend returns `{executionId, status}` (camelCase). Frontend type declares `{execution_id}` (snake_case). `execution_id` is `undefined` at runtime. | FE: `api/workflows.ts:39-41`; BE: `routes/workflows.ts:34` |

### Medium

| # | Issue | Evidence |
|---|--------|----------|
| 11 | `PUT /api/v1/workflows/:id` — route does not exist | FE: `api/workflows.ts:73` |
| 12 | `DELETE /api/v1/workflows/:id` — route does not exist | FE: `api/workflows.ts:79` |
| 13 | `GET /api/v1/mcp/agents/:name/allowed-tools` — route does not exist | FE: `api/mcp.ts:48-49` |
| 14 | `POST /api/v1/workflow/session-boundary` — route does not exist | FE: `components/workflow/useSessionBoundary.ts:78` |

---

## 2. Type/Model Mismatches

### Critical

| # | Backend | Frontend | Files | Issue |
|---|---------|----------|-------|-------|
| 1 | `agentName: string` | `current_agent: string` | `repo.ts:6-12`, `domain/conversation.ts:37` | Different field names. API serializes `agentName`, frontend reads `current_agent`. Returns `undefined`. |
| 2 | DB column `input` (singular) | `inputs` (plural) | `schema.ts:47`, `repo.ts:221`, `domain/execution.ts:54` | Pluralization mismatch. |
| 3 | DB column `output`, repo doesn't return it | `outputs` | `schema.ts:48`, `domain/execution.ts:55` | Plural + missing from backend response. |
| 4 | `'pending'\|'running'\|'completed'\|'failed'\|'skipped'\|'cleaned_up'` | `'pending'\|'running'\|'completed'\|'failed'\|'cancelled'` | `execution/domain.ts:3-9`, `domain/execution.ts:72-77` | Backend has `skipped`/`cleaned_up`; frontend has `cancelled`. API returning `skipped` violates frontend type. |
| 5 | DB column `completed_at` | frontend uses `ended_at` | `schema.ts:33`, `domain/execution.ts:99` | Different field names for same concept. |
| 6 | Backend Message has `conversationId` | Frontend Message lacks this | `repo.ts:14-20`, `domain/conversation.ts:58-84` | Frontend can't associate messages to conversations from API response. |
| 7 | `WorkflowRepo.get()` returns none of these | Frontend expects `description`, `created_at`, `updated_at` | `repo.ts:16-29`, `domain/workflow.ts:82-95` | Fields always `undefined`. |
| 8 | `getExecutionNodes()` returns `{id, nodeId, status, input}` only | Frontend expects `agent`, `outputs`, `error`, `session_id`, timestamps, `retry_count` | `execution/repo.ts:219-238`, `domain/execution.ts:46-74` | Frontend fields can never be populated. |
| 9 | DB: nullable `text("title")`; repo: `string \| null` | Frontend: non-null `string` | `schema.ts:7`, `domain/conversation.ts:34` | Frontend crashes if DB has null title. |

### Moderate

| # | Issue | Evidence |
|---|-------|----------|
| 10 | Backend repo uses `Date`, frontend `string` for all timestamps | Works only if Date serializes to ISO-8601; breaks if epoch ms |
| 11 | Execution `started_at` DB nullable, frontend requires it | `schema.ts:31`, `domain/execution.ts:96` |
| 12 | Workflow `config` always `{}` on backend, frontend marks `?` | `schema.ts:75`, `domain/workflow.ts:91` |
| 13 | Backend Edge has no `id`/`data`, frontend `WorkflowEdge` requires `id` | `dag.ts:11-14`, `domain/workflow.ts:52-60` |
| 14 | Backend allows any string for Message `role`; frontend restricts to 3 values | `'workflow'` role would cause TS error |

---

## 3. Env/Config Mismatches

| # | Severity | Issue | File | Lines |
|---|----------|-------|------|-------|
| 1 | CRITICAL | `FIN_AGENT_*` prefix filter blocks ALL `.env` values from reaching settings.ts. Filter `k.startsWith("FIN_AGENT_")` runs before zod parses keys like `API_HOST`, `DATABASE_URL`, `OPENCLAW_API_KEY`. Every value falls back to hardcoded defaults. | `server/infra/settings.ts` | 79-81, 89 |
| 2 | HIGH | `FINNHUB_API_KEY` value is 40 chars — doubled key (two 20-char keys concatenated). Standard Finnhub keys are 20 chars. | `config/.env` | 2 |
| 3 | HIGH | `FMP_API_KEY` identical to `FRED_API_KEY` — copy-paste error. | `config/.env` | 5 vs 3 |
| 4 | MEDIUM | `EDGAR_IDENTITY` in .env but consumed nowhere. Dead config. | `config/.env` | -- |
| 5 | MEDIUM | `FIN_AGENT_USE_SERVE_BACKEND` and `FIN_AGENT_SERVE_BACKEND_URL` in .env but consumed nowhere. Dead config. | `config/.env` | 10-11 |
| 6 | MEDIUM | MCP API keys read via direct `process.env` in mcpClientManager.ts, earningsCalendar.ts, request.ts — bypassing settings.ts validation entirely. Two uncoordinated config access mechanisms. | Multiple files |
| 7 | MEDIUM | `OPENCLAW_API_KEY` and `API_KEY` default to empty string — silent auth failure if not set via shell env. | `settings.ts:36,61` |

---

## 4. Error Propagation Mismatches

| # | Severity | Issue | File | Lines |
|---|----------|-------|------|-------|
| 1 | CRITICAL | `conversations.ts` references `conversationRepo` but never declares it. Other handlers use `req.registry!.resolve()`. Every request to these routes throws `ReferenceError` -> HTTP 500. | `server/api/v1/routes/conversations.ts` | 20, 28, 34, 50, 54 |
| 2 | HIGH | Frontend has routes that don't exist on backend. Fastify 404 returns `{statusCode, error, message}` not `{code, message, trace_id}`. Frontend's `readApiError` checks `typeof parsed.code === "number"` which fails, returning fallback `{code: -1, message, trace_id: "unknown"}` — discarding backend error info. | `webui/src/api/http.ts:78-83` |
| 3 | MEDIUM | Backend never returns `{code: 0}` in success responses, so frontend's `code === 0` branch is dead code. | `http.ts:183-185` vs all routes |
| 4 | MEDIUM | `DELETE /conversations/:id` returns `{data: null}` — frontend `?? undefined` converts to undefined, potentially triggering ApiError on GET/POST/PUT callers. | `conversations.ts:30`, `http.ts:195` |
| 5 | LOW | Unhandled error handler logs `req.id` (monotonic counter) not `req.traceId` (UUID) — can't correlate logs to frontend traces. | `app.ts:101` |
| 6 | LOW | Content-type mismatch error hardcodes `trace_id: "unknown"` instead of using `traceId` variable. | `http.ts:152` |
| 7 | LOW | `isSystemError` in frontend treats all codes >= 2000 as "system", not distinguishing InfraError (3xxx) from SystemError (2xxx). | `api-error.ts:53-55`, `errors.ts:69-70` |
| 8 | LOW | Executions route uses `(req as any).traceId` instead of typed `req.traceId`. | `executions.ts:8,17,21` |

---

## 5. Workflow Engine Consistency

| # | Severity | Issue | File | Lines |
|---|----------|-------|------|-------|
| 1 | CRITICAL | `execution_id` vs `executionId` — backend returns camelCase `{executionId}`, frontend type declares snake_case `{execution_id}`. HTTP wrapper unwraps `data` but doesn't transform fields. `result.execution_id` is `undefined` at runtime. | BE: `routes/workflows.ts:34`; FE: `api/workflows.ts:39-41` |
| 2 | CRITICAL | Synchronous execution will timeout frontend after 30s. Handler `await`s full DAG execution before responding. Frontend HTTP wrapper has 30s default timeout. Workflows >30s throw frontend timeout even if backend completes successfully. | BE: `routes/workflows.ts:32`; FE: `api/http.ts:31` |
| 3 | MEDIUM | Frontend polls `GET /executions` every 5s, but endpoint is stub returning `[]`. | `executions.ts:7-9`, `useExecutions.ts:10-16` |
| 4 | MEDIUM | `GET /executions/:id/nodes` selects all DB columns but `.map()` only extracts 4 fields — `output`, `error`, `sessionId`, `agent`, `retryCount` stripped. | `execution/repo.ts:219-238` |
| 5 | MEDIUM | `Workflow.status` typed as `string` (no enum) on backend, while frontend uses strict union. | `dag.ts:23`, `domain/workflow.ts:28-33` |
| 6 | MEDIUM | `WorkflowRunner` resolved as `req.registry!.resolve<any>("WorkflowRunner")` losing type safety. | `workflows.ts:28-30` |

---

## 6. Agent Adapter Contract

| # | Severity | Issue | File | Lines |
|---|----------|-------|------|-------|
| 1 | CRITICAL | Agent output silently cast through cascading `as any` -> `as Record<string, unknown>`. Adapter returns LLM text string as `content`. If LLM returns plain text (not parseable JSON), stored as-is in JSON column with no warning. Complete type safety loss. | `OpenClawAdapter.ts:107,120`, `workflow_runner.ts:78,241` |
| 2 | CRITICAL | Transient failures (timeout, 5xx) not retried at agent-call level. Adapter distinguishes retryable errors but `scheduleNode`'s catch treats all identically — calls `recordNodeFailed`. `withRetry` only covers `markExecution`, not Agent invocation. Transient errors cascade to skip downstream nodes. | `OpenClawAdapter.ts:86-91,123`, `workflow_runner.ts:245-254,270-289` |
| 3 | HIGH | Node-specific input never passed to Agent. Each DAG node has `data` (node-specific config). Runner stores it in DB but AgentExecutor only sends `ctx.params` (top-level workflow params). Agent never sees its node-specific `data` or `prompt`. | `dag.ts:6-7`, `workflow_runner.ts:72,101,118-123,224` |
| 4 | HIGH | Token usage data discarded. Adapter correctly extracts `usage` (snake_case->camelCase) but AgentExecutor only destructures `output.content`. `output.usage` is lost. No DB column for token tracking. | `OpenClawAdapter.ts:112-118`, `workflow_runner.ts:76-82`, `execution/domain.ts`, `schema.ts:39-54` |
| 5 | MEDIUM | `stream: false` hardcoded in adapter — `options.stream` from caller ignored. | `AgentPort.ts:19`, `OpenClawAdapter.ts:57` |
| 6 | MEDIUM | `raw` fallback field is redundant — adapter sets `raw: content` (same string), never captures actual raw HTTP response. | `AgentPort.ts:35-36`, `OpenClawAdapter.ts:120` |
| 7 | MEDIUM | `sessionId: null` hardcoded — no conversation state support despite DB schema having `session_id` column. | `workflow_runner.ts:80`, `schema.ts:49` |

---

## 7. Cross-cutting Issues

The following 5 issues represent the most impactful cross-layer problems that affect multiple architectural boundaries simultaneously. These should be prioritized for remediation above individual findings.

### 1. Naming Convention Schism (camelCase vs snake_case)

**Affected layers:** API contracts, Type/Model definitions, Workflow Engine
**Findings:** API-CM #10, TMM #1, TMM #2, TMM #3, TMM #5, WEC #1
**Impact:** Every endpoint that returns data with one convention consumed by code expecting the other produces `undefined` at runtime — no TypeScript error, no warning, silent data loss. This is the single largest source of bugs in the system.

The backend uses camelCase (`agentName`, `conversationId`, `executionId`, `completedAt`), the frontend uses snake_case (`current_agent`, `inputs`, `execution_id`, `ended_at`), and the database uses snake_case (`completed_at`, `session_id`) — three conventions, no transform layer between any of them.

### 2. Non-Existent Routes Called by Frontend

**Affected layers:** API contracts, Error Propagation
**Findings:** API-CM #3, API-CM #5, API-CM #8, API-CM #11, API-CM #12, API-CM #13, API-CM #14
**Impact:** At least 7 frontend code paths call routes that return HTTP 404. The error propagation mismatch (EPM #2) means the 404 payload format is incompatible with the frontend error parser, so every 404 returns a generic `{code: -1}` fallback. Users see opaque failures with no actionable information, and these 404s are indistinguishable from network errors in logs.

### 3. Config/Env Access Fracture

**Affected layers:** Env/Config, Agent Adapter
**Findings:** ECM #1, ECM #6, ECM #7
**Impact:** The `FIN_AGENT_*` prefix filter in `settings.ts` blocks every meaningful environment variable (API keys, database URL, host) from reaching the validated config. MCP key readers bypass settings.ts entirely by reading `process.env` directly. The result: some config paths silently use defaults, some read raw env vars, and there is no single source of truth. Combined with the doubled Finnhub key (ECM #2) and the FMP/FRED key collision (ECM #3), API authentication is operating on undefined behavior.

### 4. Undeclared Dependency Crash

**Affected layers:** API contracts, Error Propagation
**Findings:** EPM #1
**Impact:** The entire conversations route handler references `conversationRepo` as a free variable that is never declared or injected. It is the only route handler that does not use `req.registry!.resolve()`. Every request to any conversations endpoint crashes with `ReferenceError: conversationRepo is not defined` and returns HTTP 500. This is a trivially fixable bug (a single import/registry call) that blocks all conversation functionality.

### 5. Agent Invocation Type Safety Collapse

**Affected layers:** Agent Adapter, Workflow Engine
**Findings:** AAC #1, AAC #2, AAC #3, AAC #4
**Impact:** The chain from `OpenClawAdapter.callAgent` through `workflow_runner.ts` to the database uses four levels of type erasure (`as any`), discarding structured agent output, node-specific configuration, token usage metadata, and error classification. Transient failures are never retried at the agent-call level, causing cascading node failures. The system has no observability into agent performance (token costs, error rates) because the data is thrown away before it reaches the database.
