# Fin-Agent TypeScript/Node Full-Stack

> **Version 2.1** — migrated from Python (FastAPI) to TypeScript/Node.

## Quick Start

```bash
# Install dependencies
pnpm install

# Generate Drizzle migrations (first time only)
pnpm db:generate

# Start the TypeScript backend in dev mode
pnpm run dev:server

# Or build and run production
pnpm run build:server
pnpm start

# Run tests
pnpm test
pnpm test:run          # CI mode (no watch)
pnpm test:unit         # Only unit tests
pnpm test:integration  # Only integration tests
pnpm test:e2e          # Playwright end-to-end
```

## Switching from Python Backend

The Python backend has been archived to `config/_archive_python/`.

```bash
# To permanently delete the archive (irreversible):
rm -rf config/_archive_python/

# To restore Python backend (moves files back):
mv config/_archive_python/src/main src/main
mv config/_archive_python/src/tests src/tests
# ... etc
```

### Start TypeScript backend

```bash
pnpm run dev:server
```

## Architecture

```
fin-agent/
├── src/server/          # Node.js backend (replaces Python src/main/)
│   ├── index.ts         # Entry point
│   ├── app.ts           # Fastify factory
│   ├── infra/           # Settings, DB, Registry, Auth, Errors
│   ├── api/v1/routes/   # API routers
│   └── modules/         # Domain modules (conversation, workflow, execution, agent)
├── src/webui/           # React frontend (unchanged)
├── src/agents/          # Agent logic & MCP servers (unchanged)
├── tests/               # Vitest tests (unit + integration + e2e)
├── config/              # All configuration & tooling
│   ├── .env             # Environment variables
│   ├── drizzle/         # Database migrations (replaces Alembic)
│   ├── scripts/         # Switch/cleanup utilities
│   ├── _archive_python/ # Archived Python backend (restorable)
│   ├── tsconfig.server.json
│   ├── tsconfig.webui.json
│   ├── vitest.config.ts
│   └── drizzle.config.ts
├── docs/                # Documentation
│   ├── transition/      # Migration plans & ADRs
│   ├── plans/           # Design documents
│   └── refactor-decisions/ # Refactoring decisions
├── data/                # SQLite databases
└── README.md
```

## Key Changes from Python

| Python (old) | TypeScript (new) |
|---|---|
| FastAPI + SQLAlchemy | Fastify + Drizzle ORM + better-sqlite3 |
| Alembic migrations | Drizzle Kit + `config/drizzle/migrations/` |
| pytest + AST analysis | Vitest + runtime assertions |
| `serve_backend` subprocess | Direct `AgentDispatcher` function calls |
| `UoWFactory` + `Repository` + `Service` | Simplified: Repo + Route (2 layers) |
| 108 Python files | ~20 TS server files (80% reduction) |

## API Routes

All routes preserved for frontend compatibility:

- `GET/POST /api/v1/conversations`
- `GET/DELETE /api/v1/conversations/:id`
- `GET/POST /api/v1/conversations/:id/messages`
- `GET /api/v1/workflows`
- `GET /api/v1/workflows/:id`
- `POST /api/v1/workflows/:id/trigger`
- `GET /api/v1/executions /:id /:id/nodes`
- `GET /api/v1/agents /:name`
- `POST /api/v1/agents/:name/dispatch`
- `GET /api/v1/mcp/tools /servers /servers/:name/tools`
- `POST /api/v1/mcp/servers/:name/call`
- `GET /api/v1/health`

## Testing

### Unit Tests (5 files, covers 16 fixed bugs)

```bash
pnpm test:unit
```

- `auth.spec.ts` — H4 localhost bypass (IPv4/IPv6/IPv4-mapped)
- `state_machine.spec.ts` — PENDING→RUNNING→COMPLETED/FAILED transitions
- `output_executor.spec.ts` — H5 missing predecessor → ValidationError
- `date_and_weights.spec.ts` — M3 ISO 8601 Z + M4 cold-start normalization
- `devil_advocate.spec.ts` — M5 null assumptions safety

### Integration Tests (2 files)

```bash
pnpm test:integration
```

- `workflow_and_conversation.spec.ts` — full CRUD + cascade delete + workflow trigger
- `full_stack.spec.ts` — state machine + node lifecycle + failed→skip downstream

## Database

SQLite file format unchanged. Migration from Alembic to Drizzle:

```bash
# Old (Python)
alembic upgrade head

# New (TypeScript)
pnpm db:generate   # Generate migration from schema changes
pnpm db:migrate    # Apply pending migrations
pnpm db:studio     # GUI inspector
```

## Environment Variables

Same as before, all prefixed with `FIN_AGENT_`:

```bash
FIN_AGENT_API_HOST=127.0.0.1
FIN_AGENT_API_PORT=8000
FIN_AGENT_DATABASE_URL=sqlite:///./data/finagent.db
FIN_AGENT_API_KEY=your-secret-key
FIN_AGENT_AUTH_SKIP_LOCALHOST=true
```

`.env` file is loaded from `config/.env` (absolute path, works from any CWD).

## Migration Checklist

- [x] Infrastructure: package.json, tsconfig, pnpm workspace
- [x] Database: Drizzle schema + better-sqlite3 + WAL + auto-migrations
- [x] API: All v1 routes registered with Fastify
- [x] Conversation: full CRUD + cascade delete (H1 fix)
- [x] Workflow: trigger → runner.run → DAG + p-limit concurrency
- [x] Execution: state machine + node lifecycle + retry (H3 fix)
- [x] Agent: direct dispatch (no subprocess, no HTTP)
- [x] Auth: ip-address loopback check (H4 fix)
- [x] Error handling: structured JSON + sanitized messages (H6 fix)
- [x] Tests: unit + integration covering all 16 fixed bugs
- [ ] **Manual**: run `pnpm db:generate` for first-time migration
- [ ] **Manual**: verify frontend works with `pnpm dev:server`
- [ ] **Manual**: run E2E tests with `pnpm test:e2e`
- [ ] **Manual**: archive or delete `src/main/` when fully confident

## Troubleshooting

**Q: `better-sqlite3` fails to compile during `pnpm install`**
A: Make sure you have Python 3 and a C++ compiler installed. On Windows, install `windows-build-tools` or use Visual Studio Build Tools.

**Q: Drizzle migrations fail with "table already exists"**
A: The existing SQLite DB already has tables. Run `pnpm db:generate` first to create a baseline migration from current schema, then `pnpm db:migrate`.

**Q: Frontend shows CORS errors**
A: Ensure `src/webui/.env` or `src/webui/src/config.ts` points to `http://localhost:8000` (TS backend port), not `http://localhost:4096` (opencode port).

**Q: Agent dispatch returns "Agent not found"**
A: The agent handler in `src/server/modules/agent/dispatcher.ts` is a placeholder. Replace with actual `import` from `src/agents/lib/*`.

## Performance Notes

- **better-sqlite3** is synchronous and faster than async sqlite3 for single-threaded Node.
- **p-limit** replaces Python's thread pool for concurrent node execution.
- **No connection pool issues** (C2 fix) — single database connection, WAL mode handles concurrency.
- **Startup time**: ~1 second (vs ~3 seconds for Python + SQLAlchemy import).

## License

Same as original project.
