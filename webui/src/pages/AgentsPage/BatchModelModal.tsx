/**
 * Batch-set-model modal — extracted verbatim from the original
 * monolithic `AgentsPage.tsx`.
 *
 * Owns the form, the model list rendering, and the
 * `POST /agents/batch-model` request lifecycle. The modal pulls its
 * own copy of the model map via the page-local `useAgentModels`
 * hook so it can render the "Current models" section without
 * prop-drilling; the parent triggers its own refetch through the
 * optional `onApplied` callback to keep the table column in sync.
 *
 * @see ./hooks/useAgentModels for the model state hook.
 * @see ../../api/opencode for the proxy wrappers.
 */

import { useState } from 'react';
import { Button, Form, message, Modal, Select, Space, Typography } from 'antd';
import { SettingOutlined } from '@ant-design/icons';

import { useAgentModels } from './hooks/useAgentModels';

const { Text } = Typography;

export interface BatchModelModalProps {
  visible: boolean;
  onClose: () => void;
  /**
   * Called after a successful batch update. The parent uses this to
   * refetch its own model map so the table column reflects the
   * new bindings. Optional — the modal still works without it.
   */
  onApplied?: () => void;
}

interface BatchModelFormValues {
  model: string;
}

/**
 * Hard-coded catalogue of known models. The proxy does not yet
 * expose a model-list endpoint, so we mirror the original page's
 * static list here. Keep entries in sync with the opencode registry
 * (`.opencode/opencode.json` → `provider.models`).
 */
const MODEL_OPTIONS: { label: string; value: string }[] = [
  { label: 'mimo/mimo-v2.5-pro', value: 'mimo/mimo-v2.5-pro' },
  { label: 'minimax/MiniMax-M2.7', value: 'minimax/MiniMax-M2.7' },
  { label: 'opencode/mimo-v2.5-free', value: 'opencode/mimo-v2.5-free' },
  { label: 'opencode/deepseek-v4-flash-free', value: 'opencode/deepseek-v4-flash-free' },
  { label: 'opencode/nemotron-3-super-free', value: 'opencode/nemotron-3-super-free' },
];

export function BatchModelModal({
  visible,
  onClose,
  onApplied,
}: BatchModelModalProps): JSX.Element {
  const [form] = Form.useForm<BatchModelFormValues>();
  const { agentModels, applyBatchModel, refetch } = useAgentModels();
  const [applying, setApplying] = useState<boolean>(false);

  const handleCancel = (): void => {
    onClose();
  };

  const handleApply = async (): Promise<void> => {
    try {
      const values = await form.validateFields();
      setApplying(true);
      const count = await applyBatchModel(values.model);
      message.success(`Model set for ${count} agents`);
      form.resetFields();
      onClose();
      // Refresh our own model map; the parent's map is refreshed
      // through `onApplied` so the table column stays in sync.
      void refetch();
      onApplied?.();
    } catch (err: unknown) {
      // `validateFields` rejects with `{ errorFields }` on validation
      // failure; Ant Design consumes that internally. Surface anything
      // else as a toast.
      if (err && typeof err === 'object' && 'errorFields' in err) return;
      const msg = err instanceof Error ? err.message : 'Failed to set model';
      message.error(msg);
    } finally {
      setApplying(false);
    }
  };

  return (
    <Modal
      title="Batch Set Model"
      open={visible}
      onCancel={handleCancel}
      footer={
        <Space>
          <Button onClick={handleCancel}>Cancel</Button>
          <Button
            type="primary"
            icon={<SettingOutlined />}
            onClick={handleApply}
            loading={applying}
          >
            Apply to All
          </Button>
        </Space>
      }
      width={480}
      destroyOnClose
    >
      <div style={{ marginBottom: 16 }}>
        <Text style={{ color: '#B0B0B0', fontSize: 15 }}>
          Set the same model for all agents. This will override individual settings.
        </Text>
      </div>
      <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
        <Form.Item
          name="model"
          label="Model"
          rules={[{ required: true, message: 'Please enter model name' }]}
        >
          <Select
            showSearch
            placeholder="Select a model"
            options={MODEL_OPTIONS}
          />
        </Form.Item>
      </Form>
      {Object.keys(agentModels).length > 0 && (
        <div style={{ marginTop: 16 }}>
          <Text style={{ color: '#F0F0F0', fontWeight: 500, fontSize: 14 }}>
            Current models:
          </Text>
          <div style={{ marginTop: 10, maxHeight: 200, overflowY: 'auto' }}>
            {Object.entries(agentModels).map(([name, model]) => (
              <div
                key={name}
                style={{
                  marginBottom: 6,
                  display: 'flex',
                  justifyContent: 'space-between',
                }}
              >
                <Text style={{ color: '#F0F0F0', fontSize: 13 }}>{name}</Text>
                <Text style={{ color: '#787878', fontSize: 13 }}>{model}</Text>
              </div>
            ))}
          </div>
        </div>
      )}
    </Modal>
  );
}

export default BatchModelModal;
