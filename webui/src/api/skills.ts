/**
 * Typed wrappers for the skill registry API.
 *
 * Mirrors the two routes declared in
 * `main/framework/controllers/skills.py`:
 *
 *   GET  /api/v1/skills                  → full skill catalog
 *   POST /api/v1/skills/{name}/trigger   → trigger a skill (v1 stub)
 *
 * The backend returns snake_case fields with no envelope, so the
 * client types here are plain structural shapes that line up with
 * `SkillQueryService` in `main/framework/services/skill_query_service.py`.
 *
 * Notes
 * -----
 * - `triggerSkill` is currently a stub that preserves the legacy
 *   response shape (`{ message, agents, params }`). A future iteration
 *   will dispatch through the workflow engine and return an
 *   execution id instead.
 * - The backend raises 404 when the skill name is not registered;
 *   the resulting `TypeError` is rethrown so callers can branch on
 *   the status code.
 * - The skill name is URL-encoded so spaces / slashes round-trip
 *   safely through the FastAPI path matcher.
 */

import { API_V1_BASE } from '../config/env';

/**
 * Catalog entry returned by `/api/v1/skills`.
 *
 * `agents` is the ordered list of agent registry names the skill
 * composes — matches the `agents` array in the `.opencode/opencode.json`
 * manifest.
 */
export interface Skill {
  /** Stable skill slug, e.g. `"market-briefing"`. */
  name: string;
  /** Human-readable description used by the skill picker UI. */
  description: string;
  /** Ordered list of agent registry names the skill composes. */
  agents: string[];
}

/**
 * Response shape returned by `POST /api/v1/skills/{name}/trigger`.
 *
 * v1 stub — preserves the legacy contract; a future iteration will
 * replace `agents` / `params` with an execution id and link to the
 * workflow engine run.
 */
export interface SkillTriggerResponse {
  /** Human-readable confirmation, e.g. `"Skill market-briefing triggered"`. */
  message: string;
  /** Echoed agent list resolved from the catalog for the triggered skill. */
  agents: string[];
  /** Parameters echoed back from the request body (defaults to `{}`). */
  params: Record<string, unknown>;
}

/**
 * Fetch every registered skill, in catalog order.
 *
 * `GET /api/v1/skills` → `Skill[]`
 */
export async function listSkills(): Promise<Skill[]> {
  const res = await fetch(`${API_V1_BASE}/skills`);
  if (!res.ok) {
    throw new Error(
      `listSkills failed: ${res.status} ${res.statusText}`,
    );
  }
  return (await res.json()) as Skill[];
}

/**
 * Trigger a skill by registry name (v1 stub).
 *
 * `POST /api/v1/skills/{name}/trigger` with optional JSON body
 * `{ "params": { ... } }` → `SkillTriggerResponse`.
 *
 * The backend raises 404 when `name` is not registered.
 */
export async function triggerSkill(
  name: string,
  params?: Record<string, unknown>,
): Promise<SkillTriggerResponse> {
  const res = await fetch(
    `${API_V1_BASE}/skills/${encodeURIComponent(name)}/trigger`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ params: params ?? {} }),
    },
  );
  if (!res.ok) {
    throw new Error(
      `triggerSkill(${name}) failed: ${res.status} ${res.statusText}`,
    );
  }
  return (await res.json()) as SkillTriggerResponse;
}
