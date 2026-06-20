/**
 * `useSessionBoundary` — drives rectangle-selection on the React Flow
 * canvas and persists the selected nodes as a `SessionBoundary` via
 * `POST /api/v1/workflow/session-boundary`.
 *
 * The create call goes through the generic `useMutation` primitive
 * on top of `apiPost` , so it inherits the standard
 * `loading` / `error` state, `ApiError` normalisation, and request-id
 * propagation. Each `createBoundary` call attaches a fresh `AbortSignal`
 * so a subsequent call — or component unmount — can cancel an in-flight
 * POST.
 *
 * @example
 * ```tsx
 * const { selectionBox, startSelection, createBoundary } = useSessionBoundary({
 * onBoundaryCreated: (b) => console.log("created", b.id),
 * });
 * ```
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Node, OnSelectionChangeFunc, useOnSelectionChange } from '@xyflow/react';

import { apiPost, buildUrl } from '../../api/http';
import { API_V1_BASE } from '../../config/env';
import { useMutation } from '../../hooks/useMutation';

export interface SelectionBox {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
}

export interface SessionBoundary {
  id: string;
  nodeIds: string[];
  color: string;
}

/** Request body for `POST /api/v1/workflow/session-boundary`. */
interface CreateBoundaryRequest {
  nodeIds: string[];
  color: string;
}

export interface UseSessionBoundaryOptions {
  onBoundaryCreated?: (boundary: SessionBoundary) => void;
}

/** Default empty options — module-level constant to keep reference stable. */
const DEFAULT_OPTIONS: UseSessionBoundaryOptions = {};

export function useSessionBoundary(options: UseSessionBoundaryOptions = DEFAULT_OPTIONS) {
  const [selectionBox, setSelectionBox] = useState<SelectionBox | null>(null);
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [isSelecting, setIsSelecting] = useState(false);
  const selectionStartRef = useRef<{ x: number; y: number } | null>(null);
  const isSelectingRef = useRef(false);

  // Tracks the AbortController of the in-flight `createBoundary` POST so a
  // subsequent call (or unmount) can cancel it. The signal is forwarded
  // into `apiPost` through the mutator closure below.
  const abortRef = useRef<AbortController | null>(null);
  useEffect(
    () => (): void => {
      abortRef.current?.abort();
      abortRef.current = null;
    },
    [],
  );

  const createBoundaryMutation = useMutation<CreateBoundaryRequest, SessionBoundary>(
    (input) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      return apiPost<SessionBoundary>(
        buildUrl(API_V1_BASE, '/workflow/session-boundary'),
        input,
        controller.signal,
      );
    },
  );

  const startSelection = useCallback((event: React.MouseEvent | MouseEvent) => {
    const target = event.target as HTMLElement;
    // Only start selection when clicking on the canvas background.
    if (
      target.classList?.contains('react-flow__pane') ||
      target.classList?.contains('react-flow__background')
    ) {
      isSelectingRef.current = true;
      setIsSelecting(true);
      selectionStartRef.current = { x: event.clientX, y: event.clientY };
      setSelectionBox({
        startX: event.clientX,
        startY: event.clientY,
        endX: event.clientX,
        endY: event.clientY,
      });
    }
  }, []);

  const updateSelection = useCallback((event: MouseEvent) => {
    if (!isSelectingRef.current || !selectionStartRef.current) return;
    const { x: startX, y: startY } = selectionStartRef.current;
    const currentX = event.clientX;
    const currentY = event.clientY;
    setSelectionBox({
      startX: Math.min(startX, currentX),
      startY: Math.min(startY, currentY),
      endX: Math.max(startX, currentX),
      endY: Math.max(startY, currentY),
    });
  }, []);

  const endSelection = useCallback(() => {
    isSelectingRef.current = false;
    setIsSelecting(false);
    selectionStartRef.current = null;
  }, []);

  const getSelectedNodes = useCallback((): string[] => selectedNodeIds, [selectedNodeIds]);

  const createBoundary = useCallback(
    async (nodeIds: string[], color: string): Promise<SessionBoundary | null> => {
      if (nodeIds.length === 0) return null;
      try {
        const boundary = await createBoundaryMutation.mutate({ nodeIds, color });
        options.onBoundaryCreated?.(boundary);
        return boundary;
      } catch (err) {
        console.error('Failed to create session boundary:', err);
        return null;
      }
    },
    [createBoundaryMutation, options],
  );

  const onSelectionChange: OnSelectionChangeFunc = useCallback(({ nodes }) => {
    setSelectedNodeIds(nodes.map((node: Node) => node.id));
  }, []);

  useOnSelectionChange({ onChange: onSelectionChange });

  return {
    selectionBox,
    selectedNodeIds,
    isSelecting,
    startSelection,
    updateSelection,
    endSelection,
    getSelectedNodes,
    createBoundary,
  };
}
