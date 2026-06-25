# Agent / MCP System Audit Report

**Report ID:** 02-agent-mcp-audit
**Scope:** `project/src/agents/` -- Agent system, MCP Servers, Adapter layer, and shared libraries
**Date:** 2026-06-25
**Auditor:** Claude Code (automated static analysis)

---

## Severity Summary

| Severity | Bugs | Dead Code | Redundant Design | Unreasonable Design | Total |
|----------|------|-----------|------------------|---------------------|-------|
| CRITICAL | 3 | 0 | 0 | 1 | 4 |
| HIGH | 8 | 3 | 1 | 1 | 13 |
| MEDIUM | 6 | 13 (D4-D14) | 6 | 8 | 33 |
| LOW | 0 | 3 (D15-D16) | 3 | 6 | 12 |
| **Total** | **18** | **16** | **12** | **16** | **62** |

---

## 1. BUGS

### Critical

| # | File | Lines | Issue |
|---|------|-------|-------|
| B1 | `mcp/core/src/memory/memoryStore.ts`, `lib/dataHub.ts` | 50, 6 | **ESM `__dirname` crash** -- `lib/package.json` has `"type": "module"`, but files use `__dirname` which is undefined in Node.js ESM. Crashes at module load time with `ReferenceError`. |
| B2 | `lib/dataHub.ts` | 219-225 | **Corrupted verification loop** -- when `key_prices` is missing, `support` defaults to `0` and `resistance` defaults to `0`. Bullish checks (`actualPrice > 0`) are trivially "correct" for any positive stock price. Bearish checks (`actualPrice < 0`) are always false. Entire accuracy/hit-rate/weight-update system is systematically corrupted. |
| B3 | `lib/dataHub.ts` | 343-347 | **Cleanup date format never matches** -- `new Date(...).toISOString()` produces `"2026-03-27T00:00:00.000Z"` but SQLite stores `created_at` as `"2026-03-27 12:34:56"`. Lexicographic comparison always fails -- database grows unbounded. |

### High

| # | File | Lines | Issue |
|---|------|-------|-------|
| B4 | `mcp/ashare/utils.py` | 204-208 | **Wrong market prefix for Shenzhen ETFs** -- Shenzhen ETFs (`159xxx`, `16xxxx`) always get market prefix `sh{code}` in Sina URL, returning empty/stale data. |
| B5 | `mcp/fred/src/fred/series.ts` | 69-71 | **Missing `observations` guard** -- `dataResponse.observations.map(...)` -- if FRED API returns unexpected response without `observations` field, throws `TypeError`. Zod schemas defined but never used for runtime validation. |
| B6 | `mcp/risk/risk_mcp_server.py` | 62 | **NaN for short datasets** -- `rolling(252)` always produces NaN for datasets < 252 days. Data minimum check (line 53) only requires 60 days. Any 60-251 day dataset produces all-NaN silently. |
| B7 | `mcp/risk/risk_mcp_server.py` | 231-232 | **Wrong yfinance column names** -- `pctHeld` and `pctChange` columns don't match yfinance schema. yfinance returns `"% Out of Shares"` not `"pctHeld"`, and has no `"pctChange"` column. Both fields always 0. |
| B8 | `mcp/core/src/tools/sentiment/signalFusion.ts` | 733-738 | **Bearish conclusion shows positive expected return** -- `结论：看空，预期收益${(bearAgent.distribution.p_bearish * 10).toFixed(1)}%` -- bearish conclusion but expected return is positive. |
| B9 | `mcp/core/src/tools/fundamental/fundamentalScan.ts` | 94-96 | **Self-comparing peer comparison** -- `tickers: [ticker, ticker]` -- both elements are same symbol. Comparison yields no useful info while consuming timeout budget. |
| B10 | `mcp/core/src/tools/fundamental/fundamentalScan.ts` | 169 | **Falsy-zero for debt-to-equity** -- `debtToEquity ? ... : null` -- valid value of 0 (no debt) is falsy and becomes null. |
| B11 | `lib/memoryTools.ts` | 130-155 | **Missing `if/then` schema validation** -- When `action="add"`, `rule` is required but JSON Schema has no `if/then`. `undefined` values flow to SQLite `NOT NULL` columns, causing unhandled constraint violations. |

### Medium

| # | File | Lines | Issue |
|---|------|-------|-------|
| B12 | `mcp/ashare/utils.py` | 203-227 | **ETF vs stock klines not unified** -- near-identical parsing logic for ETF and stock klines but not unified. ETF branch also hosts bug B4. |
| B13 | `mcp/core/src/tools/sentiment/optionsGreeks.ts` | 132 | **Default call classification** -- fallback when `opt.type` missing always classifies option as "call" because both calls and puts have `strike` and `underlying_price`. |
| B14 | `mcp/core/src/tools/sentiment/optionsGreeks.ts` | 152 | **Arbitrary underlying price** -- `middleStrike / 2` produces wildly incorrect price. |
| B15 | `mcp/core/src/tools/` (multiple files, e.g. `secFilings.ts:116-118`) | -- | **Dead catch blocks** -- `Promise.allSettled` never rejects, so `catch` block is dead code. |
| B16 | `mcp/core/src/tools/fundamental/earningsCalendar.ts` | 35 | **1970-01-01 false positives** -- `new Date(e.date \|\| e.earningDate \|\| 0)` -- when both undefined, `Date(0)` = 1970-01-01 passes `>= now` check. |
| B17 | `adapter/OpenClawAdapter.ts` | 122-123 | **Misleading error classification** -- non-HTTP-5xx failures wrapped as `AgentTimeoutError` with message "unreachable at". |
| B18 | `adapter/OpenClawAdapter.ts` | 77 | **No timeout on fetch** -- no `AbortController` on `fetch()`. If gateway hangs, `invoke()` blocks indefinitely. |

---

## 2. DEAD CODE / NULL POINTERS

| # | Severity | File | Lines | Issue |
|---|----------|------|-------|-------|
| D1 | HIGH | `mcp/risk/risk_mcp_server.py` | entire | **Disconnected risk server** -- not imported, not in `start-all.mjs`, not registered in any config. Never runs in normal lifecycle. |
| D2 | HIGH | `mcp/common/__init__.py` | entire (349 lines) | **100% dead common module** -- contains `make_handle_request()`, `dispatch_tool()`, `run_stdio_server()`, `tool_errors()` -- all unused. Each server duplicates this logic instead of importing from `common`. |
| D3 | HIGH | `lib/` | -- | **Missing `dist/` directory** -- `package.json` points `main` to `dist/index.js` but no `dist/` directory exists. Combined with ESM crash (B1), lib package cannot start. |
| D4 | MEDIUM | `mcp/ashare/utils.py` | 60-87 | **`_run_akshare` defined but never called.** |
| D5 | MEDIUM | `mcp/ashare/tools/technical.py` | 6-59 | **5 unused technical indicator functions** -- `calculate_rsi`, `calculate_ema`, `calculate_bollinger_bands`, `calculate_macd`, `calculate_pivot_points` defined but never called. |
| D6 | MEDIUM | `mcp/fred/src/common/request.ts` | 139-212, 119-130 | **`fetchFREDSeriesData` and `FRED_SERIES_REGISTRY`** -- never imported by any consumer. |
| D7 | MEDIUM | `mcp/fred/src/common/request.ts` | 77-99 | **Unused Zod schemas** -- `ObservationSchema`, `SeriesObservationsResponseSchema` defined but `.parse()` never called. Not used for runtime validation. |
| D8 | MEDIUM | `mcp/ashare/tools/stock_lookup.py` | 58-69 | **`_http_get` duplicate** -- local duplicate of `http_get` in `utils.py`. |
| D9 | MEDIUM | `mcp/ashare/tools/` (6 files) | -- | **~28 unused imports** across 6 tool files -- `normalize_symbol`, `get_market_code`, `is_etf`, `parse_ashare_code`, `http_get`, `get_daily_data` imported but never used. |
| D10 | MEDIUM | `mcp/risk/risk_mcp_server.py` | 5 | **`import os`** -- never used. |
| D11 | LOW | `mcp/fred/test/integration/server.test.ts` | -- | **Placeholder test** -- single `expect(true).toBe(true)`. |
| D12 | LOW | `mcp/ashare/tools/fund_flow.py` | 105-111 | **No-op alias** -- `getFundFlowReal` just calls `getFundFlow` with no transformation. |
| D13 | LOW | `lib/memoryStore.ts` / `mcp/core/src/tools/sentiment/signalFusion.ts` | 67-73 | **Unread weight table** -- `signal_weights` table populated but never read by `signalFusion` -- it uses its own `DEFAULT_WEIGHTS`. |
| D14 | LOW | `mcp/core/src/index.ts` (mcpClientManager) | 82 | **Unchecked `initialized` flag** -- set but never checked by any method. |
| D15 | LOW | `mcp/fred/src/index.ts` | 182-187 | **Placeholder transport** -- `placeholderTransport` created only to satisfy return type, never connected, never handles requests. |
| D16 | LOW | `mcp/core/src/tools/market/fearGreedIndex.ts` (market snapshot) | -- | **Empty news headlines** -- `news_headlines: []` in result, never populated despite data existing in `newsSentiment.ts`. |

---

## 3. REDUNDANT DESIGN

| # | Severity | File | Lines | Issue |
|---|----------|------|-------|-------|
| R1 | HIGH | `mcp/risk/risk_mcp_server.py`, `mcp/ashare/ashare_mcp_server.py`, `mcp/cn_macro/cn_macro_mcp_server.py` | ~250 lines total | **Triplicated JSON-RPC/stdio loop** -- three MCP servers reimplement identical `handle_request` and `__main__` loops. Meanwhile `common/__init__.py` was written specifically to provide `make_handle_request()` and `run_stdio_server()` -- but no server imports it. |
| R2 | MEDIUM | `mcp/fred/src/fred/browse.ts`, `series.ts`, `search.ts`, `request.ts` | ~90 lines | **9 identical catch blocks** for `FREDConfigError` across 4 files (`browse.ts`: 5 blocks). Should be extracted to `src/fred/helpers.ts`. |
| R3 | MEDIUM | `mcp/ashare/constants.py`, `tools/market.py`, `tools/sentiment.py` | -- | **`INDEX_CODES` defined 3 times.** |
| R4 | MEDIUM | `mcp/core/src/index.ts:6`, `lib/memoryStore.ts:68-73`, `signalFusion.ts:97-104` | -- | **Three different weight sets** for same signal weights -- comment says technical=35% fundamental=30% sentiment=10%; `memoryStore` has 0.40,0.35,0.10,0.10,0.03,0.02; `signalFusion` has 0.35,0.30,0.10,0.10,0.10,0.05. |
| R5 | MEDIUM | `mcp/core/src/tools/` (6 files: `secFilings`, `analystRatings`, `fearGreedIndex`, `commodityPrices`, `insiderTrading`, `optionsGreeks`) | -- | **Combo fallback pattern repeated** -- `try { data = await mcp.callTool(...) } catch { /* log */ } data \|\| generateSimulated*() { ... }`. |
| R6 | MEDIUM | `mcp/ashare/tools/technical.py` | 6-59 and inline | **Dual implementation of technical indicators** -- 5 pandas-based module-level functions (unused) and reimplemented inline with numpy inside `get_technical_levels`. |
| R7 | LOW | `mcp/fred/src/fred/browse.ts` | 126, 191, 248, 313 | **Pagination display calculation repeated 4 times.** |
| R8 | LOW | `mcp/fred/src/fred/browse.ts`, `series.ts`, etc. | -- | **Query param building repeated** across 6 FRED functions -- same `if (options.limit !== undefined) queryParams.limit = options.limit` pattern. |
| R9 | LOW | `lib/dataHub.ts` | 192, 328 | **`getHistory` and `getJudgments` share ~25 lines** of identical query code. |
| R10 | LOW | `lib/memoryTools.ts` | -- | **9 identical try/catch error wrappers** -- should use shared `wrapHandler()`. |
| R11 | LOW | `lib/memoryTools.ts` | -- | **All 9 handlers are `async` despite no `await`** -- `better-sqlite3` is synchronous. |
| R12 | LOW | `lib/devilAdvocate.ts`, `lib/conflictResolver.ts` | -- | **`AgentSignal` interface defined independently** in both files. |

---

## 4. UNREASONABLE DESIGN / MISSING INTERFACES

| # | Severity | File | Lines | Issue |
|---|----------|------|-------|-------|
| U1 | CRITICAL | `mcp/core/src/tools/` (6 files: `secFilings`, `analystRatings`, `fearGreedIndex`, `commodityPrices`, `insiderTrading`, `optionsGreeks`) | -- | **Silent simulated data** -- fallback to simulated financial data with NO indication data is fake. Generate plausible-looking numbers (hardcoded revenue, fake accession numbers). Users cannot distinguish real from simulated. |
| U2 | HIGH | `adapter/AgentPort.ts` | -- | **No lifecycle interface** -- `AgentPort` only defines `invoke()`. No lifecycle / resource cleanup interface. If adapter holds resources (connections, file handles), no way to clean up. |
| U3 | MEDIUM | `adapter/OpenClawAdapter.ts` | -- | **No prompt caching** -- `loadAgentSystemPrompt` reads and parses markdown file from disk on EVERY `invoke()` call. Should use `Map<agentName, string>`. |
| U4 | MEDIUM | `adapter/OpenClawAdapter.ts` | -- | **No trailing-slash normalization** -- `${this.baseUrl}/chat/completions` produces double-slash if `baseUrl` ends with `/`. |
| U5 | MEDIUM | `lib/dataHub.ts` | 367-372 | **Module side-effect signal handlers** -- `SIGTERM`/`SIGINT` handlers registered at import time, causing testability and conflict issues. |
| U6 | MEDIUM | `mcp/fred/src/fred/browse.ts` vs `search.ts` | 118, 241 and elsewhere | **Inconsistent type safety** -- `makeRequest<any>` bypasses TypeScript type safety in `browse.ts`, while `search.ts` correctly defines `SearchResponseSchema`. |
| U7 | MEDIUM | `mcp/fred/src/index.ts` | 182-187 | **Useless transport placeholder** -- `HttpServerResult.transport` never connected. Consumers who use `result.transport` get non-functional object. |
| U8 | LOW | `mcp/fred/` | -- | **Version mismatch** -- `package.json` version `1.1.0` vs `server.json` version `1.0.2`. |
| U9 | LOW | `mcp/fred/src/index.ts` | 31-34 | **Repeated file parse** -- `createServer()` parses `package.json` on every call. Should be cached as module-level constant. |
| U10 | LOW | `mcp/fred/src/fred/` | -- | **Mixed language error strings** -- FRED tools use Chinese error strings while codebase is English. |
| U11 | MEDIUM | `mcp/core/src/tools/sentiment/signalFusion.ts` | 585-625 | **Misleading "Debate protocol"** -- fixed arithmetic adjustment, not a debate. No LLM involvement, just hardcoded `bullAdjustment = bearAdjustment = 0.1`. |
| U12 | MEDIUM | `mcp/core/src/tools/sentiment/signalFusion.ts` | 687-700 | **Statistically invalid confidence interval** -- ignores covariance term, applies 1.96 from normal distribution to bounded [0,1] probabilities. |
| U13 | MEDIUM | `mcp/core/src/tools/risk/riskGauge.ts` | -- | **Empty analysis defaults to "low" risk** -- if called with only `{symbol:"AAPL"}`, returns all metrics as `null` and declares risk "low" without actual analysis. |
| U14 | LOW | `mcp/risk/risk_mcp_server.py` | 420 | **Unvalidated `top_n` parameter** -- negative `top_n` silently returns wrong data. |
| U15 | LOW | `mcp/risk/risk_mcp_server.py` | 435, 465 | **Silent NaN stringification** -- `json.dumps` with `default=str` silently stringifies non-serializable values (e.g., `np.float64` becomes string `"nan"`). |
| U16 | LOW | `mcp/risk/risk_mcp_server.py` | 8-15 | **`HAS_DEPS` toggle misdesign** -- allows server startup with all tools broken. If yfinance/numpy missing, 3 tools register but can never be invoked. |
| U17 | LOW | `mcp/ashare/tools/stock_lookup.py` | 47-55 | **Non-A-share symbols in A-share tool** -- `0700.HK`, `BABA`, `AAPL`, `TSLA`, `NVDA`, `MSFT` present in A-share-only tool. |
| U18 | LOW | `mcp/ashare/tools/fundamental.py`, `market.py` | 94, 169, 203 | **3 akshare calls bypass retry wrapper** -- `retry_akshare` used everywhere else but not here. |

---

## Top Priority Fixes

> **Immediate action required (see B1-B3, U1):**
>
> 1. **B1** -- Replace `__dirname` with `import.meta.url` / `fileURLToPath` in ESM modules (`lib/dataHub.ts`, `mcp/core/src/memory/memoryStore.ts`). This is a load-time crash affecting all consumers of the `lib/` package.
>
> 2. **B2** -- Fix verification loop in `lib/dataHub.ts:219-225`. When `key_prices` is missing, skip the verification or use a sentinel value instead of defaulting support/resistance to 0, which corrupts the entire weight-update system.
>
> 3. **B3** -- Normalize date comparison in `lib/dataHub.ts:343-347`. Use SQLite `DATE()` function or compare against ISO date string without time component to prevent unbounded database growth.
>
> 4. **U1** -- Add prominent metadata to simulated data outputs (e.g., `"_simulated": true`, `"dataSource": "FALLBACK_SIMULATION"`) so downstream consumers and LLM agents can distinguish real data from generated numbers.
>
> 5. **B5** -- Add runtime Zod validation (`SeriesObservationsResponseSchema.parse(response)`) before accessing `dataResponse.observations` in `mcp/fred/src/fred/series.ts`. Remove the `as any` cast.
>
> 6. **D1/D2/R1** -- Either wire up `mcp/risk/risk_mcp_server.py` into the startup lifecycle, or delete it (and the unreferenced `mcp/common/` module) to eliminate dead code. If kept, refactor all three Python MCP servers to share the `common/` stdio loop.
>
> 7. **B11** -- Add JSON Schema `if/then` to `memoryTools.ts` toolspec: when `action="add"`, require `rule` as non-optional string. This prevents silent constraint violations on the SQLite `NOT NULL` column.

---

*End of report -- 62 findings total (4 critical, 13 high, 33 medium, 12 low).*
