/**
 * WorkflowContext — React Context replacement for the old zustand
 * `useWorkflowStore`. Confines editor state (loaded workflow, transient
 * node/edge selections, dirty flag) to the `WorkflowEditor` page subtree.
 *
 * The previous zustand store was only referenced from three files in
 * `pages/WorkflowEditor/`. Migrating to Context lets the editor reset
 * its state on every mount (matching the original "no persist" intent)
 * while avoiding the global module-level singleton that zustand was
 * creating.
 *
 * State semantics mirror the old store exactly:
 * - `setCurrentWorkflow(null)` resets selections + clears the dirty flag.
 * - `resetEditor()` restores the initial state.
 *
 * @example
 * <WorkflowProvider>
 *   <WorkflowEditorInner />
 * </WorkflowProvider>
 */

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { Workflow } from '../../domain/workflow';

/** Shape of the workflow editor context: state + actions. */
export interface WorkflowContextValue {
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

const WorkflowContext = createContext<WorkflowContextValue | null>(null);

const initialState = {
  currentWorkflow: null as Workflow | null,
  selectedNodeId: null as string | null,
  selectedEdgeId: null as string | null,
  isDirty: false,
};

/**
 * Provider that owns the editor's transient state. Wrap the entire
 * `WorkflowEditor` subtree so that child components can call
 * {@link useWorkflowContext}.
 */
export function WorkflowProvider({ children }: { children: ReactNode }) {
  const [currentWorkflow, setCurrentWorkflowState] = useState<Workflow | null>(initialState.currentWorkflow);
  const [selectedNodeId, setSelectedNodeIdState] = useState<string | null>(initialState.selectedNodeId);
  const [selectedEdgeId, setSelectedEdgeIdState] = useState<string | null>(initialState.selectedEdgeId);
  const [isDirty, setIsDirtyState] = useState<boolean>(initialState.isDirty);

  const setCurrentWorkflow = useCallback((wf: Workflow | null) => {
    setCurrentWorkflowState(wf);
    setSelectedNodeIdState(null);
    setSelectedEdgeIdState(null);
    setIsDirtyState(false);
  }, []);

  const setSelectedNode = useCallback((id: string | null) => {
    setSelectedNodeIdState(id);
  }, []);

  const setSelectedEdge = useCallback((id: string | null) => {
    setSelectedEdgeIdState(id);
  }, []);

  const setDirty = useCallback((dirty: boolean) => {
    setIsDirtyState(dirty);
  }, []);

  const resetEditor = useCallback(() => {
    setCurrentWorkflowState(initialState.currentWorkflow);
    setSelectedNodeIdState(initialState.selectedNodeId);
    setSelectedEdgeIdState(initialState.selectedEdgeId);
    setIsDirtyState(initialState.isDirty);
  }, []);

  const value = useMemo<WorkflowContextValue>(
    () => ({
      currentWorkflow,
      selectedNodeId,
      selectedEdgeId,
      isDirty,
      setCurrentWorkflow,
      setSelectedNode,
      setSelectedEdge,
      setDirty,
      resetEditor,
    }),
    [currentWorkflow, selectedNodeId, selectedEdgeId, isDirty, setCurrentWorkflow, setSelectedNode, setSelectedEdge, setDirty, resetEditor],
  );

  return <WorkflowContext.Provider value={value}>{children}</WorkflowContext.Provider>;
}

/**
 * Hook for descendants of {@link WorkflowProvider} to read / mutate
 * editor state. Throws when used outside the provider so misuse fails
 * loudly during development rather than silently producing a null ctx.
 */
export function useWorkflowContext(): WorkflowContextValue {
  const ctx = useContext(WorkflowContext);
  if (!ctx) {
    throw new Error('useWorkflowContext must be used inside <WorkflowProvider>');
  }
  return ctx;
}