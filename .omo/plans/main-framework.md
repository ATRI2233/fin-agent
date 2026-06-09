# Main Framework: Python Orchestration Layer

## TL;DR

> **Quick Summary**: Build a Python main framework (FastAPI) that sits above OpenCode + HAPI, providing a mature REST API for all financial analysis capabilities. OpenCode becomes a callable service, WebUI manages both framework and OpenCode.
> 
> **Deliverables**:
> - Python FastAPI framework with REST API
> - HAPI bridge for OpenCode agent communication
> - Job queue with persistence (SQLite)
> - Extended WebUI with framework management pages
> - Scheduler for automated analysis tasks
> 
> **Estimated Effort**: Large
> **Parallel Execution**: YES - 4 waves
> **Critical Path**: Task 1 → Task 3 → Task 5 → Task 8 → Task 12 → Task 15 → F1-F4

---

## Context

### Original Request
User wants to transform fin-agent from an OpenCode plugin into a standalone financial analysis system with:
1. Python main framework as the orchestration layer
2. OpenCode agents as callable services via HAPI
3. WebUI elevated to peer level, managing both framework and OpenCode
4. Mature REST API exposing all functionality (agents, tools, skills)

### Interview Summary
**Key Discussions**:
- HAPI provides request-response pattern for calling OpenCode agents
- Python main framework controls everything; OpenCode is a tool
- Mixed session mode (short + long sessions)
- Socket.IO communication between Python and HAPI Hub
- WebUI extended (not rewritten) with new framework management pages

**Research Findings**:
- HAPI Hub REST API: POST /api/sessions/:id/messages, GET /api/sessions/:id/messages
- Current project: 9 agents, 5 MCP servers, 18+ tools, 4 skills
- Current WebUI: React + Express, manages agents/skills/MCP/tools/permissions
- Current orchestrator.ts: Uses ZAI SDK, TOOL_SERVER_MAP routes to 5 servers

### Metis Review
**Identified Gaps** (addressed):
- Persistence tech stack → SQLite (already in project)
- WebUI tech stack → Extend existing React WebUI
- Session lifecycle → HAPI Hub owns sessions
- Deployment model → Single-node for v1
- HAPI integration → Python wraps HAPI Hub via REST API
- Auth → Single-user for v1
- Timeout/concurrency → 5 min/job, max 10 concurrent

---

## Work Objectives

### Core Objective
Build a Python FastAPI framework that orchestrates financial analysis by dispatching tasks to OpenCode agents via HAPI, storing results in SQLite, and exposing everything through a mature REST API.

### Concrete Deliverables
- `src/framework/` - Python FastAPI application
- `src/framework/api/` - REST API endpoints
- `src/framework/core/` - Job queue, HAPI bridge, scheduler
- `src/framework/models/` - SQLAlchemy models
- `src/framework/config.py` - Configuration
- Extended `src/webui/` - New pages for framework management
- `requirements.txt` - Python dependencies
- `docker-compose.yml` - Optional Docker setup

### Definition of Done
- [ ] `POST /api/v1/jobs` with valid payload returns 202 + job_id within 500ms
- [ ] `GET /api/v1/jobs/{id}` returns job status (pending/running/completed/failed)
- [ ] `GET /api/v1/jobs/{id}/result` returns structured JSON after completion
- [ ] `GET /api/v1/agents` lists all 9 registered agent types
- [ ] `POST /api/v1/tools/{name}/invoke` calls MCP tool directly
- [ ] Job persists across Python process restart
- [ ] WebUI shows jobs, results, and framework status
- [ ] All tests pass: `pytest src/framework/tests/`

### Must Have
- REST API with `/api/v1/` prefix
- Job queue with SQLite persistence
- HAPI bridge for OpenCode agent communication
- Agent registry (all 9 agents)
- Tool invocation API (all 18+ tools)
- Skill trigger API (all 4 skills)
- Job timeout (5 min default)
- Max concurrent jobs (10 default)
- WebUI framework management pages

### Must NOT Have (Guardrails)
- Mobile UI / responsive native app
- Multi-node distributed job queue
- Custom agent creation via API
- OpenCode protocol modification
- AI-assisted job routing (auto-select agent)
- Real-time collaborative editing
- Plugin system for Python framework
- GraphQL API (REST only for v1)
- Webhook outbound events
- SSO/OAuth integration (local auth only for v1)

---

## Verification Strategy

> **ZERO HUMAN INTERVENTION** - ALL verification is agent-executed. No exceptions.

### Test Decision
- **Infrastructure exists**: NO (new Python framework)
- **Automated tests**: YES (tests-after)
- **Framework**: pytest
- **Test location**: `src/framework/tests/`

### QA Policy
Every task MUST include agent-executed QA scenarios.
Evidence saved to `.omo/evidence/task-{N}-{scenario-slug}.{ext}`.

- **API**: Use Bash (curl) - Send requests, assert status + response fields
- **WebUI**: Use Playwright - Navigate, interact, assert DOM, screenshot
- **Python**: Use Bash (pytest) - Run tests, assert pass/fail

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Start Immediately - foundation):
├── Task 1: Python framework scaffold [quick]
├── Task 2: Database schema + models [quick]
├── Task 3: HAPI bridge module [unspecified-high]
├── Task 4: Configuration management [quick]
└── Task 5: Agent registry [quick]

Wave 2 (After Wave 1 - core API):
├── Task 6: Job queue + persistence (depends: 2) [unspecified-high]
├── Task 7: REST API - Jobs endpoints (depends: 2, 6) [unspecified-high]
├── Task 8: REST API - Agents/Tools/Skills endpoints (depends: 5) [unspecified-high]
├── Task 9: HAPI integration (depends: 3, 6) [deep]
├── Task 10: Scheduler module (depends: 6) [quick]
└── Task 11: Error handling + logging (depends: 7, 8) [quick]

Wave 3 (After Wave 2 - WebUI + integration):
├── Task 12: WebUI - Jobs page (depends: 7) [visual-engineering]
├── Task 13: WebUI - Framework dashboard (depends: 8) [visual-engineering]
├── Task 14: WebUI - Agent detail page (depends: 8) [visual-engineering]
├── Task 15: End-to-end integration test (depends: 9, 11) [deep]
└── Task 16: Documentation (depends: 15) [writing]

Wave FINAL (After ALL tasks):
├── Task F1: Plan compliance audit (oracle)
├── Task F2: Code quality review (unspecified-high)
├── Task F3: Real manual QA (unspecified-high)
└── Task F4: Scope fidelity check (deep)
-> Present results -> Get explicit user okay

Critical Path: Task 1 → Task 3 → Task 6 → Task 9 → Task 15 → F1-F4
Parallel Speedup: ~60% faster than sequential
Max Concurrent: 6 (Wave 2)
```

### Dependency Matrix

| Task | Depends On | Blocks | Wave |
|------|-----------|--------|------|
| 1 | - | 2,3,4,5 | 1 |
| 2 | 1 | 6,7 | 1 |
| 3 | 1 | 9 | 1 |
| 4 | 1 | 6,7,8,9,10 | 1 |
| 5 | 1 | 8 | 1 |
| 6 | 2,4 | 7,9,10 | 2 |
| 7 | 2,4,6 | 11,12 | 2 |
| 8 | 4,5 | 11,13,14 | 2 |
| 9 | 3,4,6 | 15 | 2 |
| 10 | 4,6 | 15 | 2 |
| 11 | 7,8 | 15 | 2 |
| 12 | 7 | 16 | 3 |
| 13 | 8 | 16 | 3 |
| 14 | 8 | 16 | 3 |
| 15 | 9,10,11 | F1-F4 | 3 |
| 16 | 12,13,14,15 | F1-F4 | 3 |

### Agent Dispatch Summary

- **Wave 1**: 5 tasks - T1-T5 → `quick`
- **Wave 2**: 6 tasks - T6-T11 → `unspecified-high`, `deep`, `quick`
- **Wave 3**: 5 tasks - T12-T16 → `visual-engineering`, `deep`, `writing`
- **FINAL**: 4 tasks - F1-F4 → `oracle`, `unspecified-high`, `deep`

---

## TODOs

- [x] 1. Python Framework Scaffold

  **What to do**:
  - Create `src/framework/` directory structure
  - Create `src/framework/main.py` - FastAPI app entry point
  - Create `src/framework/config.py` - Configuration management
  - Create `src/framework/__init__.py` - Package init
  - Create `requirements.txt` with: fastapi, uvicorn, sqlalchemy, httpx, apscheduler, python-socketio, pydantic
  - Create `src/framework/api/__init__.py`, `src/framework/core/__init__.py`, `src/framework/models/__init__.py`
  - Add CORS middleware for WebUI access
  - Add health check endpoint: GET /api/v1/health

  **Must NOT do**:
  - Do not add authentication (v1 is single-user)
  - Do not add database models yet (Task 2)
  - Do not add HAPI integration yet (Task 3)

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Simple scaffolding, no complex logic
  - **Skills**: [`typescript-best-practices`]
    - `typescript-best-practices`: Not needed for Python
  - **Skills Evaluated but Omitted**:
    - `frontend-design`: No UI work in this task

  **Parallelization**:
  - **Can Run In Parallel**: NO (foundation task)
  - **Parallel Group**: Wave 1 (first)
  - **Blocks**: Tasks 2, 3, 4, 5
  - **Blocked By**: None

  **References**:
  - `src/mcp-server/package.json` - Node.js project structure pattern
  - `src/webui/server/index.ts` - Express server pattern (for CORS, routes)
  - `src/skill/src/orchestrator.ts` - Python-like structure reference

  **Acceptance Criteria**:
  - [ ] `src/framework/main.py` exists with FastAPI app
  - [ ] `src/framework/config.py` exists with Settings class
  - [ ] `requirements.txt` exists with all dependencies
  - [ ] `python -c "from src.framework.main import app"` succeeds
  - [ ] `curl http://localhost:8000/api/v1/health` returns `{"status": "ok"}`

  **QA Scenarios**:
  ```
  Scenario: Health check endpoint returns ok
    Tool: Bash (curl)
    Preconditions: Framework started on port 8000
    Steps:
      1. Run: curl -s http://localhost:8000/api/v1/health
      2. Parse JSON response
      3. Assert: response.status == "ok"
      4. Assert: response has "timestamp" field
    Expected Result: {"status": "ok", "timestamp": "..."}
    Failure Indicators: Connection refused, missing fields
    Evidence: .omo/evidence/task-1-health-check.json

  Scenario: Framework starts without errors
    Tool: Bash
    Preconditions: requirements.txt installed
    Steps:
      1. Run: cd src/framework && timeout 5 python -m uvicorn main:app --port 8000
      2. Check exit code (should be 0 or timeout)
      3. Check stderr for errors
    Expected Result: No import errors, FastAPI starts
    Failure Indicators: ImportError, ModuleNotFoundError
    Evidence: .omo/evidence/task-1-startup.log
  ```

  **Commit**: YES
  - Message: `feat(framework): scaffold Python FastAPI project`
  - Files: `src/framework/`, `requirements.txt`
  - Pre-commit: `python -c "from src.framework.main import app"`

- [x] 2. Database Schema + Models

  **What to do**:
  - Create `src/framework/models/database.py` - SQLAlchemy engine + session
  - Create `src/framework/models/job.py` - Job model (id, agent, prompt, status, result, created_at, updated_at, timeout)
  - Create `src/framework/models/agent.py` - Agent model (name, description, capabilities, tools)
  - Create `src/framework/models/result.py` - Result model (job_id, data, created_at)
  - Add `init_db()` function to create tables
  - Use SQLite as database (file: `data/fin-agent.db`)

  **Must NOT do**:
  - Do not add migrations (v1 uses init_db)
  - Do not add relationships (keep simple)
  - Do not add indexes (v1 performance is fine)

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Simple SQLAlchemy models
  - **Skills**: []
  - **Skills Evaluated but Omitted**:
    - `typescript-best-practices`: Not applicable

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Tasks 3, 4, 5)
  - **Parallel Group**: Wave 1
  - **Blocks**: Tasks 6, 7
  - **Blocked By**: Task 1

  **References**:
  - `src/mcp-server/src/memory/` - SQLite memory layer pattern
  - `src/skill/src/engines/` - Engine pattern reference

  **Acceptance Criteria**:
  - [ ] `src/framework/models/job.py` exists with Job class
  - [ ] `src/framework/models/agent.py` exists with Agent class
  - [ ] `src/framework/models/result.py` exists with Result class
  - [ ] `src/framework/models/database.py` exists with engine
  - [ ] `python -c "from src.framework.models import Job, Agent, Result"` succeeds

  **QA Scenarios**:
  ```
  Scenario: Database initialization creates tables
    Tool: Bash
    Preconditions: SQLite file does not exist
    Steps:
      1. Run: python -c "from src.framework.models.database import init_db; init_db()"
      2. Check: data/fin-agent.db exists
      3. Run: python -c "from src.framework.models import Job; print(Job.__tablename__)"
    Expected Result: "jobs" printed, db file created
    Failure Indicators: SQLAlchemy errors, missing file
    Evidence: .omo/evidence/task-2-db-init.log

  Scenario: Job model has all required fields
    Tool: Bash
    Preconditions: Models imported
    Steps:
      1. Run: python -c "from src.framework.models import Job; j = Job(id='test', agent='macro-scout', prompt='test', status='pending'); print(j.id, j.agent, j.status)"
    Expected Result: "test macro-scout pending"
    Failure Indicators: AttributeError, missing fields
    Evidence: .omo/evidence/task-2-job-model.log
  ```

  **Commit**: YES (groups with Task 1)
  - Message: `feat(framework): add database models`
  - Files: `src/framework/models/`
  - Pre-commit: `python -c "from src.framework.models import Job, Agent, Result"`

- [x] 3. HAPI Bridge Module

  **What to do**:
  - Create `src/framework/core/hapi_bridge.py` - HAPI Hub client
  - Implement `HAPIBridge` class with methods:
    - `create_session() -> str` - Create OpenCode session via HAPI
    - `send_message(session_id: str, prompt: str) -> str` - Send task to agent
    - `get_messages(session_id: str) -> list` - Get session messages
    - `abort_session(session_id: str)` - Abort session
    - `wait_for_completion(session_id: str, timeout: int) -> str` - Poll until done
  - Use httpx for HTTP calls to HAPI Hub
  - Support Socket.IO for real-time updates (optional, polling for v1)
  - Handle HAPI Hub errors (connection refused, timeout, session not found)

  **Must NOT do**:
  - Do not implement Socket.IO client (v1 uses polling)
  - Do not implement session pooling (v1 creates new session per job)
  - Do not implement retry logic (v1 fails fast)

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: HTTP client integration, error handling
  - **Skills**: []
  - **Skills Evaluated but Omitted**:
    - `typescript-best-practices`: Not applicable

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Tasks 2, 4, 5)
  - **Parallel Group**: Wave 1
  - **Blocks**: Task 9
  - **Blocked By**: Task 1

  **References**:
  - HAPI REST API docs: POST /api/sessions/:id/messages, GET /api/sessions/:id/messages
  - `src/mcp-server/src/mcp/mcpClientManager.ts` - MCP client pattern
  - `src/skill/src/orchestrator.ts` - Tool calling pattern

  **Acceptance Criteria**:
  - [ ] `src/framework/core/hapi_bridge.py` exists with HAPIBridge class
  - [ ] `HAPIBridge.create_session()` calls HAPI Hub
  - [ ] `HAPIBridge.send_message()` sends message to session
  - [ ] `HAPIBridge.get_messages()` retrieves messages
  - [ ] `HAPIBridge.wait_for_completion()` polls until done

  **QA Scenarios**:
  ```
  Scenario: HAPI bridge can create session
    Tool: Bash
    Preconditions: HAPI Hub running on port 3006
    Steps:
      1. Run: python -c "from src.framework.core.hapi_bridge import HAPIBridge; b = HAPIBridge('http://localhost:3006'); print(b.create_session())"
      2. Assert: Returns session ID string
    Expected Result: Session ID printed (e.g., "session-abc123")
    Failure Indicators: Connection refused, HTTP error
    Evidence: .omo/evidence/task-3-create-session.log

  Scenario: HAPI bridge handles connection error
    Tool: Bash
    Preconditions: HAPI Hub NOT running
    Steps:
      1. Run: python -c "from src.framework.core.hapi_bridge import HAPIBridge; b = HAPIBridge('http://localhost:9999'); b.create_session()"
      2. Assert: Raises ConnectionError or similar
    Expected Result: Exception raised with clear message
    Failure Indicators: Silent failure, unclear error
    Evidence: .omo/evidence/task-3-connection-error.log
  ```

  **Commit**: YES
  - Message: `feat(framework): add HAPI bridge module`
  - Files: `src/framework/core/hapi_bridge.py`
  - Pre-commit: `python -c "from src.framework.core.hapi_bridge import HAPIBridge"`

- [x] 4. Configuration Management

  **What to do**:
  - Create `src/framework/config.py` - Pydantic Settings class
  - Add configuration for:
    - `HAPI_HUB_URL` (default: http://localhost:3006)
    - `DATABASE_URL` (default: sqlite:///data/fin-agent.db)
    - `API_PORT` (default: 8000)
    - `JOB_TIMEOUT` (default: 300 seconds)
    - `MAX_CONCURRENT_JOBS` (default: 10)
    - `WEBUI_PORT` (default: 3120)
  - Support `.env` file loading
  - Add validation for required fields

  **Must NOT do**:
  - Do not add encryption for secrets (v1 is local)
  - Do not add hot-reload (v1 requires restart)

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Simple Pydantic settings
  - **Skills**: []
  - **Skills Evaluated but Omitted**:
    - None applicable

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Tasks 2, 3, 5)
  - **Parallel Group**: Wave 1
  - **Blocks**: Tasks 6, 7, 8, 9, 10
  - **Blocked By**: Task 1

  **References**:
  - `src/mcp-server/.env.example` - Environment variable pattern
  - `src/webui/server/index.ts:16` - PORT configuration pattern

  **Acceptance Criteria**:
  - [ ] `src/framework/config.py` exists with Settings class
  - [ ] Settings has all required fields
  - [ ] `.env` file loading works
  - [ ] `python -c "from src.framework.config import settings; print(settings.HAPI_HUB_URL)"` succeeds

  **QA Scenarios**:
  ```
  Scenario: Configuration loads from environment
    Tool: Bash
    Preconditions: .env file with HAPI_HUB_URL=http://test:3006
    Steps:
      1. Create .env: echo "HAPI_HUB_URL=http://test:3006" > src/framework/.env
      2. Run: python -c "from src.framework.config import settings; print(settings.HAPI_HUB_URL)"
      3. Assert: Output is "http://test:3006"
    Expected Result: Configuration loaded correctly
    Failure Indicators: Default value used, import error
    Evidence: .omo/evidence/task-4-config-load.log

  Scenario: Default values work without .env
    Tool: Bash
    Preconditions: No .env file
    Steps:
      1. Run: python -c "from src.framework.config import settings; print(settings.API_PORT)"
      2. Assert: Output is "8000"
    Expected Result: Default value used
    Failure Indicators: ImportError, missing field
    Evidence: .omo/evidence/task-4-defaults.log
  ```

  **Commit**: YES
  - Message: `feat(framework): add configuration management`
  - Files: `src/framework/config.py`, `.env.example`
  - Pre-commit: `python -c "from src.framework.config import settings"`

- [x] 5. Agent Registry

  **What to do**:
  - Create `src/framework/core/agent_registry.py` - Agent registry
  - Define `AgentInfo` dataclass: name, description, capabilities, tools, mode
  - Register all 9 agents from `.opencode/agents/`:
    - fin-orchestrator (primary)
    - macro-scout, sector-rotator, sentiment-decoder
    - technical-chartist, fundamental-auditor
    - smart-money-hound, risk-gatekeeper
    - fusion-brain
  - Add `get_agent(name)` and `list_agents()` methods
  - Parse agent .md files to extract capabilities

  **Must NOT do**:
  - Do not implement dynamic agent creation
  - Do not implement agent modification via API

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Simple registry with static data
  - **Skills**: []
  - **Skills Evaluated but Omitted**:
    - None applicable

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Tasks 2, 3, 4)
  - **Parallel Group**: Wave 1
  - **Blocks**: Task 8
  - **Blocked By**: Task 1

  **References**:
  - `.opencode/agents/*.md` - Agent definitions
  - `src/skill/agents/*.md` - Agent definitions (duplicate)
  - `src/skill/src/orchestrator.ts:100-136` - Agent parsing pattern

  **Acceptance Criteria**:
  - [ ] `src/framework/core/agent_registry.py` exists
  - [ ] All 9 agents registered
  - [ ] `list_agents()` returns 9 agents
  - [ ] `get_agent("macro-scout")` returns agent info

  **QA Scenarios**:
  ```
  Scenario: Agent registry lists all 9 agents
    Tool: Bash
    Preconditions: Agent registry imported
    Steps:
      1. Run: python -c "from src.framework.core.agent_registry import registry; agents = registry.list_agents(); print(len(agents))"
      2. Assert: Output is "9"
    Expected Result: 9 agents listed
    Failure Indicators: Wrong count, import error
    Evidence: .omo/evidence/task-5-agent-count.log

  Scenario: Get specific agent by name
    Tool: Bash
    Preconditions: Agent registry imported
    Steps:
      1. Run: python -c "from src.framework.core.agent_registry import registry; a = registry.get_agent('macro-scout'); print(a.name, a.description)"
      2. Assert: Output contains "macro-scout"
    Expected Result: Agent info returned
    Failure Indicators: KeyError, None returned
    Evidence: .omo/evidence/task-5-get-agent.log
  ```

  **Commit**: YES
  - Message: `feat(framework): add agent registry`
  - Files: `src/framework/core/agent_registry.py`
  - Pre-commit: `python -c "from src.framework.core.agent_registry import registry"`

- [x] 6. Job Queue + Persistence

  **What to do**:
  - Create `src/framework/core/job_manager.py` - Job manager
  - Implement `JobManager` class with methods:
    - `create_job(agent: str, prompt: str, params: dict) -> Job` - Create new job
    - `get_job(job_id: str) -> Job` - Get job by ID
    - `list_jobs(status: str = None) -> list` - List jobs with optional filter
    - `update_job(job_id: str, **kwargs)` - Update job fields
    - `complete_job(job_id: str, result: dict)` - Mark job as completed
    - `fail_job(job_id: str, error: str)` - Mark job as failed
    - `cancel_job(job_id: str)` - Cancel job
  - Use asyncio.Queue for in-memory job queue
  - Persist jobs to SQLite via SQLAlchemy
  - Add job status state machine: pending → running → completed/failed/cancelled

  **Must NOT do**:
  - Do not implement distributed queue (Redis)
  - Do not implement job dependencies (DAG)
  - Do not implement job priorities

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Async queue + database integration
  - **Skills**: []
  - **Skills Evaluated but Omitted**:
    - None applicable

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Tasks 7, 8, 9, 10, 11)
  - **Parallel Group**: Wave 2
  - **Blocks**: Tasks 7, 9, 10
  - **Blocked By**: Tasks 2, 4

  **References**:
  - `src/skill/src/orchestrator.ts` - Orchestrator pattern
  - `src/mcp-server/src/memory/` - SQLite memory pattern
  - `src/framework/models/job.py` - Job model (Task 2)

  **Acceptance Criteria**:
  - [ ] `src/framework/core/job_manager.py` exists
  - [ ] `create_job()` creates job in SQLite
  - [ ] `get_job()` retrieves job by ID
  - [ ] `list_jobs()` returns jobs with filter
  - [ ] Job status transitions work correctly

  **QA Scenarios**:
  ```
  Scenario: Create and retrieve job
    Tool: Bash
    Preconditions: Database initialized
    Steps:
      1. Run: python -c "
         from src.framework.core.job_manager import JobManager
         jm = JobManager()
         job = jm.create_job('macro-scout', 'Analyze macro', {})
         print(job.id, job.status)
         retrieved = jm.get_job(job.id)
         print(retrieved.agent, retrieved.status)
         "
      2. Assert: job.id is UUID, status is 'pending'
      3. Assert: retrieved.agent is 'macro-scout', status is 'pending'
    Expected Result: Job created and retrieved correctly
    Failure Indicators: Database error, missing fields
    Evidence: .omo/evidence/task-6-create-job.log

  Scenario: Job status transition
    Tool: Bash
    Preconditions: Job created
    Steps:
      1. Run: python -c "
         from src.framework.core.job_manager import JobManager
         jm = JobManager()
         job = jm.create_job('macro-scout', 'test', {})
         jm.update_job(job.id, status='running')
         print(jm.get_job(job.id).status)
         jm.complete_job(job.id, {'result': 'ok'})
         print(jm.get_job(job.id).status)
         "
      2. Assert: First print is 'running', second is 'completed'
    Expected Result: Status transitions work
    Failure Indicators: Invalid transition, database error
    Evidence: .omo/evidence/task-6-status-transition.log
  ```

  **Commit**: YES
  - Message: `feat(framework): add job queue and persistence`
  - Files: `src/framework/core/job_manager.py`
  - Pre-commit: `python -c "from src.framework.core.job_manager import JobManager"`

- [x] 7. REST API - Jobs Endpoints

  **What to do**:
  - Create `src/framework/api/jobs.py` - Jobs API router
  - Implement endpoints:
    - `POST /api/v1/jobs` - Submit job (agent, prompt, params)
    - `GET /api/v1/jobs` - List jobs (filter by status, agent)
    - `GET /api/v1/jobs/{job_id}` - Get job status
    - `GET /api/v1/jobs/{job_id}/result` - Get job result
    - `DELETE /api/v1/jobs/{job_id}` - Cancel job
  - Add Pydantic models for request/response validation
  - Add error handling (404, 422, 500)
  - Return 202 Accepted for job submission

  **Must NOT do**:
  - Do not add authentication
  - Do not add rate limiting
  - Do not add WebSocket streaming

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: REST API design, Pydantic models
  - **Skills**: []
  - **Skills Evaluated but Omitted**:
    - None applicable

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Tasks 6, 8, 9, 10, 11)
  - **Parallel Group**: Wave 2
  - **Blocks**: Tasks 11, 12
  - **Blocked By**: Tasks 2, 4, 6

  **References**:
  - `src/webui/server/index.ts` - Express routes pattern
  - `src/webui/server/agents.ts` - Agent routes pattern
  - HAPI REST API: POST /api/sessions/:id/messages

  **Acceptance Criteria**:
  - [ ] `src/framework/api/jobs.py` exists
  - [ ] POST /api/v1/jobs returns 202 + job_id
  - [ ] GET /api/v1/jobs returns job list
  - [ ] GET /api/v1/jobs/{id} returns job status
  - [ ] GET /api/v1/jobs/{id}/result returns result
  - [ ] DELETE /api/v1/jobs/{id} cancels job

  **QA Scenarios**:
  ```
  Scenario: Submit job returns 202
    Tool: Bash (curl)
    Preconditions: Framework running, database initialized
    Steps:
      1. Run: curl -s -X POST http://localhost:8000/api/v1/jobs \
         -H "Content-Type: application/json" \
         -d '{"agent": "macro-scout", "prompt": "Analyze macro"}'
      2. Parse JSON response
      3. Assert: HTTP status is 202
      4. Assert: response.id is UUID
      5. Assert: response.status is "pending"
    Expected Result: {"id": "...", "status": "pending", ...}
    Failure Indicators: 404, 422, 500
    Evidence: .omo/evidence/task-7-submit-job.json

  Scenario: Get job status
    Tool: Bash (curl)
    Preconditions: Job submitted
    Steps:
      1. Submit job (get job_id from previous)
      2. Run: curl -s http://localhost:8000/api/v1/jobs/{job_id}
      3. Assert: response.status is "pending" or "running"
      4. Assert: response.agent is "macro-scout"
    Expected Result: Job status returned
    Failure Indicators: 404, missing fields
    Evidence: .omo/evidence/task-7-get-job.json

  Scenario: Cancel job
    Tool: Bash (curl)
    Preconditions: Job in pending status
    Steps:
      1. Submit job (get job_id)
      2. Run: curl -s -X DELETE http://localhost:8000/api/v1/jobs/{job_id}
      3. Assert: HTTP status is 200
      4. Run: curl -s http://localhost:8000/api/v1/jobs/{job_id}
      5. Assert: response.status is "cancelled"
    Expected Result: Job cancelled
    Failure Indicators: 404, status not updated
    Evidence: .omo/evidence/task-7-cancel-job.json
  ```

  **Commit**: YES
  - Message: `feat(framework): add jobs REST API`
  - Files: `src/framework/api/jobs.py`
  - Pre-commit: `curl -s http://localhost:8000/api/v1/jobs`

- [x] 8. REST API - Agents/Tools/Skills Endpoints

  **What to do**:
  - Create `src/framework/api/agents.py` - Agents API router
  - Create `src/framework/api/tools.py` - Tools API router
  - Create `src/framework/api/skills.py` - Skills API router
  - Implement endpoints:
    - `GET /api/v1/agents` - List all agents
    - `GET /api/v1/agents/{name}` - Get agent details
    - `GET /api/v1/tools` - List all tools
    - `POST /api/v1/tools/{name}/invoke` - Invoke tool directly
    - `GET /api/v1/skills` - List all skills
    - `POST /api/v1/skills/{name}/trigger` - Trigger skill workflow
  - Parse tool definitions from MCP server code
  - Parse skill definitions from SKILL.md files

  **Must NOT do**:
  - Do not implement tool creation via API
  - Do not implement skill creation via API
  - Do not implement tool modification

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: REST API + MCP tool integration
  - **Skills**: []
  - **Skills Evaluated but Omitted**:
    - None applicable

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Tasks 6, 7, 9, 10, 11)
  - **Parallel Group**: Wave 2
  - **Blocks**: Tasks 11, 13, 14
  - **Blocked By**: Tasks 4, 5

  **References**:
  - `src/mcp-server/src/tools/*.ts` - Tool definitions
  - `src/skill/src/orchestrator.ts:36-98` - TOOL_SERVER_MAP
  - `src/skill/*/SKILL.md` - Skill definitions
  - `.opencode/agents/*.md` - Agent definitions

  **Acceptance Criteria**:
  - [ ] `src/framework/api/agents.py` exists
  - [ ] `src/framework/api/tools.py` exists
  - [ ] `src/framework/api/skills.py` exists
  - [ ] GET /api/v1/agents returns 9 agents
  - [ ] GET /api/v1/tools returns 18+ tools
  - [ ] GET /api/v1/skills returns 4 skills
  - [ ] POST /api/v1/tools/{name}/invoke calls MCP tool

  **QA Scenarios**:
  ```
  Scenario: List all agents
    Tool: Bash (curl)
    Preconditions: Framework running
    Steps:
      1. Run: curl -s http://localhost:8000/api/v1/agents
      2. Parse JSON array
      3. Assert: length is 9
      4. Assert: contains "macro-scout", "technical-chartist", etc.
    Expected Result: 9 agents listed
    Failure Indicators: Wrong count, missing agents
    Evidence: .omo/evidence/task-8-list-agents.json

  Scenario: Invoke MCP tool directly
    Tool: Bash (curl)
    Preconditions: MCP servers running
    Steps:
      1. Run: curl -s -X POST http://localhost:8000/api/v1/tools/market_snapshot/invoke \
         -H "Content-Type: application/json" \
         -d '{"indices": ["^IXIC"]}'
      2. Parse JSON response
      3. Assert: response has "data" field
    Expected Result: Tool invoked, data returned
    Failure Indicators: 500, MCP error
    Evidence: .omo/evidence/task-8-invoke-tool.json
  ```

  **Commit**: YES
  - Message: `feat(framework): add agents/tools/skills API`
  - Files: `src/framework/api/agents.py`, `src/framework/api/tools.py`, `src/framework/api/skills.py`
  - Pre-commit: `curl -s http://localhost:8000/api/v1/agents`

- [x] 9. HAPI Integration (Job Execution)

  **What to do**:
  - Create `src/framework/core/executor.py` - Job executor
  - Implement `JobExecutor` class with methods:
    - `execute_job(job: Job)` - Execute job via HAPI
    - `dispatch_to_agent(agent: str, prompt: str) -> str` - Dispatch to OpenCode agent
    - `parse_response(raw: str) -> dict` - Parse agent response
  - Integrate with HAPIBridge (Task 3) and JobManager (Task 6)
  - Add background worker that processes job queue
  - Add timeout handling (5 min default)
  - Add error handling and retry logic (1 retry)

  **Must NOT do**:
  - Do not implement parallel agent dispatch (v1 is sequential)
  - Do not implement agent routing (user specifies agent)
  - Do not implement response streaming

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: Complex integration, async processing
  - **Skills**: []
  - **Skills Evaluated but Omitted**:
    - None applicable

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Tasks 6, 7, 8, 10, 11)
  - **Parallel Group**: Wave 2
  - **Blocks**: Task 15
  - **Blocked By**: Tasks 3, 4, 6

  **References**:
  - `src/framework/core/hapi_bridge.py` - HAPI bridge (Task 3)
  - `src/framework/core/job_manager.py` - Job manager (Task 6)
  - `src/skill/src/orchestrator.ts` - Agent execution pattern

  **Acceptance Criteria**:
  - [ ] `src/framework/core/executor.py` exists
  - [ ] `execute_job()` calls HAPI bridge
  - [ ] Job status updates to 'running' during execution
  - [ ] Job status updates to 'completed' on success
  - [ ] Job status updates to 'failed' on error
  - [ ] Timeout handling works (5 min)

  **QA Scenarios**:
  ```
  Scenario: Execute job successfully
    Tool: Bash
    Preconditions: HAPI Hub running, OpenCode available
    Steps:
      1. Submit job via API: curl -X POST http://localhost:8000/api/v1/jobs -d '{"agent": "macro-scout", "prompt": "Analyze macro"}'
      2. Wait 10 seconds
      3. Get job status: curl http://localhost:8000/api/v1/jobs/{id}
      4. Assert: status is "completed" or "running"
    Expected Result: Job executed, status updated
    Failure Indicators: Stuck in "pending", timeout error
    Evidence: .omo/evidence/task-9-execute-job.json

  Scenario: Job timeout handling
    Tool: Bash
    Preconditions: HAPI Hub running
    Steps:
      1. Submit job with very long prompt (should timeout)
      2. Wait 6 minutes
      3. Get job status
      4. Assert: status is "failed" with timeout error
    Expected Result: Job fails with timeout
    Failure Indicators: Stuck in "running" forever
    Evidence: .omo/evidence/task-9-timeout.log
  ```

  **Commit**: YES
  - Message: `feat(framework): add HAPI job executor`
  - Files: `src/framework/core/executor.py`
  - Pre-commit: `python -c "from src.framework.core.executor import JobExecutor"`

- [x] 10. Scheduler Module

  **What to do**:
  - Create `src/framework/core/scheduler.py` - Job scheduler
  - Implement `Scheduler` class with methods:
    - `add_cron_job(job_id: str, cron_expr: str)` - Schedule recurring job
    - `remove_cron_job(job_id: str)` - Remove scheduled job
    - `list_cron_jobs() -> list` - List scheduled jobs
    - `start()` - Start scheduler
    - `stop()` - Stop scheduler
  - Use APScheduler for cron scheduling
  - Persist schedules to SQLite
  - Add predefined schedules for common tasks:
    - Daily market briefing (9:00 AM)
    - Weekly fin-review (Friday 5:00 PM)

  **Must NOT do**:
  - Do not implement dynamic cron parsing (v1 uses fixed schedules)
  - Do not implement job chaining (v1 is independent jobs)
  - Do not implement distributed scheduling

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: APScheduler wrapper
  - **Skills**: []
  - **Skills Evaluated but Omitted**:
    - None applicable

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Tasks 6, 7, 8, 9, 11)
  - **Parallel Group**: Wave 2
  - **Blocks**: Task 15
  - **Blocked By**: Tasks 4, 6

  **References**:
  - APScheduler documentation
  - `src/skill/market-briefing/SKILL.md` - Market briefing skill
  - `src/skill/fin-review/SKILL.md` - Fin review skill

  **Acceptance Criteria**:
  - [ ] `src/framework/core/scheduler.py` exists
  - [ ] `add_cron_job()` schedules job
  - [ ] `list_cron_jobs()` returns scheduled jobs
  - [ ] Scheduler starts and stops correctly
  - [ ] Predefined schedules registered

  **QA Scenarios**:
  ```
  Scenario: Add and list cron job
    Tool: Bash
    Preconditions: Scheduler initialized
    Steps:
      1. Run: python -c "
         from src.framework.core.scheduler import Scheduler
         s = Scheduler()
         s.add_cron_job('test-job', '0 9 * * *')
         jobs = s.list_cron_jobs()
         print(len(jobs), jobs[0].job_id)
         "
      2. Assert: 1 job listed, job_id is 'test-job'
    Expected Result: Cron job added and listed
    Failure Indicators: APScheduler error, missing job
    Evidence: .omo/evidence/task-10-add-cron.log

  Scenario: Scheduler starts without errors
    Tool: Bash
    Preconditions: Scheduler initialized
    Steps:
      1. Run: python -c "
         from src.framework.core.scheduler import Scheduler
         s = Scheduler()
         s.start()
         print('started')
         s.stop()
         print('stopped')
         "
      2. Assert: 'started' and 'stopped' printed
    Expected Result: Scheduler starts and stops
    Failure Indicators: APScheduler error
    Evidence: .omo/evidence/task-10-start-stop.log
  ```

  **Commit**: YES
  - Message: `feat(framework): add job scheduler`
  - Files: `src/framework/core/scheduler.py`
  - Pre-commit: `python -c "from src.framework.core.scheduler import Scheduler"`

- [x] 11. Error Handling + Logging

  **What to do**:
  - Create `src/framework/core/exceptions.py` - Custom exceptions
  - Create `src/framework/core/logger.py` - Logging configuration
  - Implement exceptions:
    - `FrameworkError` - Base exception
    - `JobNotFoundError` - Job not found (404)
    - `AgentNotFoundError` - Agent not found (404)
    - `ToolNotFoundError` - Tool not found (404)
    - `HAPIConnectionError` - HAPI Hub connection failed (503)
    - `JobTimeoutError` - Job timeout (504)
    - `ValidationError` - Input validation (422)
  - Add structured logging with JSON format
  - Add request logging middleware
  - Add error handlers for FastAPI

  **Must NOT do**:
  - Do not implement Sentry integration
  - Do not implement log rotation (v1 uses stdout)
  - Do not implement metrics collection

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Simple exception classes + logging config
  - **Skills**: []
  - **Skills Evaluated but Omitted**:
    - None applicable

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Tasks 6, 7, 8, 9, 10)
  - **Parallel Group**: Wave 2
  - **Blocks**: Task 15
  - **Blocked By**: Tasks 7, 8

  **References**:
  - `src/mcp-server/src/proxy.ts` - Error handling pattern
  - FastAPI exception handler documentation

  **Acceptance Criteria**:
  - [ ] `src/framework/core/exceptions.py` exists
  - [ ] `src/framework/core/logger.py` exists
  - [ ] All custom exceptions defined
  - [ ] FastAPI error handlers registered
  - [ ] Request logging works

  **QA Scenarios**:
  ```
  Scenario: 404 error returns proper JSON
    Tool: Bash (curl)
    Preconditions: Framework running
    Steps:
      1. Run: curl -s http://localhost:8000/api/v1/jobs/nonexistent
      2. Parse JSON response
      3. Assert: HTTP status is 404
      4. Assert: response.error contains "not found"
    Expected Result: {"error": "Job not found", "status": 404}
    Failure Indicators: 500, HTML error page
    Evidence: .omo/evidence/task-11-404-error.json

  Scenario: Validation error returns 422
    Tool: Bash (curl)
    Preconditions: Framework running
    Steps:
      1. Run: curl -s -X POST http://localhost:8000/api/v1/jobs \
         -H "Content-Type: application/json" \
         -d '{"invalid": "data"}'
      2. Parse JSON response
      3. Assert: HTTP status is 422
      4. Assert: response has "detail" field
    Expected Result: {"detail": [...], "status": 422}
    Failure Indicators: 500, missing validation
    Evidence: .omo/evidence/task-11-422-error.json
  ```

  **Commit**: YES
  - Message: `feat(framework): add error handling and logging`
  - Files: `src/framework/core/exceptions.py`, `src/framework/core/logger.py`
  - Pre-commit: `python -c "from src.framework.core.exceptions import FrameworkError"`

- [x] 12. WebUI - Jobs Page

  **What to do**:
  - Create `src/webui/src/pages/JobsPage.tsx` - Jobs management page
  - Add components:
    - Job list table with status filters (pending/running/completed/failed/cancelled)
    - Job detail modal (shows input, agent, result, timing)
    - Job submission form (select agent, enter prompt)
    - Cancel button for running jobs
  - Add API integration: fetch jobs from `http://localhost:8000/api/v1/jobs`
  - Add real-time status updates (poll every 5 seconds)
  - Add to navigation menu

  **Must NOT do**:
  - Do not implement job editing
  - Do not implement job deletion (only cancel)
  - Do not implement WebSocket streaming

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
    - Reason: React UI components, Ant Design
  - **Skills**: [`frontend-design`]
    - `frontend-design`: UI/UX for job management
  - **Skills Evaluated but Omitted**:
    - None applicable

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Tasks 13, 14, 15, 16)
  - **Parallel Group**: Wave 3
  - **Blocks**: Task 16
  - **Blocked By**: Task 7

  **References**:
  - `src/webui/src/pages/AgentsPage.tsx` - Page pattern
  - `src/webui/src/pages/Dashboard.tsx` - Dashboard pattern
  - `src/webui/src/App.tsx` - Navigation menu
  - `src/webui/server/agents.ts` - API pattern

  **Acceptance Criteria**:
  - [ ] `src/webui/src/pages/JobsPage.tsx` exists
  - [ ] Jobs page accessible at /jobs
  - [ ] Job list shows all jobs with status
  - [ ] Job detail modal shows input/output
  - [ ] Job submission form works
  - [ ] Cancel button works for running jobs

  **QA Scenarios**:
  ```
  Scenario: Jobs page loads and shows jobs
    Tool: Playwright
    Preconditions: Framework running, WebUI running
    Steps:
      1. Navigate to http://localhost:3120/jobs
      2. Wait for page load
      3. Assert: Job list table is visible
      4. Assert: Status filter buttons exist
    Expected Result: Jobs page loaded with table
    Failure Indicators: 404, empty page, no table
    Evidence: .omo/evidence/task-12-jobs-page.png

  Scenario: Submit job via WebUI
    Tool: Playwright
    Preconditions: Jobs page loaded
    Steps:
      1. Click "Submit Job" button
      2. Select agent: "macro-scout"
      3. Enter prompt: "Analyze macro environment"
      4. Click "Submit"
      5. Assert: Job appears in list with status "pending"
    Expected Result: Job submitted and visible
    Failure Indicators: Form error, job not created
    Evidence: .omo/evidence/task-12-submit-job.png
  ```

  **Commit**: YES
  - Message: `feat(webui): add jobs management page`
  - Files: `src/webui/src/pages/JobsPage.tsx`
  - Pre-commit: `npm run build` in src/webui

- [x] 13. WebUI - Framework Dashboard

  **What to do**:
  - Create `src/webui/src/pages/FrameworkDashboard.tsx` - Framework status dashboard
  - Add components:
    - System status card (API health, HAPI Hub status, database status)
    - Job statistics (total, running, completed, failed)
    - Recent jobs list (last 10)
    - Agent utilization chart (which agents used most)
    - Quick action buttons (submit job, view agents)
  - Add API integration: fetch from `http://localhost:8000/api/v1/health` and `/api/v1/jobs`
  - Add auto-refresh every 30 seconds

  **Must NOT do**:
  - Do not implement real-time charts (v1 uses static data)
  - Do not implement custom dashboard widgets
  - Do not implement dashboard export

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
    - Reason: React dashboard, charts
  - **Skills**: [`frontend-design`]
    - `frontend-design`: Dashboard UI/UX
  - **Skills Evaluated but Omitted**:
    - None applicable

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Tasks 12, 14, 15, 16)
  - **Parallel Group**: Wave 3
  - **Blocks**: Task 16
  - **Blocked By**: Task 8

  **References**:
  - `src/webui/src/pages/Dashboard.tsx` - Existing dashboard
  - `src/webui/src/pages/AgentsPage.tsx` - Page pattern
  - Ant Design Charts documentation

  **Acceptance Criteria**:
  - [ ] `src/webui/src/pages/FrameworkDashboard.tsx` exists
  - [ ] Dashboard accessible at /framework
  - [ ] System status card shows health
  - [ ] Job statistics show counts
  - [ ] Recent jobs list shows last 10
  - [ ] Auto-refresh works

  **QA Scenarios**:
  ```
  Scenario: Dashboard loads and shows status
    Tool: Playwright
    Preconditions: Framework running, WebUI running
    Steps:
      1. Navigate to http://localhost:3120/framework
      2. Wait for page load
      3. Assert: System status card is visible
      4. Assert: Job statistics are visible
      5. Assert: Recent jobs list is visible
    Expected Result: Dashboard loaded with all components
    Failure Indicators: 404, empty page, missing components
    Evidence: .omo/evidence/task-13-dashboard.png

  Scenario: Dashboard auto-refreshes
    Tool: Playwright
    Preconditions: Dashboard loaded
    Steps:
      1. Note current job count
      2. Submit new job via API
      3. Wait 35 seconds (auto-refresh interval)
      4. Assert: Job count increased
    Expected Result: Dashboard updated automatically
    Failure Indicators: Stale data, no refresh
    Evidence: .omo/evidence/task-13-auto-refresh.png
  ```

  **Commit**: YES
  - Message: `feat(webui): add framework dashboard`
  - Files: `src/webui/src/pages/FrameworkDashboard.tsx`
  - Pre-commit: `npm run build` in src/webui

- [x] 14. WebUI - Agent Detail Page

  **What to do**:
  - Create `src/webui/src/pages/AgentDetailPage.tsx` - Agent detail page
  - Add components:
    - Agent info card (name, description, capabilities)
    - Tools list (tools this agent can use)
    - Recent jobs for this agent
    - Submit job button (pre-selects this agent)
    - Agent configuration (if any)
  - Add API integration: fetch from `http://localhost:8000/api/v1/agents/{name}`
  - Add route: `/agents/:name`

  **Must NOT do**:
  - Do not implement agent editing
  - Do not implement agent deletion
  - Do not implement agent creation

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
    - Reason: React detail page
  - **Skills**: [`frontend-design`]
    - `frontend-design`: Detail page UI/UX
  - **Skills Evaluated but Omitted**:
    - None applicable

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Tasks 12, 13, 15, 16)
  - **Parallel Group**: Wave 3
  - **Blocks**: Task 16
  - **Blocked By**: Task 8

  **References**:
  - `src/webui/src/pages/AgentsPage.tsx` - Agents list page
  - `src/webui/src/pages/ToolsPage.tsx` - Tools page pattern
  - `.opencode/agents/*.md` - Agent definitions

  **Acceptance Criteria**:
  - [ ] `src/webui/src/pages/AgentDetailPage.tsx` exists
  - [ ] Agent detail accessible at /agents/:name
  - [ ] Agent info card shows name, description
  - [ ] Tools list shows agent's tools
  - [ ] Recent jobs for agent shown
  - [ ] Submit job button works

  **QA Scenarios**:
  ```
  Scenario: Agent detail page loads
    Tool: Playwright
    Preconditions: Framework running, WebUI running
    Steps:
      1. Navigate to http://localhost:3120/agents/macro-scout
      2. Wait for page load
      3. Assert: Agent info card shows "macro-scout"
      4. Assert: Tools list is visible
      5. Assert: Recent jobs section is visible
    Expected Result: Agent detail page loaded
    Failure Indicators: 404, empty page, wrong agent
    Evidence: .omo/evidence/task-14-agent-detail.png

  Scenario: Submit job from agent detail
    Tool: Playwright
    Preconditions: Agent detail page loaded
    Steps:
      1. Click "Submit Job" button
      2. Assert: Job form opens with agent pre-selected
      3. Enter prompt: "Analyze macro"
      4. Click "Submit"
      5. Assert: Job created with correct agent
    Expected Result: Job submitted with pre-selected agent
    Failure Indicators: Wrong agent, form error
    Evidence: .omo/evidence/task-14-submit-from-detail.png
  ```

  **Commit**: YES
  - Message: `feat(webui): add agent detail page`
  - Files: `src/webui/src/pages/AgentDetailPage.tsx`
  - Pre-commit: `npm run build` in src/webui

- [x] 15. End-to-End Integration Test

  **What to do**:
  - Create `src/framework/tests/test_integration.py` - Integration tests
  - Test scenarios:
    - Submit job → HAPI executes → result returned
    - Submit multiple jobs → concurrent execution
    - Job timeout → failure handling
    - HAPI Hub down → graceful error
    - Agent not found → proper error
    - Tool invocation → MCP tool called
    - Skill trigger → workflow executed
  - Add test fixtures for HAPI Hub mock
  - Add test database (SQLite in-memory)

  **Must NOT do**:
  - Do not test WebUI (separate tests)
  - Do not test MCP servers (separate tests)
  - Do not test OpenCode internals

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: Complex integration testing
  - **Skills**: []
  - **Skills Evaluated but Omitted**:
    - None applicable

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Tasks 12, 13, 14, 16)
  - **Parallel Group**: Wave 3
  - **Blocks**: F1-F4
  - **Blocked By**: Tasks 9, 10, 11

  **References**:
  - `src/mcp-server/tests/` - Test patterns
  - `src/mcp-servers/fred/test/` - Test patterns
  - pytest documentation

  **Acceptance Criteria**:
  - [ ] `src/framework/tests/test_integration.py` exists
  - [ ] All integration tests pass
  - [ ] Test coverage > 80%
  - [ ] `pytest src/framework/tests/test_integration.py -v` passes

  **QA Scenarios**:
  ```
  Scenario: Integration tests pass
    Tool: Bash
    Preconditions: Framework code complete
    Steps:
      1. Run: cd src/framework && pytest tests/test_integration.py -v
      2. Assert: All tests pass
      3. Assert: No failures or errors
    Expected Result: All tests green
    Failure Indicators: Test failures, import errors
    Evidence: .omo/evidence/task-15-integration-tests.log

  Scenario: Job submission end-to-end
    Tool: Bash
    Preconditions: HAPI Hub running (or mocked)
    Steps:
      1. Run: pytest tests/test_integration.py::test_job_submission_e2e -v
      2. Assert: Test passes
    Expected Result: Job submitted, executed, result returned
    Failure Indicators: Timeout, HAPI error
    Evidence: .omo/evidence/task-15-e2e-test.log
  ```

  **Commit**: YES
  - Message: `test(framework): add integration tests`
  - Files: `src/framework/tests/test_integration.py`
  - Pre-commit: `pytest src/framework/tests/test_integration.py -v`

- [x] 16. Documentation

  **What to do**:
  - Create `docs/framework/README.md` - Framework documentation
  - Create `docs/framework/API.md` - API documentation
  - Create `docs/framework/DEPLOYMENT.md` - Deployment guide
  - Create `docs/framework/ARCHITECTURE.md` - Architecture overview
  - Add sections:
    - Quick start guide
    - API reference (all endpoints)
    - Configuration reference
    - Deployment instructions (Docker, manual)
    - Troubleshooting guide
  - Generate OpenAPI spec from FastAPI

  **Must NOT do**:
  - Do not implement API documentation UI (Swagger already included)
  - Do not implement video tutorials
  - Do not implement interactive examples

  **Recommended Agent Profile**:
  - **Category**: `writing`
    - Reason: Documentation writing
  - **Skills**: []
  - **Skills Evaluated but Omitted**:
    - None applicable

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Tasks 12, 13, 14, 15)
  - **Parallel Group**: Wave 3
  - **Blocks**: F1-F4
  - **Blocked By**: Tasks 12, 13, 14, 15

  **References**:
  - `README.md` - Existing documentation
  - `BUILD.md` - Build documentation
  - FastAPI OpenAPI documentation

  **Acceptance Criteria**:
  - [ ] `docs/framework/README.md` exists
  - [ ] `docs/framework/API.md` exists
  - [ ] `docs/framework/DEPLOYMENT.md` exists
  - [ ] `docs/framework/ARCHITECTURE.md` exists
  - [ ] API documentation complete
  - [ ] Deployment guide complete

  **QA Scenarios**:
  ```
  Scenario: Documentation files exist
    Tool: Bash
    Preconditions: Documentation written
    Steps:
      1. Run: ls -la docs/framework/
      2. Assert: README.md, API.md, DEPLOYMENT.md, ARCHITECTURE.md exist
      3. Assert: Files are not empty
    Expected Result: All documentation files exist
    Failure Indicators: Missing files, empty files
    Evidence: .omo/evidence/task-16-docs-exist.log

  Scenario: API documentation is complete
    Tool: Bash
    Preconditions: API.md written
    Steps:
      1. Run: grep -c "POST /api/v1/jobs" docs/framework/API.md
      2. Assert: Count > 0
      3. Run: grep -c "GET /api/v1/agents" docs/framework/API.md
      4. Assert: Count > 0
    Expected Result: All endpoints documented
    Failure Indicators: Missing endpoints
    Evidence: .omo/evidence/task-16-api-docs.log
  ```

  **Commit**: YES
  - Message: `docs(framework): add framework documentation`
  - Files: `docs/framework/`
  - Pre-commit: `ls docs/framework/*.md`

---

## Final Verification Wave

> 4 review agents run in PARALLEL. ALL must APPROVE. Present consolidated results to user and get explicit "okay" before completing.

- [x] F1. **Plan Compliance Audit** — `oracle`
  Read the plan end-to-end. For each "Must Have": verify implementation exists (read file, curl endpoint, run command). For each "Must NOT Have": search codebase for forbidden patterns — reject with file:line if found. Check evidence files exist in .omo/evidence/. Compare deliverables against plan.
  Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT: APPROVE/REJECT`

- [x] F2. **Code Quality Review** — `unspecified-high`
  Run `python -m py_compile` on all Python files. Review all changed files for: bare except, print() in prod, unused imports, hardcoded secrets. Check AI slop: excessive comments, over-abstraction, generic names.
  Output: `Build [PASS/FAIL] | Lint [PASS/FAIL] | Tests [N pass/N fail] | Files [N clean/N issues] | VERDICT`

- [x] F3. **Real Manual QA** — `unspecified-high`
  Start from clean state. Execute EVERY QA scenario from EVERY task — follow exact steps, capture evidence. Test cross-task integration (features working together, not isolation). Test edge cases: empty state, invalid input, rapid actions. Save to `.omo/evidence/final-qa/`.
  Output: `Scenarios [N/N pass] | Integration [N/N] | Edge Cases [N tested] | VERDICT`

- [x] F4. **Scope Fidelity Check** — `deep`
  For each task: read "What to do", read actual diff (git log/diff). Verify 1:1 — everything in spec was built (no missing), nothing beyond spec was built (no creep). Check "Must NOT do" compliance. Detect cross-task contamination: Task N touching Task M's files. Flag unaccounted changes.
  Output: `Tasks [N/N compliant] | Contamination [CLEAN/N issues] | Unaccounted [CLEAN/N files] | VERDICT`

---

## Commit Strategy

- **Wave 1**: `feat(framework): scaffold Python FastAPI project` - src/framework/
- **Wave 2**: `feat(framework): add REST API and HAPI bridge` - src/framework/api/, src/framework/core/
- **Wave 3**: `feat(webui): add framework management pages` - src/webui/
- **Wave 4**: `docs(framework): add API documentation` - docs/

---

## Success Criteria

### Verification Commands
```bash
# Start framework
cd src/framework && python -m uvicorn main:app --port 8000

# Health check
curl http://localhost:8000/api/v1/health
# Expected: {"status": "ok"}

# List agents
curl http://localhost:8000/api/v1/agents
# Expected: [{"name": "macro-scout", ...}, ...]

# Submit job
curl -X POST http://localhost:8000/api/v1/jobs \
  -H "Content-Type: application/json" \
  -d '{"agent": "macro-scout", "prompt": "Analyze macro environment"}'
# Expected: {"id": "...", "status": "pending"}

# Get job result
curl http://localhost:8000/api/v1/jobs/{id}/result
# Expected: {"status": "completed", "result": {...}}

# Run tests
pytest src/framework/tests/ -v
# Expected: all pass
```

### Final Checklist
- [ ] All "Must Have" present
- [ ] All "Must NOT Have" absent
- [ ] All tests pass
- [ ] WebUI accessible at port 3120
- [ ] API accessible at port 8000
- [ ] HAPI Hub accessible at port 3006
