/**
 * useWorkflowStore - Editor state for the workflow DAG editor.
 *
 * Owns the currently-loaded `Workflow` plus transient editor selections and
 * the dirty flag. Intentionally NOT persisted — the editor is meant to start
 * fresh on every reload, mirroring the existing `useState` semantics that this
 * store replaces (see `pages/WorkflowEditor.tsx`).
 *
 * Selectors should be narrow to avoid unnecessary re-renders:
 *
 * @example
 * const workflow = useWorkflowStore((s) => s.currentWorkflow);
 * const setDirty = useWorkflowStore((s) => s.setDirty);
 */

import { create } from 'zustand';
import type { Workflow } from '../types/workflow';

/** Shape of the workflow editor store: state slices + action mutators. */
export interface WorkflowStoreState {
  /** The workflow currently loaded into the editor, or `null` when none. */
  currentWorkflow: Workflow | null;
  /** Id of the node currently selected in the inspector, if any. */
  selectedNodeId: string | null;
  /** Id of the edge currently selected in the inspector, if any. */
  selectedEdgeId: string | null;
  /** `true` when in-memory edits have not yet been saved to the backend. */
  isDirty: boolean;

  /** Replace the loaded workflow. Resets selections and clears the dirty flag. */
  setCurrentWorkflow: (wf: Workflow | null) => void;
  /** Set (or clear, when `null`) the currently selected node id. */
  setSelectedNode: (id: string | null) => void;
  /** Set (or clear, when `null`) the currently selected edge id. */
  setSelectedEdge: (id: string | null) => void;
  /** Force the dirty flag to a specific value. */
  setDirty: (dirty: boolean) => void;
  /** Reset all editor state back to the initial empty editor. */
  resetEditor: () => void;
}

/** Initial state shared by `create` and `resetEditor`. */
const initialState: Pick<
  WorkflowStoreState,
  'currentWorkflow' | 'selectedNodeId' | 'selectedEdgeId' | 'isDirty'
> = {
  currentWorkflow: null,
  selectedNodeId: null,
  selectedEdgeId: null,
  isDirty: false,
};

/**
 * Global workflow editor store hook.
 *
 * No `persist` middleware — editor state is ephemeral and must reset on reload
 * so users never see stale `currentWorkflow` / dirty flags from a prior session.
 */
export const useWorkflowStore = create<WorkflowStoreState>()((set) => ({
  ...initialState,

  setCurrentWorkflow: (wf) =>
    set({
      currentWorkflow: wf,
      // A new workflow invalidates prior selections and unsaved edits.
      selectedNodeId: null,
      selectedEdgeId: null,
      isDirty: false,
    }),

  setSelectedNode: (id) => set({ selectedNodeId: id }),
  setSelectedEdge: (id) => set({ selectedEdgeId: id }),

  setDirty: (dirty) => set({ isDirty: dirty }),

  resetEditor: () => set({ ...initialState }),
}));

export default useWorkflowStore;
