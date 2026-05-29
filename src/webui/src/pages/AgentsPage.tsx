import { useEffect, useState, useCallback } from 'react';
import { Typography, Table, Button, Tag, Space, Modal, Spin, Alert, message, Popconfirm, Form, Input, Select } from 'antd';
import { EyeOutlined, EditOutlined, DeleteOutlined, ReloadOutlined, SaveOutlined, PlusOutlined, SettingOutlined } from '@ant-design/icons';
import Editor from '@monaco-editor/react';
import type { ColumnsType } from 'antd/es/table';

const { Title, Text } = Typography;

interface AgentMeta {
  name: string;
  description: string;
  mode: string;
  filePath: string;
}

interface AgentContent {
  name: string;
  content: string;
  description: string;
  mode: string;
}

export default function AgentsPage() {
  const [agents, setAgents] = useState<AgentMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // View modal state
  const [viewVisible, setViewVisible] = useState(false);
  const [viewContent, setViewContent] = useState<AgentContent | null>(null);
  const [viewLoading, setViewLoading] = useState(false);

  // Edit modal state
  const [editVisible, setEditVisible] = useState(false);
  const [editContent, setEditContent] = useState<AgentContent | null>(null);
  const [editLoading, setEditLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editDescription, setEditDescription] = useState('');
  const [editMode, setEditMode] = useState('subagent');

  // Create modal state
  const [createVisible, setCreateVisible] = useState(false);
  const [createLoading, setCreateLoading] = useState(false);
  const [createForm] = Form.useForm();

  // Batch model modal state
  const [batchModelVisible, setBatchModelVisible] = useState(false);
  const [batchModelLoading, setBatchModelLoading] = useState(false);
  const [batchModelForm] = Form.useForm();
  const [agentModels, setAgentModels] = useState<Record<string, string>>({});

  const fetchAgents = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/agents');
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = await res.json();
      setAgents(data.agents ?? []);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load agents';
      setError(msg);
      setAgents([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAgents();
    fetchAgentModels();
  }, [fetchAgents]);

  const fetchAgentModels = async () => {
    try {
      const res = await fetch('/api/agents/models');
      if (res.ok) {
        const data = await res.json();
        setAgentModels(data.models || {});
      }
    } catch {}
  };

  const handleBatchModel = async () => {
    try {
      const values = await batchModelForm.validateFields();
      setBatchModelLoading(true);
      const res = await fetch('/api/agents/batch-model', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: values.model }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      message.success(`Model set for ${data.agentCount} agents`);
      setBatchModelVisible(false);
      batchModelForm.resetFields();
      fetchAgentModels();
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'errorFields' in err) return;
      const msg = err instanceof Error ? err.message : 'Failed to set model';
      message.error(msg);
    } finally {
      setBatchModelLoading(false);
    }
  };

  const handleView = async (name: string) => {
    setViewVisible(true);
    setViewLoading(true);
    setViewContent(null);
    try {
      const res = await fetch(`/api/agents/${name}/content`);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data: AgentContent = await res.json();
      setViewContent(data);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load agent content';
      message.error(msg);
      setViewVisible(false);
    } finally {
      setViewLoading(false);
    }
  };

  const handleEdit = async (name: string) => {
    setEditVisible(true);
    setEditLoading(true);
    setEditContent(null);
    try {
      const res = await fetch(`/api/agents/${name}/content`);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data: AgentContent = await res.json();
      setEditContent(data);
      setEditDescription(data.description || '');
      setEditMode(data.mode || 'subagent');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load agent content';
      message.error(msg);
      setEditVisible(false);
    } finally {
      setEditLoading(false);
    }
  };

  const handleSave = async () => {
    if (!editContent) return;
    setSaving(true);
    try {
      let content = editContent.content;
      // In-place update: replace only description/mode lines within frontmatter
      // Preserves ALL other frontmatter (including nested YAML like permission blocks)
      const fmMatch = content.match(/^---[\r]?\n[\s\S]*?[\r]?\n---/);
      if (fmMatch) {
        let fm = fmMatch[0];
        fm = fm.replace(/^(description:).*/m, `$1 ${editDescription}`);
        fm = fm.replace(/^(mode:).*/m, `$1 ${editMode}`);
        content = content.replace(/^---[\r]?\n[\s\S]*?[\r]?\n---/, fm);
      } else {
        // No frontmatter found — create one
        content = `---\ndescription: ${editDescription}\nmode: ${editMode}\n---\n${content}`;
      }
      const res = await fetch(`/api/agents/${editContent.name}/content`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      message.success('Agent content saved successfully');
      setEditVisible(false);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to save agent content';
      message.error(msg);
    } finally {
      setSaving(false);
    }
  };

  const handleEditorChange = (value: string | undefined) => {
    if (editContent) {
      setEditContent({ ...editContent, content: value ?? '' });
    }
  };

  const handleDelete = async (name: string) => {
    try {
      const res = await fetch(`/api/agents/${name}`, { method: 'DELETE' });
      if (!res.ok && res.status !== 404) throw new Error(`HTTP ${res.status}`);
      message.success(`Agent ${name} deleted`);
      fetchAgents();
    } catch {
      message.error('Failed to delete agent');
    }
  };

  const handleCreate = async () => {
    try {
      const values = await createForm.validateFields();
      setCreateLoading(true);
      const content = `---\ndescription: ${values.description}\nmode: ${values.mode}\n---\n\n# ${values.name}\n\nNew agent system prompt.\n`;
      const res = await fetch(`/api/agents/${values.name}/content`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      message.success(`Agent ${values.name} created`);
      setCreateVisible(false);
      createForm.resetFields();
      fetchAgents();
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'errorFields' in err) return; // form validation
      const msg = err instanceof Error ? err.message : 'Failed to create agent';
      message.error(msg);
    } finally {
      setCreateLoading(false);
    }
  };

  const columns: ColumnsType<AgentMeta> = [
    {
      title: 'Name',
      dataIndex: 'name',
      key: 'name',
      sorter: (a, b) => a.name.localeCompare(b.name),
    },
    {
      title: 'Description',
      dataIndex: 'description',
      key: 'description',
      ellipsis: true,
    },
    {
      title: 'Mode',
      dataIndex: 'mode',
      key: 'mode',
      width: 120,
      render: (mode: string) => (
        <Tag color={mode === 'primary' ? 'blue' : 'default'}>{mode}</Tag>
      ),
      filters: [
        { text: 'primary', value: 'primary' },
        { text: 'subagent', value: 'subagent' },
      ],
      onFilter: (value, record) => record.mode === value,
    },
    {
      title: 'Model',
      key: 'model',
      width: 150,
      render: (_, record) => (
        <Text type="secondary">{agentModels[record.name] || 'not set'}</Text>
      ),
    },
    {
      title: 'Source',
      dataIndex: 'filePath',
      key: 'source',
      width: 100,
      render: (filePath: string) => {
        const isBuiltin = filePath.includes('node_modules') || filePath.includes('builtin');
        return (
          <Tag color={isBuiltin ? 'orange' : 'green'}>
            {isBuiltin ? 'builtin' : 'file'}
          </Tag>
        );
      },
      filters: [
        { text: 'builtin', value: 'builtin' },
        { text: 'file', value: 'file' },
      ],
      onFilter: (value, record) => {
        const isBuiltin = record.filePath.includes('node_modules') || record.filePath.includes('builtin');
        return value === 'builtin' ? isBuiltin : !isBuiltin;
      },
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 220,
      render: (_, record) => (
        <Space>
          <Button
            type="link"
            icon={<EyeOutlined />}
            onClick={() => handleView(record.name)}
          >
            View
          </Button>
          <Button
            type="link"
            icon={<EditOutlined />}
            onClick={() => handleEdit(record.name)}
          >
            Edit
          </Button>
          <Popconfirm
            title="Delete agent?"
            description={`Delete "${record.name}"?`}
            onConfirm={() => handleDelete(record.name)}
          >
            <Button type="link" danger icon={<DeleteOutlined />}>
              Delete
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 24,
        }}
      >
        <div>
          <Title level={4} style={{ margin: 0 }}>
            Agents
          </Title>
          <Text type="secondary">Manage agent configurations and system prompts</Text>
        </div>
        <Space>
          <Button icon={<SettingOutlined />} onClick={() => setBatchModelVisible(true)}>
            Batch Set Model
          </Button>
          <Button icon={<PlusOutlined />} type="primary" onClick={() => setCreateVisible(true)}>
            Add Agent
          </Button>
          <Button icon={<ReloadOutlined />} onClick={fetchAgents} loading={loading}>
            Reload
          </Button>
        </Space>
      </div>

      {error && (
        <Alert
          type="error"
          message="Failed to load agents"
          description={error}
          showIcon
          closable
          onClose={() => setError(null)}
          style={{ marginBottom: 16 }}
        />
      )}

      <Table<AgentMeta>
        columns={columns}
        dataSource={agents}
        rowKey="name"
        loading={loading}
        pagination={{ pageSize: 10 }}
      />

      {/* View Modal */}
      <Modal
        title={viewContent ? `View: ${viewContent.name}` : 'View Agent'}
        open={viewVisible}
        onCancel={() => setViewVisible(false)}
        footer={null}
        width={800}
        destroyOnClose
      >
        {viewLoading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
            <Spin size="large" />
          </div>
        ) : viewContent ? (
          <div>
            <div style={{ marginBottom: 16 }}>
              <Text strong>Description: </Text>
              <Text>{viewContent.description || 'No description'}</Text>
              <Text strong style={{ marginLeft: 16 }}>Mode: </Text>
              <Tag color={viewContent.mode === 'primary' ? 'blue' : 'default'}>
                {viewContent.mode}
              </Tag>
            </div>
            <div
              style={{
                height: 400,
                border: '1px solid #d9d9d9',
                borderRadius: 6,
                overflow: 'hidden',
              }}
            >
              <Editor
                height="100%"
                language="markdown"
                value={viewContent.content}
                options={{
                  readOnly: true,
                  minimap: { enabled: false },
                  fontSize: 14,
                  lineNumbers: 'on',
                  scrollBeyondLastLine: false,
                  wordWrap: 'on',
                }}
                theme="vs-dark"
              />
            </div>
          </div>
        ) : null}
      </Modal>

      {/* Edit Modal */}
      <Modal
        title={editContent ? `Edit: ${editContent.name}` : 'Edit Agent'}
        open={editVisible}
        onCancel={() => setEditVisible(false)}
        footer={
          <Space>
            <Button onClick={() => setEditVisible(false)}>Cancel</Button>
            <Button
              type="primary"
              icon={<SaveOutlined />}
              onClick={handleSave}
              loading={saving}
            >
              Save
            </Button>
          </Space>
        }
        width={800}
        destroyOnClose
      >
        {editLoading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
            <Spin size="large" />
          </div>
        ) : editContent ? (
          <div>
            <Space direction="vertical" style={{ width: '100%', marginBottom: 16 }}>
              <div style={{ display: 'flex', gap: 16 }}>
                <div style={{ flex: 1 }}>
                  <Text strong style={{ display: 'block', marginBottom: 4 }}>Description</Text>
                  <Input
                    value={editDescription}
                    onChange={(e) => setEditDescription(e.target.value)}
                    placeholder="Agent description"
                  />
                </div>
                <div style={{ width: 160 }}>
                  <Text strong style={{ display: 'block', marginBottom: 4 }}>Mode</Text>
                  <Select
                    value={editMode}
                    onChange={(val) => setEditMode(val)}
                    style={{ width: '100%' }}
                    options={[
                      { label: 'primary', value: 'primary' },
                      { label: 'subagent', value: 'subagent' },
                    ]}
                  />
                </div>
              </div>
            </Space>
            <div
              style={{
                height: 400,
                border: '1px solid #d9d9d9',
                borderRadius: 6,
                overflow: 'hidden',
              }}
            >
              <Editor
                height="100%"
                language="markdown"
                value={editContent.content}
                onChange={handleEditorChange}
                options={{
                  minimap: { enabled: false },
                  fontSize: 14,
                  lineNumbers: 'on',
                  scrollBeyondLastLine: false,
                  wordWrap: 'on',
                  tabSize: 2,
                }}
                theme="vs-dark"
              />
            </div>
          </div>
        ) : null}
      </Modal>

      {/* Create Agent Modal */}
      <Modal
        title="Add Agent"
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
            label="Description"
            rules={[{ required: true, message: 'Please enter description' }]}
          >
            <Input placeholder="What does this agent do?" />
          </Form.Item>
          <Form.Item
            name="mode"
            label="Mode"
          >
            <Select
              options={[
                { label: 'primary', value: 'primary' },
                { label: 'subagent', value: 'subagent' },
              ]}
            />
          </Form.Item>
        </Form>
      </Modal>

      {/* Batch Model Modal */}
      <Modal
        title="Batch Set Model for All Agents"
        open={batchModelVisible}
        onCancel={() => { setBatchModelVisible(false); batchModelForm.resetFields(); }}
        footer={
          <Space>
            <Button onClick={() => { setBatchModelVisible(false); batchModelForm.resetFields(); }}>Cancel</Button>
            <Button
              type="primary"
              icon={<SettingOutlined />}
              onClick={handleBatchModel}
              loading={batchModelLoading}
            >
              Apply to All
            </Button>
          </Space>
        }
        width={520}
        destroyOnClose
      >
        <div style={{ marginBottom: 16 }}>
          <Text type="secondary">
            Set the same model for all agents. This will override individual agent model settings.
          </Text>
        </div>
        <Form
          form={batchModelForm}
          layout="vertical"
          style={{ marginTop: 16 }}
        >
          <Form.Item
            name="model"
            label="Model"
            rules={[{ required: true, message: 'Please enter model name' }]}
          >
            <Select
              showSearch
              placeholder="Select a model"
              options={[
                { label: 'mimo/mimo-v2.5-pro', value: 'mimo/mimo-v2.5-pro' },
                { label: 'minimax/MiniMax-M2.7', value: 'minimax/MiniMax-M2.7' },
                { label: 'opencode/mimo-v2.5-free', value: 'opencode/mimo-v2.5-free' },
                { label: 'opencode/deepseek-v4-flash-free', value: 'opencode/deepseek-v4-flash-free' },
                { label: 'opencode/nemotron-3-super-free', value: 'opencode/nemotron-3-super-free' },
              ]}
            />
          </Form.Item>
        </Form>
        <div style={{ marginTop: 16 }}>
          <Text strong>Current agent models:</Text>
          <div style={{ marginTop: 8 }}>
            {Object.entries(agentModels).map(([name, model]) => (
              <div key={name} style={{ marginBottom: 4 }}>
                <Text code>{name}</Text>: <Text type="secondary">{model}</Text>
              </div>
            ))}
          </div>
        </div>
      </Modal>
    </div>
  );
}
