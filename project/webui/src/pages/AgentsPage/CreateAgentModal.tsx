/**
 * Create-agent modal — extracted verbatim from the original
 * monolithic `AgentsPage.tsx`.
 *
 * The form writes a fresh agent file via the opencode proxy
 * (`PUT /agents/{name}/content`) and reports back to the parent
 * through `onCreated(name)`. The parent is responsible for
 * refetching the registry list and closing the modal — this component
 * only owns the form, its validation, and the request lifecycle.
 *
 * @see ../../api/opencode for the proxy wrappers.
 */

import { useState } from 'react';
import { Button, Form, Input, message, Modal, Select, Space } from 'antd';
import { PlusOutlined } from '@ant-design/icons';

import { opencodePut } from '../../api/opencode';

export interface CreateAgentModalProps {
  visible: boolean;
  onClose: () => void;
  /**
   * Called with the new agent's name after the file is written
   * successfully. The parent uses this to refetch the registry
   * and surface a success toast.
   */
  onCreated: (name: string) => void;
}

interface CreateAgentFormValues {
  name: string;
  description: string;
  mode: 'primary' | 'subagent';
}

const MODE_OPTIONS: { label: string; value: 'primary' | 'subagent' }[] = [
  { label: 'primary', value: 'primary' },
  { label: 'subagent', value: 'subagent' },
];

/**
 * Build the YAML front-matter and a placeholder system prompt for a
 * new agent. Mirrors the original page's body template so the file
 * looks the same as a manually-authored agent.
 */
function buildAgentContent(values: CreateAgentFormValues): string {
  return `---\ndescription: ${values.description}\nmode: ${values.mode}\n---\n\n# ${values.name}\n\nNew agent system prompt.\n`;
}

export function CreateAgentModal({
  visible,
  onClose,
  onCreated,
}: CreateAgentModalProps): JSX.Element {
  const [createForm] = Form.useForm<CreateAgentFormValues>();
  const [createLoading, setCreateLoading] = useState<boolean>(false);

  const handleCancel = (): void => {
    onClose();
  };

  const handleCreate = async (): Promise<void> => {
    try {
      const values = await createForm.validateFields();
      setCreateLoading(true);
      const content = buildAgentContent(values);
      await opencodePut(
        `/agents/${encodeURIComponent(values.name)}/content`,
        { content },
      );
      message.success(`Agent ${values.name} created`);
      onCreated(values.name);
      onClose();
    } catch (err: unknown) {
      // `validateFields` rejects with `{ errorFields }` when validation
      // fails; Ant Design consumes that internally and we should
      // stay silent. Surface anything else as a toast.
      if (err && typeof err === 'object' && 'errorFields' in err) return;
      const msg = err instanceof Error ? err.message : 'Failed to create agent';
      message.error(msg);
    } finally {
      setCreateLoading(false);
    }
  };

  return (
    <Modal
      title="添加 Agent"
      open={visible}
      onCancel={handleCancel}
      footer={
        <Space>
          <Button onClick={handleCancel}>Cancel</Button>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={handleCreate}
            loading={createLoading}
          >
            Create
          </Button>
        </Space>
      }
      width={520}
      destroyOnClose
    >
      <Form
        form={createForm}
        layout="vertical"
        initialValues={{ mode: 'subagent' }}
        style={{ marginTop: 16 }}
      >
        <Form.Item
          name="name"
          label="Name"
          rules={[{ required: true, message: 'Please enter agent name' }]}
        >
          <Input placeholder="e.g. my-custom-agent" />
        </Form.Item>
        <Form.Item
          name="description"
          label="描述"
          rules={[{ required: true, message: 'Please enter description' }]}
        >
          <Input placeholder="What does this agent do?" />
        </Form.Item>
        <Form.Item name="mode" label="模式">
          <Select options={MODE_OPTIONS} />
        </Form.Item>
      </Form>
    </Modal>
  );
}

export default CreateAgentModal;
