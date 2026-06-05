import { useCallback, useRef, useState } from 'react';
import { Node, OnSelectionChangeFunc, useOnSelectionChange } from '@xyflow/react';

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

export interface UseSessionBoundaryOptions {
  onBoundaryCreated?: (boundary: SessionBoundary) => void;
}

export function useSessionBoundary(options: UseSessionBoundaryOptions = {}) {
  const [selectionBox, setSelectionBox] = useState<SelectionBox | null>(null);
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [isSelecting, setIsSelecting] = useState(false);
  const selectionStartRef = useRef<{ x: number; y: number } | null>(null);

  const isSelectingRef = useRef(false);

  const startSelection = useCallback((event: React.MouseEvent | MouseEvent) => {
    const target = event.target as HTMLElement;
    // Only start selection if clicking on the canvas background
    if (target.classList?.contains('react-flow__pane') || target.classList?.contains('react-flow__background')) {
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

    const startX = selectionStartRef.current.x;
    const startY = selectionStartRef.current.y;
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
    // Note: selectionBox persists until next selection starts
  }, []);

  const getSelectedNodes = useCallback((): string[] => {
    return selectedNodeIds;
  }, [selectedNodeIds]);

  const createBoundary = useCallback(async (nodeIds: string[], color: string): Promise<SessionBoundary | null> => {
    if (nodeIds.length === 0) return null;

    try {
      const res = await fetch('/api/workflow/session-boundary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nodeIds, color }),
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const boundary: SessionBoundary = await res.json();
      options.onBoundaryCreated?.(boundary);
      return boundary;
    } catch (err) {
      console.error('Failed to create session boundary:', err);
      return null;
    }
  }, [options]);

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