import { useCallback, useEffect, useState } from 'react';
import { Button, Popover, Space, Tooltip } from 'antd';
import { ClusterOutlined, BorderOutlined } from '@ant-design/icons';
import { SessionBoundary, useSessionBoundary } from './useSessionBoundary';

const PRESET_COLORS = [
  '#3b82f6', // blue
  '#10b981', // green
  '#f59e0b', // amber
  '#ef4444', // red
  '#8b5cf6', // violet
];

export interface SessionBoundarySelectorProps {
  onBoundaryCreated?: (boundary: SessionBoundary) => void;
  nodes?: Array<{ id: string; data?: Record<string, unknown> }>;
}

export default function SessionBoundarySelector({
  onBoundaryCreated,
  nodes = [],
}: SessionBoundarySelectorProps) {
  const [selectedColor, setSelectedColor] = useState(PRESET_COLORS[0]);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [, setBoundaries] = useState<SessionBoundary[]>([]);

  const {
    selectionBox,
    selectedNodeIds,
    isSelecting,
    startSelection,
    updateSelection,
    endSelection,
    getSelectedNodes,
    createBoundary,
  } = useSessionBoundary({ onBoundaryCreated });

  // Attach global mouse listeners when selecting
  useEffect(() => {
    if (!isSelecting) return;

    const handleMouseMove = (e: MouseEvent) => {
      updateSelection(e);
    };

    const handleMouseUp = () => {
      endSelection();
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isSelecting, updateSelection, endSelection]);

  const handleCreateBoundary = useCallback(async () => {
    const nodeIds = getSelectedNodes();
    if (nodeIds.length < 2) return;

    const boundary = await createBoundary(nodeIds, selectedColor ?? "");
    if (boundary) {
      setBoundaries((prev) => [...prev, boundary]);
      setShowColorPicker(false);
    }
  }, [getSelectedNodes, createBoundary, selectedColor]);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      // Only start selection if multiple nodes could be selected
      if (e.button !== 0) return; // Left click only
      startSelection(e);
    },
    [startSelection]
  );

  const getSelectionStyle = useCallback((): React.CSSProperties => {
    if (!selectionBox) return { display: 'none' };

    const width = selectionBox.endX - selectionBox.startX;
    const height = selectionBox.endY - selectionBox.startY;

    return {
      position: 'fixed',
      left: selectionBox.startX,
      top: selectionBox.startY,
      width,
      height,
      border: '2px dashed #3b82f6',
      backgroundColor: 'rgba(59, 130, 246, 0.1)',
      pointerEvents: 'none',
      zIndex: 1000,
    };
  }, [selectionBox]);

  const canCreateBoundary = selectedNodeIds.length >= 2;

  const colorPickerContent = (
    <Space direction="vertical" size={8}>
      <Space size={[4, 4]} wrap>
        {PRESET_COLORS.map((color) => (
          <Tooltip key={color} title={color}>
            <div
              onClick={() => setSelectedColor(color)}
              style={{
                width: 28,
                height: 28,
                borderRadius: 4,
                backgroundColor: color,
                cursor: 'pointer',
                border: selectedColor === color ? '3px solid #000' : '2px solid transparent',
                boxShadow: selectedColor === color ? '0 0 0 2px #fff' : 'none',
              }}
            />
          </Tooltip>
        ))}
      </Space>
    </Space>
  );

  return (
    <div
      className="session-boundary-overlay"
      onMouseDown={handleMouseDown}
      style={{ width: '100%', height: '100%' }}
    >
      {/* Selection box overlay */}
      {selectionBox && isSelecting && (
        <div style={getSelectionStyle()} />
      )}

      {/* Create Session Button */}
      {canCreateBoundary && (
        <div
          style={{
            position: 'absolute',
            bottom: 16,
            right: 16,
            zIndex: 10,
          }}
        >
          <Space>
            <Popover
              content={colorPickerContent}
              title="Select Session Color"
              trigger="click"
              open={showColorPicker}
              onOpenChange={setShowColorPicker}
            >
              <Button icon={<BorderOutlined />} style={{ backgroundColor: selectedColor, color: '#fff' }}>
                Color
              </Button>
            </Popover>
            <Button
              type="primary"
              icon={<ClusterOutlined />}
              onClick={handleCreateBoundary}
              style={{ backgroundColor: selectedColor, borderColor: selectedColor }}
            >
              Create Session ({selectedNodeIds.length} nodes)
            </Button>
          </Space>
        </div>
      )}

      {/* Selection count indicator */}
      {selectedNodeIds.length > 0 && !canCreateBoundary && (
        <div
          style={{
            position: 'absolute',
            bottom: 16,
            left: 16,
            zIndex: 10,
            backgroundColor: 'rgba(0,0,0,0.75)',
            color: '#fff',
            padding: '4px 12px',
            borderRadius: 4,
            fontSize: 12,
          }}
        >
          {selectedNodeIds.length} node{selectedNodeIds.length !== 1 ? 's' : ''} selected
          {selectedNodeIds.length < 2 ? ' (need 2+ to create session)' : ''}
        </div>
      )}
    </div>
  );
}