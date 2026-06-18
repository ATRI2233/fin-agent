/**
 * AgentsPage — orchestrator for the Agents registry view.
 *
 * split the previous 941-line monolith into focused modules.
 * The orchestrator now owns the page shell (hero header, error alert,
 * table card) and stitches together the extracted pieces:
 *
 * - `useAgents` (local) — registry list + per-agent whitelist
 * counts. Wraps the framework `useAgents` hook .
 * - `useAgentModels` — name → model map for the table column.
 * - `buildAgentColumns` — table column factory that takes a
 * `ColumnsContext` (model map + counts) and `ColumnCallbacks`
 * (view / edit / delete).
 * - `BatchModelModal` — extracted batch-set-model modal.
 * - `ViewAgentModal` / `EditAgentModal` — this wave's extractions.
 *
 * The Create modal is still inlined: the sibling's
 * `CreateAgentModal.tsx` has a broken relative import path
 * (`../../../api/opencode` instead of `../../api/opencode`), so we
 * duplicate the form here rather than depend on the broken module.
 *
 * State ownership:
 * - Modal targets (`viewing` / `editing`) are `string | null` so the
 * extracted modals can gate on the name and reset on close.
 * - `createVisible` / `batchModelVisible` are local to the page since
 * they gate the inlined Create modal and the extracted
 * `BatchModelModal` respectively.
 * - `createLoading` lives here so the inlined Create submit button
 * can show a spinner; the Batch modal owns its own `applying` flag.
 *
 * @see ./hooks/useAgents for the list hook (local wrapper)
 * @see ./hooks/useAgentModels for the model state
 * @see ./columns for the table column factory
 * @see ./BatchModelModal for the batch-set-model modal
 * @see ./ViewAgentModal for the read-only Monaco viewer
 * @see ./EditAgentModal for the Monaco editor + whitelist picker
 */

import { useState } from 'react';
import {
  Typography,
  Table,
  Button,
  Space,
  Modal,
  Spin,
  Alert,
  Form,
  Input,
  Select,
  Card,
  message,
} from 'antd';
import {
  PlusOutlined,
  ReloadOutlined,
  SettingOutlined,
} from '@ant-design/icons';

import { deleteAgent, updateAgent } from '../../api/agents';
import { useAgentsPage } from './hooks/useAgentsPage';
import { useAgentModels } from './hooks/useAgentModels';
import { buildAgentColumns } from './columns';
import BatchModelModal from './BatchModelModal';
import ViewAgentModal from './ViewAgentModal';
import EditAgentModal from './EditAgentModal';

const { Text } = Typography;

export default function AgentsPage() {
  // List data: agents + per-agent whitelist counts.
  const {
    agents,
    loading,
    error,
    refetch: refetchAgents,
    agentWhitelistCounts,
  } = useAgentsPage();

  // Model state for the table column.
  const { agentModels, refetch: refetchModels } = useAgentModels();

  // Modal targets.
  const [viewing, setViewing] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [createVisible, setCreateVisible] = useState(false);
  const [createForm] = Form.useForm();
  const [createLoading, setCreateLoading] = useState(false);
  const [batchModelVisible, setBatchModelVisible] = useState(false);

  // Delete handler. The sibling columns file dropped the row-level
  // Popconfirm; we restore the confirm UX through `Modal.confirm` so
  // the user still has to acknowledge the destructive action.
  const handleDelete = (name: string) => {
    Modal.confirm({
      title: 'Delete agent?',
      content: `Delete "${name}"?`,
      okText: 'Delete',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await deleteAgent(name);
          message.success(`Agent ${name} deleted`);
          refetchAgents();
        } catch {
          message.error('Failed to delete agent');
        }
      },
    });
  };

  // Create handler — writes a fresh agent file via the proxy and
  // refreshes the registry on success.
  const handleCreate = async () => {
    try {
      const values = await createForm.validateFields();
      setCreateLoading(true);
      const content = `---\ndescription: ${values.description}\nmode: ${values.mode}\n---\n\n# ${values.name}\n\nNew agent system prompt.\n`;
      await updateAgent(values.name, content);
      message.success(`Agent ${values.name} created`);
      setCreateVisible(false);
      createForm.resetFields();
      refetchAgents();
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'errorFields' in err) return;
      const msg = err instanceof Error ? err.message : 'Failed to create agent';
      message.error(msg);
    } finally {
      setCreateLoading(false);
    }
  };

  const columns = buildAgentColumns(
    { agentModels, agentWhitelistCounts },
    {
      onView: (name) => setViewing(name),
      onEdit: (name) => setEditing(name),
      onDelete: handleDelete,
    },
  );

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh' }}>
        <div style={{ textAlign: 'center' }}>
          <Spin size="large" />
          <div style={{ marginTop: 16, color: '#787878', fontSize: 14 }}>Loading...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="page-container fade-in">
      {/* Hero Header */}
      <div style={{ marginBottom: 40, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div className="page-hero" style={{ marginBottom: 0 }}>
          <h1 className="page-hero-title">Agents</h1>
          <p className="page-hero-subtitle">配置和管理 AI Agent</p>
        </div>
        <Space size={12}>
          <Button
            icon={<SettingOutlined />}
            onClick={() => setBatchModelVisible(true)}
            size="large"
          >
            批量设置模型
          </Button>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => setCreateVisible(true)}
            size="large"
          >
            添加 Agent
          </Button>
          <Button
            icon={<ReloadOutlined />}
            onClick={refetchAgents}
            size="large"
          />
        </Space>
      </div>

      {error && (
        <Alert
          type="error"
          message="加载 Agent 失败"
          description={error}
          showIcon
          closable
          onClose={() => refetchAgents()}
          style={{ marginBottom: 24 }}
        />
      )}

      {/* Agents Table */}
      <Card className="card-spacious fade-in fade-in-2">
        <Table
          columns={columns}
          dataSource={agents}
          rowKey="name"
          loading={loading}
          pagination={{ pageSize: 15 }}
          size="middle"
        />
      </Card>

      {/* View / Edit modals — own their own data + state. */}
      <ViewAgentModal
        visible={viewing !== null}
        onClose={() => setViewing(null)}
        agentName={viewing}
      />
      <EditAgentModal
        visible={editing !== null}
        onClose={() => setEditing(null)}
        agentName={editing}
      />

      {/* Create Agent Modal (inlined; sibling extraction has a broken import). */}
      <Modal
        title="添加 Agent"
        open={createVisible}
        onCancel={() => { setCreateVisible(false); createForm.resetFields(); }}
        footer={
          <Space>
            <Button onClick={() => { setCreateVisible(false); createForm.resetFields(); }}>Cancel</Button>
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
            <Select
              options={[
                { label: 'primary', value: 'primary' },
                { label: 'subagent', value: 'subagent' },
              ]}
            />
          </Form.Item>
        </Form>
      </Modal>

      {/* Batch Model Modal — extracted sibling component, takes care
          of its own loading + form lifecycle. We pass `onApplied` so
          the orchestrator can re-pull the model map for the column. */}
      <BatchModelModal
        visible={batchModelVisible}
        onClose={() => setBatchModelVisible(false)}
        onApplied={() => refetchModels()}
      />
    </div>
  );
}
