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
 * VITE_OPENCODE_API_BASE=https://opencode.example.com
 * VITE_MAINTENANCE_API_BASE=https://api.example.com/data-maintenance
 *
 * Or inline for a one-off build:
 *
 * VITE_API_V1_BASE=https://api.example.com npm run build
 *
 * Note: Vite only exposes variables prefixed with `VITE_` to the client.
 */

export const API_V1_BASE = import.meta.env.VITE_API_V1_BASE ?? '/api/v1'

export const OPENCODE_API_BASE = import.meta.env.VITE_OPENCODE_API_BASE ?? '/api'

export const MAINTENANCE_API_BASE =
  import.meta.env.VITE_MAINTENANCE_API_BASE ?? '/api/v1/data-maintenance'
