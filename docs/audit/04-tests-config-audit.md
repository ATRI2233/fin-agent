# Audit Report: Tests & Config Layer

**Date:** 2026-06-25
**Scope:** `project/tests/`, `project/config/`, `project/package.json`
**Audit ID:** 04-tests-config-audit
**Status:** Draft

---

## Severity Summary

| Severity | Count | Description |
|----------|-------|-------------|
| CRITICAL | 1 | System cannot function; build/run is blocked |
| HIGH | 5 | Major correctness risk or non-trivial data loss |
| MEDIUM | 5 | Moderate concern: dead config, duplication, fragility |
| LOW | 1 | Minor: cosmetic or negligible impact |
| **Total** | **12** | |

---

## Bugs

| # | Severity | File | Lines | Issue |
|---|----------|------|-------|-------|
| B1 | CRITICAL | `tests/integration/full_stack.spec.ts`, `workflow_and_conversation.spec.ts` | 8-10, 13 | Four imports do not resolve: `createConversationRepo` (`server/modules/conversation/repo.ts` exports class `ConversationRepo` and `export const conversationRepo` -- no factory), `createWorkflowRepo` (same pattern), `createExecutionRepo` (same pattern), `createAgentDispatcher` (no definition exists anywhere in `src/`). Tests cannot be loaded by Vitest. |
| B2 | HIGH | `tests/integration/full_stack.spec.ts`, `workflow_and_conversation.spec.ts` | 211-215, 83-87 | `new WorkflowRunner(WorkflowRepo, ExecutionRepo, new ExecutorRegistry(dispatcher))` passes 3 arguments. Source constructor (`workflow/service/workflow_runner.ts:85-97`) requires **4** arguments: `workflowRepo`, `executionRepo`, `executionDomainService`, `executorRegistry`. The test supplies `ExecutorRegistry` as the 3rd argument where `executionDomainService` is expected -- this is a compile error. |
| B3 | HIGH | `tests/integration/full_stack.spec.ts`, `workflow_and_conversation.spec.ts` | 25, 25 | `const migrationsPath = resolve(process.cwd(), "drizzle", "migrations")`. Actual migrations live at `project/config/drizzle/migrations/`. The correct path should be `resolve(cwd, "config", "drizzle", "migrations")`. Migration calls will fail, no tables will be created, and all subsequent DB operations will fail. |
| B4 | HIGH | `config/.env` | 1-4 | `FINNHUB_API_KEY` contains a concatenated/repeated pattern: `d8882dhr01qq43420b4gd8882dhr01qq43420b50` -- two substrings visibly joined. `FRED_API_KEY` and `FMP_API_KEY` are identical (`BwzMRhndQqxq4MzcOOczzWjGxBDVDcwG`) -- a copy-paste error. Different providers should have distinct keys. |

---

## Dead Code / Null Pointers

| # | Severity | File | Lines | Issue |
|---|----------|------|-------|-------|
| D1 | HIGH | `project/package.json` | 22-24 | Three script targets -- `switch:to-ts`, `switch:to-py`, `clean:py` -- reference files in `config/scripts/` which does **not exist**. Running any of these produces a module-not-found error. |
| D2 | MEDIUM | `config/.env` | 10-11 | `FIN_AGENT_USE_SERVE_BACKEND` and `FIN_AGENT_SERVE_BACKEND_URL` are set in `.env` but are not defined in `settingsSchema` (`server/infra/settings.ts`). Zod's default `strip` strategy silently discards them. |
| D3 | MEDIUM | `config/vitest.config.ts` | 14-18 | Alias `@server/` and `@agents/` are defined but never used by any test file. All tests use relative imports exclusively. This is dead configuration. |
| D4 | LOW | `config/_archive_python/tests/modules/*/__pycache__/` | -- | Python `.pyc` bytecode files are checked into version control. Build artifacts should not be tracked. |

---

## Redundant Design

| # | Severity | File | Lines | Issue |
|---|----------|------|-------|-------|
| R1 | MEDIUM | `tests/integration/full_stack.spec.ts`, `workflow_and_conversation.spec.ts` | entire | Two nearly identical test files: identical import blocks (1-13), identical `beforeAll`/`afterAll` hooks (21-35), and identical variable declarations (15-19). The second file is a near-strict subset of the first with only minor additions. These should be consolidated into a single test suite. |

---

## Unreasonable Design / Missing Interfaces

| # | Severity | File | Lines | Issue |
|---|----------|------|-------|-------|
| U1 | HIGH | `tests/unit/` | -- | **No unit tests exist for core modules**: `ConversationRepo`, `WorkflowRepo`, `WorkflowRunner`, DAG validation, `ExecutionDomainService`, `OpenClawAdapter`, or any API routes. Only 5 unit test files are present, covering trivial utility functions. |
| U2 | MEDIUM | Integration tests | -- | Tests are tightly coupled to the DB schema -- they insert directly into the `workflows` table with raw Drizzle calls and `as any` type assertions. A schema change breaks tests at the DB boundary rather than at a service-layer abstraction. |
| U3 | MEDIUM | `config/agents/technical-chartist.md`, `fin-report-writer.md` | 101-233, 84-95 | Agent prompt files embed raw tool API documentation (field tables, column names). This duplicates the MCP tool definitions, bloats prompts, and will drift out of sync with actual tool implementations. |
| U4 | MEDIUM | `config/vitest.config.ts` | 4 | `root: ".."` -- a relative root ties the config to its exact filesystem location relative to the workspace root. This is fragile and non-obvious to maintainers. |
| U5 | LOW | `config/drizzle.config.ts` | 8 | `url: process.env.FIN_AGENT_DATABASE_URL || "sqlite:///./data/finagent.db"` -- `FIN_AGENT_DATABASE_URL` is never set in `.env` or anywhere else. The fallback always applies, making the env-var path dead code. |

---

## Top Fixes

> **Priority 1 -- CRITICAL (B1):** Fix the four broken imports in both integration test files. Replace factory-style imports with the actual exports (`ConversationRepo`, `conversationRepo`, etc.) and either create the missing `createAgentDispatcher` or import the real dispatcher.
>
> **Priority 2 -- HIGH (B2, B3):** Fix the `WorkflowRunner` constructor call by passing the correct 4th argument (`executionDomainService`) and correcting the 3rd argument. Fix the migration path to point at `config/drizzle/migrations/` so that database setup works.
>
> **Priority 3 -- HIGH (B4, D1):** Fix the `.env` API keys -- deduplicate `FRED_API_KEY`/`FMP_API_KEY` and regenerate the malformed `FINNHUB_API_KEY`. Remove or fix the three dead script targets in `package.json` that reference the nonexistent `config/scripts/` directory.
>
> **Priority 4 -- HIGH (U1):** Prioritize writing unit tests for all core business modules (`ConversationRepo`, `WorkflowRepo`, `WorkflowRunner`, DAG validation, `ExecutionDomainService`, `OpenClawAdapter`, and API route handlers) before adding further integration tests.
