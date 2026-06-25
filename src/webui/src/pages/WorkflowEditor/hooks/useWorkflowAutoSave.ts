/**
 * useWorkflowAutoSave — periodic auto-save for the workflow DAG editor.
 *
 * Mirrors the original 30-second `setInterval` logic from
 * `pages/WorkflowEditor.tsx` (lines 1062–1073). The timer is driven by
 * a `useRef` so it never triggers a re-render; the dirty check reads
 * `isDirty` from `WorkflowContext` (via a ref to avoid stale closure)
 * and skips the save when the editor is clean or when no valid workflow
 * id is present.
 *
 * The caller provides a `getSaveData` callback so the hook can capture
 * the latest nodes / edges / name without owning that state itself.
 *
 * @example
 * useWorkflowAutoSave({
 * workflowId: id,
 * getSaveData: () => ({ nodes, edges, name: workflowName }),
 * });
 */

import { useEffect, useRef } from 'react';

import { useUpdateWorkflow } from '../../../hooks/useWorkflows';
import { useWorkflowContext } from '../WorkflowContext';
import type { UpdateWorkflowPayload } from '../../../domain/workflow';

/** Options accepted by {@link useWorkflowAutoSave}. */
export interface UseWorkflowAutoSaveOptions {
  /** Current workflow id, or `null` / `'new'` to skip auto-save. */
  workflowId: string | null;
  /**
   * Returns the payload to send on each auto-save tick.
   * Called only when the context's `isDirty` flag is `true` and a valid id
   * is present, so it is safe to read ReactFlow state inside.
   */
  getSaveData: () => UpdateWorkflowPayload;
}

/**
 * Set up a 30-second auto-save loop for the workflow editor.
 *
 * Behaviour:
 * - Starts a `setInterval` that fires every 30 000 ms.
 * - On each tick, checks `WorkflowContext`'s `isDirty` flag; if `true`
 * and a valid `workflowId` is provided, calls `updateWorkflow` with
 * the payload from `getSaveData()` and clears the dirty flag on success.
 * - Silently swallows save errors (auto-save is best-effort; the user
 * can always hit the manual Save button).
 * - Cleans up the interval on unmount or when `workflowId` changes.
 *
 * @param options - See {@link UseWorkflowAutoSaveOptions}.
 */
export function useWorkflowAutoSave({
  workflowId,
  getSaveData,
}: UseWorkflowAutoSaveOptions): void {
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const { setDirty, isDirty } = useWorkflowContext();
  const { mutate } = useUpdateWorkflow();
  // Ref keeps the interval callback from seeing a stale `isDirty` closure,
  // mirroring the original `useWorkflowStore.getState().isDirty` trick.
  const isDirtyRef = useRef(isDirty);
  isDirtyRef.current = isDirty;

  useEffect(() => {
    // Clear any prior timer when workflowId changes.
    if (timerRef.current) {
      clearInterval(timerRef.current);
    }

    timerRef.current = setInterval(() => {
      // Read isDirty via the ref to avoid stale closure.
      const dirty = isDirtyRef.current;
      // Guard: only save when dirty AND a valid (non-new) id exists.
      if (!dirty || !workflowId || workflowId === 'new') return;

      const data = getSaveData();
      mutate({ id: workflowId, data })
        .then(() => {
          setDirty(false);
        })
        .catch(() => {
          // Auto-save is best-effort; manual save is the escape hatch.
        });
    }, 30_000);

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
    // mutate is stable across renders (react-query's useMutation returns a stable callback).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workflowId, getSaveData, setDirty]);
}
