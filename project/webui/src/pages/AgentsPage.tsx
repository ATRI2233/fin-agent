import { useEffect, useState, useCallback } from 'react';
import { Typography, Table, Button, Tag, Space, Modal, Spin, Alert, message, Popconfirm, Form, Input, Select, Card } from 'antd';
import {
  EyeOutlined,
  EditOutlined,
  DeleteOutlined,
  ReloadOutlined,
  SaveOutlined,
  PlusOutlined,
  SettingOutlined,
  RobotOutlined,
  ToolOutlined,
} from '@ant-design/icons';
import Editor from '@monaco-editor/react';
import type { ColumnsType } from 'antd/es/table';

const { Text } = Typography;

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

interface ToolItem {
  key: string;
  title: string;
  description: string;
  source: string;
  category?: string;
  mcpServer?: string;
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

  // Tools whitelist state
  const [availableTools, setAvailableTools] = useState<ToolItem[]>([]);
  const [editWhitelist, setEditWhitelist] = useState<string[]>([]);
  const [whitelistLoading, setWhitelistLoading] = useState(false);
  const [toolFilterSource, setToolFilterSource] = useState<string>('all');
  const [toolFilterServer, setToolFilterServer] = useState<string>('all');
  const [toolFilterCategory, setToolFilterCategory] = useState<string>('all');

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
    fetchAvailableTools();
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

  const fetchAvailableTools = async () => {
    try {
      // Fetch MCP tools
      const mcpRes = await fetch('/api/mcp');
      const toolsRes = await fetch('/api/tools');
      const tools: ToolItem[] = [];

      if (mcpRes.ok) {
        const mcpData = await mcpRes.json();
        for (const [serverName, serverConfig] of Object.entries(mcpData as Record<string, any>)) {
          const mcpTools = serverConfig.tools || [];
          if (Array.isArray(mcpTools)) {
            for (const tool of mcpTools) {
              tools.push({
                key: `${serverName}_${tool.name}`,
                title: tool.name,
                description: tool.description || '',
                source: 'mcp',
                category: tool.category || '其他',
                mcpServer: serverName,
              });
            }
          }
        }
      }

      if (toolsRes.ok) {
        const toolsData = await toolsRes.json();
        for (const [name, config] of Object.entries(toolsData as Record<string, any>)) {
          tools.push({
            key: name,
            title: name,
            description: config.description || '',
            source: 'custom',
            category: config.category || '自定义',
          });
        }
      }

      // Add builtin tools
      const builtins = [
        { key: 'read', title: 'Read', description: '从磁盘读取文件', source: 'builtin', category: '文件' },
        { key: 'edit', title: 'Edit', description: '编辑磁盘文件', source: 'builtin', category: '文件' },
        { key: 'bash', title: 'Bash', description: '执行 Shell 命令', source: 'builtin', category: '系统' },
        { key: 'grep', title: 'Grep', description: '搜索文件内容', source: 'builtin', category: '文件' },
        { key: 'glob', title: 'Glob', description: '按模式查找文件', source: 'builtin', category: '文件' },
        { key: 'websearch', title: 'Web Search', description: '搜索网页', source: 'builtin', category: '网络' },
        { key: 'webfetch', title: 'Web Fetch', description: '获取 URL', source: 'builtin', category: '网络' },
        { key: 'lsp_diagnostics', title: 'LSP Diagnostics', description: '获取 LSP 错误/警告', source: 'builtin', category: '开发' },
      ];
      tools.push(...builtins);

      setAvailableTools(tools);
    } catch (err) {
      console.error('Failed to fetch available tools:', err);
    }
  };

  const fetchToolsWhitelist = async (agentName: string) => {
    setWhitelistLoading(true);
    try {
      const res = await fetch(`/api/agents/${agentName}/tools-whitelist`);
      if (res.ok) {
        const data = await res.json();
        setEditWhitelist(data.tools_whitelist || []);
      } else {
        setEditWhitelist([]);
      }
    } catch {
      setEditWhitelist([]);
    } finally {
      setWhitelistLoading(false);
    }
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
    setEditWhitelist([]);
    setToolFilterSource('all');
    setToolFilterServer('all');
    setToolFilterCategory('all');
    try {
      const res = await fetch(`/api/agents/${name}/content`);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data: AgentContent = await res.json();
      setEditContent(data);
      setEditDescription(data.description || '');
      setEditMode(data.mode || 'subagent');
      // Fetch tools whitelist
      await fetchToolsWhitelist(name);
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
      const fmMatch = content.match(/^---[\r]?\n[\s\S]*?[\r]?\n---/);
      if (fmMatch) {
        let fm = fmMatch[0];
        fm = fm.replace(/^(description:).*/m, `$1 ${editDescription}`);
        fm = fm.replace(/^(mode:).*/m, `$1 ${editMode}`);
        content = content.replace(/^---[\r]?\n[\s\S]*?[\r]?\n---/, fm);
      } else {
        content = `---\ndescription: ${editDescription}\nmode: ${editMode}\n---\n${content}`;
      }
      
      // Save agent content
      const res = await fetch(`/api/agents/${editContent.name}/content`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      // Save tools whitelist
      const whitelistRes = await fetch(`/api/agents/${editContent.name}/tools-whitelist`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tools_whitelist: editWhitelist }),
      });
      if (!whitelistRes.ok) {
        throw new Error(`Failed to save tools whitelist: HTTP ${whitelistRes.status}`);
      }

      message.success('Agent saved');
      setEditVisible(false);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to save agent';
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
      if (err && typeof err === 'object' && 'errorFields' in err) return;
      const msg = err instanceof Error ? err.message : 'Failed to create agent';
      message.error(msg);
    } finally {
      setCreateLoading(false);
    }
  };

  // Fetch tools whitelist counts for all agents
  const [agentWhitelistCounts, setAgentWhitelistCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    const fetchAllWhitelistCounts = async () => {
      const counts: Record<string, number> = {};
      for (const agent of agents) {
        try {
          const res = await fetch(`/api/agents/${agent.name}/tools-whitelist`);
          if (res.ok) {
            const data = await res.json();
            counts[agent.name] = data.tools_whitelist?.length || 0;
          }
        } catch {}
      }
      setAgentWhitelistCounts(counts);
    };
    if (agents.length > 0) {
      fetchAllWhitelistCounts();
    }
  }, [agents]);

  const columns: ColumnsType<AgentMeta> = [
    {
      title: 'Name',
      dataIndex: 'name',
      key: 'name',
      sorter: (a, b) => a.name.localeCompare(b.name),
      render: (text: string) => <Text style={{ color: '#F0F0F0', fontWeight: 500, fontSize: 15 }}>{text}</Text>,
    },
    {
      title: '描述',
      dataIndex: 'description',
      key: 'description',
      ellipsis: true,
      render: (text: string) => <Text style={{ color: '#B0B0B0', fontSize: 14 }}>{text || '暂无描述'}</Text>,
    },
    {
      title: '模式',
      dataIndex: 'mode',
      key: 'mode',
      width: 110,
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
      width: 180,
      render: (_, record) => (
        <Text style={{ color: '#787878', fontSize: 13 }}>
          {agentModels[record.name] || '—'}
        </Text>
      ),
    },
    {
      title: 'Tools 白名单',
      key: 'tools-whitelist',
      width: 130,
      render: (_, record) => {
        const count = agentWhitelistCounts[record.name];
        return (
          <Space size={4}>
            <ToolOutlined style={{ color: '#6B8EC4', fontSize: 12 }} />
            <Text style={{ color: '#787878', fontSize: 13 }}>
              {count === undefined ? '...' : count === 0 ? '全部' : `${count} 个`}
            </Text>
          </Space>
        );
      },
    },
    {
      title: 'Source',
      dataIndex: 'filePath',
      key: 'source',
      width: 90,
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
      width: 150,
      render: (_, record) => (
        <Space>
          <Button
            type="text"
            icon={<EyeOutlined />}
            onClick={() => handleView(record.name)}
            style={{ color: '#B0B0B0' }}
          />
          <Button
            type="text"
            icon={<EditOutlined />}
            onClick={() => handleEdit(record.name)}
            style={{ color: '#B0B0B0' }}
          />
          <Popconfirm
            title="Delete agent?"
            description={`Delete "${record.name}"?`}
            onConfirm={() => handleDelete(record.name)}
          >
            <Button type="text" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh' }}>
        <div style={{ textAlign: 'center' }}>
          <Spin size="large" />
          <div style={{ marginTop: 16, color: '#787878', fontSize: 14 }}>
            Loading...
          </div>
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
            onClick={fetchAgents}
            loading={loading}
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
          onClose={() => setError(null)}
          style={{ marginBottom: 24 }}
        />
      )}

      {/* Agents Table */}
      <Card className="card-spacious fade-in fade-in-2">
        <Table<AgentMeta>
          columns={columns}
          dataSource={agents}
          rowKey="name"
          loading={loading}
          pagination={{ pageSize: 15 }}
          size="middle"
        />
      </Card>

      {/* View Modal */}
      <Modal
        title={viewContent ? `查看：${viewContent.name}` : '查看 Agent'}
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
            <div style={{ marginBottom: 20, display: 'flex', gap: 24 }}>
              <div>
                <Text style={{ color: '#787878', fontSize: 13, display: 'block', marginBottom: 4 }}>描述</Text>
                <Text style={{ color: '#F0F0F0', fontSize: 15 }}>{viewContent.description || '暂无描述'}</Text>
              </div>
              <div>
                <Text style={{ color: '#787878', fontSize: 13, display: 'block', marginBottom: 4 }}>模式</Text>
                <Tag color={viewContent.mode === 'primary' ? 'blue' : 'default'}>
                  {viewContent.mode}
                </Tag>
              </div>
            </div>
            <div
              style={{
                height: 400,
                border: '1px solid rgba(255,255,255,0.06)',
                borderRadius: 10,
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
        footer={null}
        width={900}
        destroyOnClose
      >
        {editLoading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
            <Spin size="large" />
          </div>
        ) : editContent ? (
          <div>
            <Space direction="vertical" style={{ width: '100%', marginBottom: 20 }}>
              <div style={{ display: 'flex', gap: 20 }}>
                <div style={{ flex: 1 }}>
                  <Text style={{ color: '#787878', fontSize: 13, display: 'block', marginBottom: 6 }}>描述</Text>
                  <Input
                    value={editDescription}
                    onChange={(e) => setEditDescription(e.target.value)}
                    placeholder="Agent description"
                  />
                </div>
                <div style={{ width: 180 }}>
                  <Text style={{ color: '#787878', fontSize: 13, display: 'block', marginBottom: 6 }}>模式</Text>
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
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <ToolOutlined style={{ color: '#787878' }} />
                    <Text style={{ color: '#787878', fontSize: 13 }}>Tools 白名单</Text>
                    <Text style={{ color: '#525252', fontSize: 12 }}>（留空表示允许使用所有 tools）</Text>
                  </div>
                  <Space size={8}>
                    <Text style={{ color: '#525252', fontSize: 12 }}>
                      已选 {editWhitelist.length} / {availableTools.length}
                    </Text>
                    {editWhitelist.length > 0 && (
                      <Button size="small" danger onClick={() => setEditWhitelist([])}>
                        清空全部
                      </Button>
                    )}
                  </Space>
                </div>
                
                {/* Filters */}
                <div style={{ marginBottom: 8, display: 'flex', gap: 8 }}>
                  <Select
                    size="small"
                    value={toolFilterSource}
                    onChange={setToolFilterSource}
                    style={{ width: 120 }}
                    options={[
                      { label: '全部来源', value: 'all' },
                      { label: 'builtin', value: 'builtin' },
                      { label: 'MCP', value: 'mcp' },
                      { label: 'custom', value: 'custom' },
                    ]}
                  />
                  <Select
                    size="small"
                    value={toolFilterServer}
                    onChange={setToolFilterServer}
                    style={{ width: 200 }}
                    options={[
                      { label: '全部 MCP 服务器', value: 'all' },
                      ...[...new Set(availableTools.filter(t => t.mcpServer).map(t => t.mcpServer!))].map(server => ({
                        label: server,
                        value: server,
                      }))
                    ]}
                  />
                  <Select
                    size="small"
                    value={toolFilterCategory}
                    onChange={setToolFilterCategory}
                    style={{ width: 140 }}
                    options={[
                      { label: '全部分类', value: 'all' },
                      ...[...new Set(availableTools.map(t => t.category || '其他'))].sort().map(cat => ({
                        label: cat,
                        value: cat,
                      }))
                    ]}
                  />
                  <Button
                    size="small"
                    onClick={() => {
                      const filtered = availableTools.filter(t => {
                        if (toolFilterSource !== 'all' && t.source !== toolFilterSource) return false;
                        if (toolFilterServer !== 'all' && t.mcpServer !== toolFilterServer) return false;
                        if (toolFilterCategory !== 'all' && t.category !== toolFilterCategory) return false;
                        return true;
                      });
                      const keysToAdd = filtered.map(t => t.key);
                      setEditWhitelist([...new Set([...editWhitelist, ...keysToAdd])]);
                    }}
                  >
                    全选当前
                  </Button>
                </div>

                {whitelistLoading ? (
                  <Spin size="small" />
                ) : (
                  <div style={{ 
                    border: '1px solid rgba(255,255,255,0.1)', 
                    borderRadius: 6, 
                    padding: 12, 
                    maxHeight: 200, 
                    overflowY: 'auto',
                    background: 'rgba(0,0,0,0.2)'
                  }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                      {availableTools
                        .filter(t => {
                          if (toolFilterSource !== 'all' && t.source !== toolFilterSource) return false;
                          if (toolFilterServer !== 'all' && t.mcpServer !== toolFilterServer) return false;
                          if (toolFilterCategory !== 'all' && t.category !== toolFilterCategory) return false;
                          return true;
                        })
                        .map(tool => {
                          const isSelected = editWhitelist.includes(tool.key);
                          return (
                            <div 
                              key={tool.key} 
                              style={{ 
                                padding: '4px 10px',
                                borderRadius: 4,
                                border: '1px solid',
                                borderColor: isSelected ? '#6B8EC4' : 'rgba(255,255,255,0.15)',
                                background: isSelected ? 'rgba(107,142,196,0.2)' : 'transparent',
                                boxShadow: isSelected ? '0 0 8px rgba(107,142,196,0.4)' : 'none',
                                cursor: 'pointer',
                                transition: 'all 0.15s',
                                userSelect: 'none',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 4
                              }}
                              onClick={() => {
                                setEditWhitelist(isSelected 
                                  ? editWhitelist.filter(k => k !== tool.key) 
                                  : [...editWhitelist, tool.key]
                                );
                              }}
                            >
                              <span style={{ fontSize: 12, color: isSelected ? '#F0F0F0' : '#999' }}>
                                {tool.title}
                              </span>
                              <span style={{ 
                                fontSize: 9, 
                                color: '#666',
                                background: 'rgba(255,255,255,0.05)',
                                padding: '0 3px',
                                borderRadius: 2
                              }}>
                                {tool.category}
                              </span>
                            </div>
                          );
                        })}
                    </div>
                  </div>
                )}
              </div>
            </Space>
            
            {/* Action buttons */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginBottom: 16 }}>
              <Button onClick={() => setEditVisible(false)}>Cancel</Button>
              <Button
                type="primary"
                icon={<SaveOutlined />}
                onClick={handleSave}
                loading={saving}
              >
                Save
              </Button>
            </div>

            <div
              style={{
                height: 350,
                border: '1px solid rgba(255,255,255,0.06)',
                borderRadius: 10,
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
          <Form.Item
            name="mode"
            label="模式"
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
        title="Batch Set Model"
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
        width={480}
        destroyOnClose
      >
        <div style={{ marginBottom: 16 }}>
          <Text style={{ color: '#B0B0B0', fontSize: 15 }}>
            Set the same model for all agents. This will override individual settings.
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
        {Object.keys(agentModels).length > 0 && (
          <div style={{ marginTop: 16 }}>
            <Text style={{ color: '#F0F0F0', fontWeight: 500, fontSize: 14 }}>Current models:</Text>
            <div style={{ marginTop: 10, maxHeight: 200, overflowY: 'auto' }}>
              {Object.entries(agentModels).map(([name, model]) => (
                <div key={name} style={{ marginBottom: 6, display: 'flex', justifyContent: 'space-between' }}>
                  <Text style={{ color: '#F0F0F0', fontSize: 13 }}>{name}</Text>
                  <Text style={{ color: '#787878', fontSize: 13 }}>{model}</Text>
                </div>
              ))}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
