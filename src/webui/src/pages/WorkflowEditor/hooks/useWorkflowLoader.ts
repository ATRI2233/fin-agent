/**
 * `useWorkflowLoader` — orchestrates workflow fetching, block import, and
 * workflow triggering for the WorkflowEditor page.
 *
 * - **Loading**: wraps `useWorkflow` from hooks; auto-fetches when
 * `workflowId` changes.
 * - **Import block**: fetches a foreign workflow, prefixes all node/edge IDs
 * to avoid collisions, computes a bounding-box layout offset, and returns
 * the processed data for the caller to merge into the React Flow canvas.
 * - **Trigger**: wraps `useTriggerWorkflow` behind a stable callback with
 * optional free-form `params`.
 *
 * @example
 * ```tsx
 * const { workflow, loading, error, importBlock, triggerWorkflow } =
 * useWorkflowLoader(id);
 *
 * const handleImport = async (wfId: string, wfName: string) => {
 * const result = await importBlock(wfId, wfName);
 * if (result) {
 * setNodes((nds) => [...nds, result.blockNode, ...result.nodes]);
 * setEdges((eds) => [...eds, ...result.edges]);
 * }
 * };
 * ```
 */

import { useCallback } from 'react';

import { useWorkflow, useTriggerWorkflow } from '../../../hooks/useWorkflows';
import { getWorkflow } from '../../../api/workflows';
import type { WorkflowNode, WorkflowEdge } from '../../../domain/workflow';

/* ─── Return types ──────────────────────────────────────────────────── */

/** Payload returned by `importBlock` on success, `null` on failure. */
export interface ImportBlockResult {
  /** Container node representing the imported workflow block. */
  blockNode: WorkflowNode;
  /** Imported child nodes with prefixed IDs and adjusted positions. */
  nodes: WorkflowNode[];
  /** Imported edges with prefixed IDs. */
  edges: WorkflowEdge[];
}

/* ─── Hook ──────────────────────────────────────────────────────────── */

/**
 * Load a workflow by id and expose helpers for block import and triggering.
 *
 * @param workflowId - Workflow id, or `null` to skip loading (new workflow).
 */
export function useWorkflowLoader(workflowId: string | null) {
  const { data: workflow, loading, error } = useWorkflow(workflowId);
  const triggerMutation = useTriggerWorkflow();

  /**
   * Fetch a foreign workflow and produce prefixed nodes/edges suitable for
   * merging into the current canvas without id collisions.
   *
   * Returns `null` when the source workflow has no nodes or when the fetch
   * fails.
   *
   * @param blockId - Id of the workflow to import.
   * @param blockName - Display name for the container block node.
   */
  const importBlock = useCallback(
    async (blockId: string, blockName: string): Promise<ImportBlockResult | null> => {
      try {
        const source = await getWorkflow(blockId);
        const sourceNodes = source.nodes ?? [];
        const sourceEdges = source.edges ?? [];

        if (sourceNodes.length === 0) return null;

        const prefix = `wf-${blockId.substring(0, 8)}-`;
        const timestamp = Date.now();

        // Bounding-box offset so imported nodes land at a visible canvas position.
        const positions = sourceNodes.map((n) => (n as { position?: { x: number; y: number } }).position ?? { x: 0, y: 0 });
        const minX = Math.min(...positions.map((p) => p.x));
        const minY = Math.min(...positions.map((p) => p.y));
        const baseX = 200;
        const baseY = 100;

        const importedNodes: WorkflowNode[] = sourceNodes.map((sn) => {
          const pos = (sn as { position?: { x: number; y: number } }).position ?? { x: 0, y: 0 };
          return {
            id: `${prefix}${sn.id}`,
            type: sn.type === 'debate' ? 'debate' : 'agent',
            position: { x: baseX + (pos.x - minX), y: baseY + (pos.y - minY) },
            data: { ...(sn.data ?? {}) },
          } as WorkflowNode;
        });

        const importedEdges: WorkflowEdge[] = sourceEdges.map((se) => ({
          id: `${prefix}${se.id ?? `${se.source}-${se.target}`}`,
          source: `${prefix}${se.source}`,
          target: `${prefix}${se.target}`,
          type: 'smoothstep',
          animated: true,
          style: { stroke: '#6B6B6B', strokeWidth: 2 },
          data: se.data
            ? { prompt: String((se.data as unknown as Record<string, unknown>).prompt ?? ''), promptType: ((se.data as unknown as Record<string, unknown>).promptType as string) ?? 'context' }
            : { prompt: '', promptType: 'context' },
        }));

        const childNodeIds = importedNodes.map((n) => n.id);
        const blockNode: WorkflowNode = {
          id: `wfb-${timestamp}`,
          type: 'workflow-block',
          position: { x: baseX - 20, y: baseY - 60 },
          data: { label: blockName, workflowId: blockId, workflowName: blockName, childNodeIds, inputs: {} },
        };

        return { blockNode, nodes: importedNodes, edges: importedEdges };
      } catch {
        return null;
      }
    },
    [],
  );

  /**
   * Trigger a workflow run asynchronously.
   *
   * @param params - Optional free-form parameters forwarded to the engine.
   * @returns The trigger result (contains `execution_id`).
   */
  const triggerWorkflow = useCallback(
    (params?: Record<string, unknown>) => {
      if (!workflowId) throw new Error('Cannot trigger workflow without an id');
      return triggerMutation.mutate({ id: workflowId, params });
    },
    [workflowId, triggerMutation],
  );

  return {
    workflow,
    loading,
    error: error?.message ?? null,
    importBlock,
    triggerWorkflow,
  };
}
