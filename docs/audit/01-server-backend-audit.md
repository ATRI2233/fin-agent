# Server Backend Audit Report

**Project:** Fin-Agent
**Layer:** Server Backend (`project/src/server/`)
**Date:** 2026-06-25
**Audit Scope:** `infra/`, `api/`, `modules/`, `app.ts`, `index.ts`

---

## Severity Summary

| Severity | Count |
|----------|-------|
| CRITICAL | 1 |
| HIGH     | 21 |
| MEDIUM   | 17 |
| LOW      | 12 |
| **Total** | **51** |

---

## 1. Bugs

| # | Severity | File | Lines | Issue |
|---|----------|------|-------|-------|
| B1 | CRITICAL | `infra/settings.ts` | 79-87 | The `FIN_AGENT_` prefix filter on `process.env` creates keys with the prefix, but the zod schema expects unprefixed keys (`API_HOST` vs `FIN_AGENT_API_HOST`). Every environment variable silently falls back to its hardcoded default. Only `AUTH_SKIP_LOCALHOST` is manually stripped (line 86). Users cannot override ANY config via `.env`. |
| B2 | HIGH | `infra/db.ts` | 60-63 | `wrapDbCall` passes the original error as `details.cause` instead of as the native `cause` parameter. The `FinAgentError.cause` property stays `undefined`, breaking `error.cause` chain traversal. Callers must use non-standard `.details.cause` which has no type-level documentation. |
| B3 | HIGH | `infra/errors.ts` | 46 | `FinAgentError` stores `this.cause = cause` but never passes it to `super(message, { cause })`. The native `Error.cause` property is never set, breaking structuredClone, serialization, and pino log output. |
| B4 | HIGH | `api/v1/routes/executions.ts` | 14-15 | `GET /executions/:id` checks `nodes.length === 0` and throws `ExecutionNotFoundError`. This conflates "execution ID does not exist" with "execution exists but has zero nodes yet" (just created, not started). A legitimate empty execution gets a false 404. |
| B5 | HIGH | `api/v1/routes/agents.ts` | 10-13 | `GET /agents/:name` returns `{ data: { name } }` unconditionally without verifying the agent actually exists. Any arbitrary string returns 200 with a fake success payload. |
| B6 | HIGH | `api/v1/routes/workflows.ts` | 30 | `req.registry!.resolve<any>("WorkflowRunner")` uses a raw `any` type parameter, completely bypassing the return-type contract. If the `WorkflowRunner` API changes, the compiler catches nothing. |
| B7 | HIGH | `api/v1/routes/mcp.ts` | 22-72 | `loadMcpConfig()` reads and parses a JSON file from disk on EVERY HTTP request. A page loading 3-4 endpoints triggers 3-4 synchronous file I/Os. Config should be loaded once at startup. |
| B8 | HIGH | `modules/execution/domain-service.ts` | 75 | `_inputReferences` checks if any object **key name** equals `nodeId` (line 75: `if (k === nodeId ...)`). Key names are structural fields like `"symbol"`, `"date"`, not node IDs. If a nodeId happened to be `"source"` and an unrelated input had `{"source": "some_value"}`, this falsely reports a dependency, causing wrong downstream nodes to be skipped. |
| B9 | HIGH | `modules/execution/repo.ts` | 173-193 | `markExecution` never sets `startedAt` when transitioning to `"running"` -- only `completedAt` is set for completed/failed/cleaned_up statuses. The execution-level record reports `startedAt = null` even while `status = "running"`. By contrast, `recordNodeStarted` (line 76) correctly sets `startedAt`. |
| B10 | HIGH | `modules/execution/domain-service.ts` | 29, 48, 52-56 | **TOCTOU race**: BFS takes a snapshot of nodes at line 29. The `recordNodeSkipped` call at line 48 does a separate DB read+write. Between snapshot and DB write, another thread could change the node's status. The optimistic lock catches this but the catch block (line 52) silently swallows the error and continues. The returned `skippedIds` array (line 62) still contains this nodeId even though the DB write never happened -- the caller has no way to know the node was NOT actually skipped. |
| B11 | HIGH | `modules/execution/repo.ts` | 74, 102, 130, 157, 176 | All `recordNode*` methods silently return `undefined` if the row doesn't exist. A typo in `nodeId` raises no error -- the caller assumes the node was started/completed/skipped but nothing happened. These should throw `NotFoundError` for the `!row` case. |
| B12 | HIGH | `modules/execution/repo.ts` + `infra/db.ts` | 18-23 | `PRAGMA foreign_keys = ON` is never set after `better-sqlite3` initialization. Foreign key enforcement is OFF by default. This means ALL `REFERENCES ... ON DELETE CASCADE` constraints in `schema.ts` (lines 20, 43, 58) are silently ignored at runtime. Deleting a conversation does NOT cascade-delete messages; deleting an execution does NOT cascade-delete nodes or logs. Data integrity bug affecting the entire database. |
| B13 | HIGH | `modules/conversation/repo.ts` | 74-81 | `appendMessage` runs `conversations.updatedAt` update and `messages` insert as two separate `run()` calls without a transaction. If the insert fails (e.g., disk full), the conversation's `updatedAt` is bumped but no message was appended -- a partial update corrupting the last-updated timestamp. |
| B14 | HIGH | `modules/conversation/repo.ts` | 74-81 | `appendMessage` updates `conversations.updatedAt` without checking `changes === 0`. If `conversationId` doesn't exist (invalid ID or already deleted), the update silently affects 0 rows, then inserts a message with a dangling foreign key. With foreign keys disabled (B12), the FK constraint won't help either. Orphaned messages. |
| B15 | HIGH | `modules/workflow/domain/dag.ts` | 33, 50, 52 | Edges referencing node IDs that don't exist in the `nodes` array are silently ignored. The topological sort uses fewer edges than user-defined, potentially running nodes in wrong order. Should throw an error. |
| B16 | HIGH | `modules/workflow/domain/dag.ts` | 64 | `queue.shift()` in `topologicalSort` is O(n) per shift, degrading the entire algorithm from O(N) to O(N^2) for N-node DAGs. Should use an index pointer or proper queue. |
| B17 | HIGH | `modules/workflow/service/retry.ts` | 59 | `catch (e)` cast to `Error` via `e as Error`. If thrown value is not an Error instance (e.g., `throw "string"` or `throw 42`), any downstream `.message` access throws `TypeError`. |
| B18 | MEDIUM | `modules/workflow/service/workflow_runner.ts` | 220 | Unsafe type assertion: `result.output` is `unknown` (from `NodeResult.output`) cast to `Record<string, unknown>`. If the executor returns `null`, `42`, or a string, this silently corrupts data flowing into `execution/repo.ts` where it's cast again as `DbJson`. |
| B19 | MEDIUM | `modules/workflow/service/workflow_runner.ts` | 113, 181, 190, 211, 227, 239 | `failedNodes` Set is read and written concurrently across multiple p-limit callbacks and the outer catch block. JavaScript Sets are not thread-safe. While unlikely to manifest as visible corruption for a simple flag check, it's a defined race condition. |
| B20 | MEDIUM | `modules/workflow/service/retry.ts` | 14-16 | The `CircuitBreaker` key is `${executionId}:${nodeId}:${traceId}`. Since `executionId` is newly generated per run, and each node is only scheduled once per execution, `isOpen` is checked at most once per key per execution. `recordFailure` is called after failure but `isOpen` is never rechecked for the same key. The circuit breaker is **a no-op in practice** -- it never blocks anything. |
| B21 | MEDIUM | `modules/workflow/service/workflow_runner.ts` | 188 | Same as B20 but at call site. `circuitBreaker.isOpen()` is checked once per `(executionId, nodeId, traceId)` and can never return true for a subsequent call. |
| B22 | MEDIUM | `api/v1/routes/executions.ts` | 7-9 | `GET /executions` is a hardcoded `[]` stub with a TODO comment. Shipped dead stub in production. |
| B23 | MEDIUM | `api/v1/routes/agents.ts` | 7 | `GET /agents` returns a hardcoded `[]`. Dead stub. |
| B24 | MEDIUM | `modules/execution/repo.ts` | 9 | `type DbJson = any` with pervasive `as DbJson` casts (lines 30, 54, 107, 134, 178) completely bypass TypeScript checking for all JSON column writes. Combined with `as ExecutionStatus` casts (lines 29, 53, 75, 77, 81, etc.), the type system provides no safety for core data writes. |
| B25 | LOW | `modules/execution/repo.ts` | 39-54 (schema) | No UNIQUE constraint on `(execution_id, node_id)` in `createExecutionNodes`. If the caller passes duplicate `nodeId` values for the same `executionId`, both rows are inserted. `recordNodeStarted` uses `.get()` (returns first match) but UPDATE matches both rows. |
| B26 | LOW | `infra/errors.ts` | 41 | Default error code is `0` (`ErrorCode.SUCCESS`). Any `new FinAgentError("...")` without explicit code reports `code: 0` (SUCCESS) -- a semantic contradiction. Should default to a general error code like `INTERNAL_FAILURE`. |
| B27 | LOW | `api/v1/routes/conversations.ts` | 28-30 | `DELETE /conversations/:id` returns 200 regardless of whether the conversation existed. Inconsistent with `GET /conversations/:id` which throws 404 for missing conversations. |
| B28 | LOW | `api/v1/routes/conversations.ts` | 12 | Hardcoded agent name `"fin-orchestrator"` ignores any agent ID the client might want to specify. |
| B29 | LOW | `api/plugins/auth.ts` | 10 | `req.url === settings.HEALTH_CHECK_PATH` uses strict equality. A request to `/health?foo=bar` includes the query string and fails the match, forcing health checks to require auth. |
| B30 | LOW | `infra/db.ts` | 48 | Log message reports `files.length` (all SQL files in migrations directory) rather than migrations actually applied. After the first run, this is misleading. |
| B31 | LOW | `modules/conversation/repo.ts` | 83 | `appendMessage` returns `createdAt: now` (in-memory timestamp), but the DB applies its own `CURRENT_TIMESTAMP` default (schema.ts line 23-24). These could differ under clock skew or DB defaults. |

---

## 2. Dead Code / Null Pointers

| # | Severity | File | Lines | Issue |
|---|----------|------|-------|-------|
| D1 | MEDIUM | `infra/settings.ts` | 120-122 | `getOpenclawGatewayUrl` is exported but never imported anywhere in `src/server/`. Dead export. |
| D2 | MEDIUM | `app.ts` | 92-100 | The `if ((err as any).validation)` branch handles Fastify schema-validation errors. Since no route defines request schemas, this path can never be reached. Permanently dead code. |
| D3 | MEDIUM | `app.ts` | 25-27 | AJV is loaded with `strict: false` and `customOptions` block, but no route defines a JSON schema anywhere. This configuration object is inert. |
| D4 | LOW | `modules/execution/domain.ts` | 6, 17 | `ExecutionStatus` includes `"cleaned_up"` and the state machine permits `completed -> cleaned_up` and `failed -> cleaned_up` transitions. But no code calls `transition(..., "cleaned_up")` on individual execution nodes. Node-level `cleaned_up` transition is unreachable. |
| D5 | LOW | `modules/execution/domain-service.ts` | 46-56 | The try/catch comment says "state machine forbids pending->skipped" but `domain.ts` line 16 explicitly allows `pending: ["running", "skipped"]`. The catch block handles a transition that can never throw under current domain rules. |
| D6 | LOW | `modules/workflow/service/workflow_runner.ts` | 192, 231 | `markDownstreamSkipped` traverses the entire downstream DAG and marks nodes skipped in DB, but each downstream node's `scheduleNode` independently rediscovers the skip and calls `recordNodeSkipped` again (line 182). The `markDownstreamSkipped` DB writes are wasted because the execution repo's early-return (if already "skipped") at line 181 makes them redundant. |

---

## 3. Redundant Design

| # | Severity | File | Lines | Issue |
|---|----------|------|-------|-------|
| R1 | MEDIUM | `modules/execution/repo.ts` | 67-88, 90-121, 123-148, 150-171, 173-193 | The optimistic-lock CRUD pattern is copy-pasted 5 times. Each follows the identical structure: SELECT, early-return if status matches, `transition()`, UPDATE with WHERE status check, changes check. About 100 lines of identical code. A single `updateNodeStatus(executionId, nodeId, targetStatus, extraFields?)` would eliminate this and prevent bugs like B9. |
| R2 | LOW | `modules/workflow/repo.ts` | 20-28, 41-49 | Row-to-`Workflow` mapping in `get()` and `list()` is copy-pasted identically. Should extract a `mapRow(row): Workflow` function. |
| R3 | LOW | `infra/registry.ts` | 38-54, 58-77 | The check-call-catch dispose pattern in `close()`/`dispose()` is duplicated across `override` and `shutdown`. Should extract a private `disposeInstance(instance)` method. |
| R4 | LOW | `infra/logging.ts` | 5 | Synchronous `readFileSync` reads `package.json` at import time. Fragile in bundled or strict-sandbox environments. |
| R5 | LOW | `api/v1/routes/workflows.ts` | 7, 13, 26, 30 | `req.registry!.resolve<WorkflowRepo>("WorkflowRepo")` is resolved independently in each handler. Line 26 and 30 resolve the same repo twice in one handler. |

---

## 4. Unreasonable Design / Missing Interfaces

| # | Severity | File | Lines | Issue |
|---|----------|------|-------|-------|
| U1 | HIGH | `modules/workflow/service/workflow_runner.ts` | 154-165 | `scheduleNode` accepts **11 positional parameters**. `WorkflowRunner` already has `workflowRepo`, `executionRepo`, `executionDomainService`, and `executorRegistry` as constructor dependencies. This should be either a closure inside `run()` or use an explicit options object. |
| U2 | HIGH | `modules/workflow/service/workflow_runner.ts` | 120-136 | All nodes are unconditionally scheduled even when they're known to be skipped. Nodes on a failure path generate unnecessary microtasks; for deep DAGs this is O(N^2) wasted work. |
| U3 | HIGH | `modules/workflow/service/workflow_runner.ts` | -- | **No cancellation/abort mechanism**. Once `run()` starts, all node promises are injected into `Promise.all`. If a node fails, other already-running nodes (via p-limit) must complete their execution (potentially long-running agent calls) before `run()` returns. No way to abort in-flight work wastes expensive API calls. |
| U4 | HIGH | `api/v1/routes/executions.ts` | 8, 10, 23 | Uses `(req as any).traceId` instead of the typed `req.traceId` from `types.ts`. Inconsistent with `conversations.ts` and `workflows.ts` which access it directly. Three distinct patterns exist across routes: `req.traceId`, `(req as any).traceId`, and `req.traceId ?? ""`. |
| U5 | MEDIUM | `modules/workflow/executor.ts` | 21-23 | `NodeExecutor.execute` return type is `NodeResult \| Promise<NodeResult>`. `InputExecutor` and `OutputExecutor` are synchronous while `AgentExecutor` is async. All should be uniformly `async` for consistent caller expectations. |
| U6 | MEDIUM | `modules/workflow/executor.ts` | 37-59 | `OutputExecutor` collects predecessor outputs into `{ inputs: [...] }` without keys/labels. Consumers must know the `predecessorIds` array order to match outputs to predecessors. Fragile, opaque design. |
| U7 | MEDIUM | `api/v1/routes/workflows.ts` | 7, 13, 26, 30 | `req.registry!` non-null assertions used in every handler with no guard. If the `onRequest` hook setting `req.registry` is ever reordered/removed/bypassed, all routes crash with null dereference. |
| U8 | MEDIUM | `api/v1/routes/mcp.ts` | 36, 51, 62, 83 | Every loop variable uses `any` (`(s: any)`, `(t: any)`, `const tools: any[] = []`), completely voiding the benefit of the well-defined `McpConfig` interface on line 8-17. |
| U9 | MEDIUM | `modules/workflow/service/workflow_runner.ts` | 249-269 | `withRetry` (from retry.ts) is only used for `markExecution` status transitions, never for actual node execution. If a node hits a transient failure (DB lock, network timeout), the entire DAG fails immediately despite having a fully implemented exponential-backoff retry function. |
| U10 | MEDIUM | `modules/execution/domain.ts` | 20 | `transition()` is a void-returning function that throws on invalid transitions. Callers must wrap in try/catch or pre-check. No boolean return or Result type. |
| U11 | LOW | `app.ts` | 62-67 | `crypto.randomUUID()` uses `globalThis.crypto` which is only available from Node.js 19+. If runtime is Node 18 or older, this crashes. Should use `import { randomUUID } from "crypto"`. |
| U12 | LOW | `index.ts` | 82 | `process.exit(0)` at end of shutdown handler doesn't wait for event loop to drain. Async teardown work scheduled after `app.close()` or `registry.shutdown()` is silently aborted. |
| U13 | LOW | `index.ts` | 67-68 | In startup `catch`, `registry.shutdown()` is called without `await`. If it returns a Promise, the teardown is fire-and-forget before `process.exit(1)`. |
| U14 | LOW | `infra/settings.ts` | 106-111 | The `OPENCLAW_GATEWAY_PORT === API_PORT` check compares defaults. Due to B1 these are always the hardcoded defaults (18789 vs 8000) -- can never catch real-world port conflicts. |
| U15 | LOW | `app.ts` | 87 | `const finErr = err as FinAgentError` is a redundant cast; `err` is already narrowed by the `instanceof` check on line 86. |
| U16 | LOW | `modules/workflow/executor.ts` | 2 | `import { Node }` lacks the `type` keyword for an interface import. Inconsistent with `workflow_runner.ts` which uses `import type`. Would break under `verbatimModuleSyntax`. |
| U17 | LOW | `modules/conversation/repo.ts` | 87-105 | `getMessages` queries `WHERE conversation_id = ? ORDER BY created_at ASC LIMIT ? OFFSET ?` with no composite index on `(conversation_id, created_at)`. Full table scan as messages table grows. |

---

## Top Fixes (CRITICAL + HIGH Priority)

### Tier 1 -- Data Integrity & Correctness (Fix Immediately)

1. **(B1) CRITICAL -- Env var prefix stripping broken in `infra/settings.ts`**
   Strip the `FIN_AGENT_` prefix from filtered keys before passing to zod, or change the zod schema to expect prefixed keys. Without this, NO environment variable override works.

2. **(B12) HIGH -- Missing `PRAGMA foreign_keys = ON` in `infra/db.ts`**
   Add `db.pragma('foreign_keys = ON')` after `better-sqlite3` initialization. Foreign keys are silently non-enforcing, corrupting all cascade-delete semantics across the entire database.

3. **(B13, B14) HIGH -- `appendMessage` has no transaction and no existence check in `modules/conversation/repo.ts`**
   Wrap the two `run()` calls in a transaction. Add a `changes === 0` guard after the `updatedAt` update.

4. **(B10) HIGH -- TOCTOU race in `domain-service.ts` skip logic**
   The BFS snapshot and DB write are not atomic. The catch block silently swallows optimistic-lock failures while the returned `skippedIds` array still includes the un-written node. Fix by reading+writing within the same transaction or retrying on lock failure.

### Tier 2 -- API Correctness (Fix Before Release)

5. **(B4) HIGH -- `GET /executions/:id` conflates "empty" with "not found"**
   Change the `nodes.length === 0` check to distinguish between a non-existent execution ID and an execution that exists but has no nodes yet.

6. **(B5) HIGH -- `GET /agents/:name` returns fake success for any name**
   Add an existence check against the agent registry or config before returning the payload.

7. **(B11) HIGH -- All `recordNode*` methods silently no-op on missing rows**
   Add `NotFoundError` throws for the `!row` case in `repo.ts`.

8. **(B9) HIGH -- `markExecution` never sets `startedAt` for "running" status**
   Add `startedAt: new Date().toISOString()` in the `"running"` transition branch.

### Tier 3 -- Design Issues (Plan for Next Iteration)

9. **(U1, U2, U3) HIGH -- `WorkflowRunner` design problems**
   Schedule nodes via an options object or closure (U1). Pre-skip known-failed downstream nodes (U2). Add an `AbortController`-based cancellation mechanism (U3).

10. **(B16) HIGH -- O(N^2) topological sort from `queue.shift()`**
    Replace `shift()` with an index pointer or a proper queue implementation.

11. **(B7) HIGH -- Config file I/O on every HTTP request in `mcp.ts`**
    Load and cache `mcps.json` at server startup.

12. **(U4) HIGH -- Inconsistent `traceId` access across route files**
    Use the typed `req.traceId` uniformly across all route handlers.

13. **(B17) HIGH -- Unsafe `catch (e)` cast in `retry.ts`**
    Guard with `instanceof Error` check before accessing `.message`.

14. **(B8) HIGH -- Key-name matching in `_inputReferences` is logically wrong**
    Compare values (or use a proper input-reference map), not object key names.
