import { DiffEditor } from '@monaco-editor/react';
import { Modal, Typography, Tag, Space } from 'antd';
import { SwapOutlined } from '@ant-design/icons';

const { Text } = Typography;

interface DiffPreviewProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  original: string;
  modified: string;
  title?: string;
  loading?: boolean;
}

export default function DiffPreview({
  open,
  onClose,
  onConfirm,
  original,
  modified,
  title = 'Configuration Changes',
  loading = false,
}: DiffPreviewProps) {
  return (
    <Modal
      title={
        <Space>
          <SwapOutlined />
          <span>{title}</span>
        </Space>
      }
      open={open}
      onCancel={onClose}
      onOk={onConfirm}
      width="90vw"
      style={{ top: 20 }}
      styles={{ body: { height: '70vh', padding: 0 } }}
      okText="Save Changes"
      cancelText="Cancel"
      confirmLoading={loading}
      destroyOnClose
    >
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '8px 16px',
            borderBottom: '1px solid #f0f0f0',
            background: '#fafafa',
          }}
        >
          <Space>
            <Tag color="red">- Removed</Tag>
            <Tag color="green">+ Added</Tag>
            <Tag color="blue">~ Modified</Tag>
          </Space>
          <Text type="secondary" style={{ fontSize: 12 }}>
            Review changes before saving
          </Text>
        </div>
        <div style={{ flex: 1, minHeight: 0 }}>
          <DiffEditor
            original={original}
            modified={modified}
            language="json"
            theme="vs-dark"
            options={{
              readOnly: true,
              minimap: { enabled: false },
              fontSize: 13,
              lineNumbers: 'on',
              scrollBeyondLastLine: false,
              wordWrap: 'on',
              renderSideBySide: true,
              enableSplitViewResizing: true,
              renderOverviewRuler: true,
              diffCodeLens: true,
              renderLineHighlight: 'all',
              automaticLayout: true,
            }}
          />
        </div>
      </div>
    </Modal>
  );
}
