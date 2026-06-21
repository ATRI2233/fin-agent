/**
 * Centralized API base URL configuration.
 *
 * Each constant reads from `import.meta.env` (Vite-injected at build time) and
 * falls back to the project's default path. Defaults match the values that
 * were previously hardcoded across the page modules, so behavior is unchanged
 * when no env vars are set.
 *
 * Override at build time via a `.env` file in `project/webui/`:
 *
 * VITE_API_V1_BASE=https://api.example.com
 *
 * Or inline for a one-off build:
 *
 * VITE_API_V1_BASE=https://api.example.com npm run build
 *
 * Note: Vite only exposes variables prefixed with `VITE_` to the client.
 *
 * The webui talks to a single FastAPI backend on `/api/v1` — both framework
 * and opencode CRUD routes live there. `OPENCODE_API_BASE` was a legacy alias
 * for `/api` (the 9876 Express proxy); it was removed in stage 4 since the
 * proxy is gone.
 */

export const API_V1_BASE = import.meta.env.VITE_API_V1_BASE ?? '/api/v1'
