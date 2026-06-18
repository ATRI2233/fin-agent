/**
 * @file Fetches agents for the workflow editor palette panel.
 *
 * Wraps the shared `useAgents` hook with palette-specific
 * filtering — removes internal agents that should not appear in the
 * drag-and-drop palette (e.g. `fin-orchestrator`).
 *
 * @example
 * ```tsx
 * const { agents, loading, error } = usePaletteAgents();
 * ```
 */

import { useMemo } from 'react';

import { useAgents } from '../../../hooks/useAgents';
import type { PaletteAgent } from '../../../types/agent';

/**
 * Fetch and filter agents for the workflow editor palette.
 *
 * Internally calls `useAgents()` and strips agents that are not meant
 * for user-facing palette (currently `fin-orchestrator`). The result
 * is memoised so downstream consumers do not trigger unnecessary
 * re-renders.
 *
 * @returns `{ agents, loading, error }` — `agents` is a
 * {@link PaletteAgent} array ready for the palette panel.
 */
export function usePaletteAgents() {
  const { data, loading, error } = useAgents();

  const agents = useMemo<PaletteAgent[]>(() => {
    if (!data) return [];
    return data
      .filter((a) => a.name !== 'fin-orchestrator')
      .map((a) => ({
        name: a.name,
        description: a.description,
        mode: a.mode,
      }));
  }, [data]);

  return { agents, loading, error };
}
