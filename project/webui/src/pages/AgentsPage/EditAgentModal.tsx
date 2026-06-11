/**
 * EditAgentModal — Monaco-driven editor for an agent's system prompt
 * plus its tools-whitelist selector.
 *
 * Extracted from the monolithic `AgentsPage.tsx` during Wave 6.2a. The
 * modal owns its own loading / form / filter state and refetches on
 * `agentName` change so the orchestrator stays declarative.
 *
 * The available-tool catalogue is sourced from the local
 * `useAgentTools` hook (Wave 6.2b) so the page-level hook owns the
 * fetch lifecycle; the modal just consumes the result. The
 * per-agent whitelist is fetched imperatively via the same hook.
 *
 * @see ./ViewAgentModal    for the read-only counterpart.
 * @see ./hooks/useAgentTools for the tool catalogue + whitelist fetcher.
 */

import { useEffect, useState } from 'react';
import { Modal, Spin, Button, Input, Select, Space, Typography, message } from 'antd';
import { SaveOutlined, ToolOutlined } from '@ant-design/icons';
import Editor from '@monaco-editor/react';
import { opencodeGet, opencodePut } from '../../api/opencode';
import { useAgentTools, type AgentToolItem } from './hooks/useAgentTools';

const { Text } = Typography;

/** Subset of `/agents/{name}/content` that the proxy returns. */
interface AgentContent {
  name: string;
  content: string;
  description: string;
  mode: string;
}

export interface EditAgentModalProps {
  /** Controls modal visibility; the modal resets state on close. */
  visible: boolean;
  /** Called when the user dismisses or successfully saves. */
  onClose: () => void;
  /** Registry name of the agent to edit, or `null` while hidden. */
  agentName: string | null;
}

export default function EditAgentModal({ visible, onClose, agentName }: EditAgentModalProps) {
  // Content + form fields
  const [content, setContent] = useState<AgentContent | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [description, setDescription] = useState('');
  const [mode, setMode] = useState('subagent');

  // Tools whitelist + filters. The catalogue auto-fetches on mount via
  // `useAgentTools`; we just consume the result.
  const { availableTools, fetchToolsWhitelist } = useAgentTools();
  const [whitelist, setWhitelist] = useState<string[]>([]);
  const [whitelistLoading, setWhitelistLoading] = useState(false);
  const [toolFilterSource, setToolFilterSource] = useState<string>('all');
  const [toolFilterServer, setToolFilterServer] = useState<string>('all');
  const [toolFilterCategory, setToolFilterCategory] = useState<string>('all');

  // Load agent content + whitelist on `agentName` change.
  useEffect(() => {
    if (!agentName) {
      setContent(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setContent(null);
    setWhitelist([]);
    setToolFilterSource('all');
    setToolFilterServer('all');
    setToolFilterCategory('all');

    (async () => {
      try {
        const data = await opencodeGet<AgentContent>(
          `/agents/${encodeURIComponent(agentName)}/content`,
        );
        if (cancelled) return;
        setContent(data);
        setDescription(data.description || '');
        setMode(data.mode || 'subagent');
      } catch (err: unknown) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : 'Failed to load agent content';
        message.error(msg);
        onClose();
        setLoading(false);
        return;
      }

      setWhitelistLoading(true);
      try {
        const list = await fetchToolsWhitelist(agentName);
        if (!cancelled) setWhitelist(list);
      } finally {
        if (!cancelled) setWhitelistLoading(false);
      }

      if (!cancelled) setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [agentName, fetchToolsWhitelist, onClose]);

  const handleEditorChange = (value: string | undefined) => {
    if (content) {
      setContent({ ...content, content: value ?? '' });
    }
  };

  const handleSave = async () => {
    if (!content) return;
    setSaving(true);
    try {
      // Splice the description + mode back into the YAML frontmatter so
      // a save round-trips the editable fields without forcing the user
      // to hand-edit the markdown.
      let next = content.content;
      const fmMatch = next.match(/^---[\r]?\n[\s\S]*?[\r]?\n---/);
      if (fmMatch) {
        let fm = fmMatch[0];
        fm = fm.replace(/^(description:).*/m, `$1 ${description}`);
        fm = fm.replace(/^(mode:).*/m, `$1 ${mode}`);
        next = next.replace(/^---[\r]?\n[\s\S]*?[\r]?\n---/, fm);
      } else {
        next = `---\ndescription: ${description}\nmode: ${mode}\n---\n${next}`;
      }

      await opencodePut(
        `/agents/${encodeURIComponent(content.name)}/content`,
        { content: next },
      );
      await opencodePut(
        `/agents/${encodeURIComponent(content.name)}/tools-whitelist`,
        { tools_whitelist: whitelist },
      );

      message.success('Agent saved');
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to save agent';
      message.error(msg);
    } finally {
      setSaving(false);
    }
  };

  const matchesFilters = (tool: AgentToolItem): boolean => {
    if (toolFilterSource !== 'all' && tool.source !== toolFilterSource) return false;
    if (toolFilterServer !== 'all' && tool.mcpServer !== toolFilterServer) return false;
    if (toolFilterCategory !== 'all' && tool.category !== toolFilterCategory) return false;
    return true;
  };

  const handleSelectAllFiltered = () => {
    const keys = availableTools.filter(matchesFilters).map((t) => t.key);
    setWhitelist([...new Set([...whitelist, ...keys])]);
  };

  return (
    <Modal
      title={content ? `Edit: ${content.name}` : 'Edit Agent'}
      open={visible}
      onCancel={onClose}
      footer={null}
      width={900}
      destroyOnClose
    >
      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
          <Spin size="large" />
        </div>
      ) : content ? (
        <div>
          <Space direction="vertical" style={{ width: '100%', marginBottom: 20 }}>
            <div style={{ display: 'flex', gap: 20 }}>
              <div style={{ flex: 1 }}>
                <Text style={{ color: '#787878', fontSize: 13, display: 'block', marginBottom: 6 }}>描述</Text>
                <Input
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Agent description"
                />
              </div>
              <div style={{ width: 180 }}>
                <Text style={{ color: '#787878', fontSize: 13, display: 'block', marginBottom: 6 }}>模式</Text>
                <Select
                  value={mode}
                  onChange={(val) => setMode(val)}
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
                    已选 {whitelist.length} / {availableTools.length}
                  </Text>
                  {whitelist.length > 0 && (
                    <Button size="small" danger onClick={() => setWhitelist([])}>
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
                    ...[...new Set(availableTools.filter((t) => t.mcpServer).map((t) => t.mcpServer as string))].map((server) => ({
                      label: server,
                      value: server,
                    })),
                  ]}
                />
                <Select
                  size="small"
                  value={toolFilterCategory}
                  onChange={setToolFilterCategory}
                  style={{ width: 140 }}
                  options={[
                    { label: '全部分类', value: 'all' },
                    ...[...new Set(availableTools.map((t) => t.category || '其他'))].sort().map((cat) => ({
                      label: cat,
                      value: cat,
                    })),
                  ]}
                />
                <Button size="small" onClick={handleSelectAllFiltered}>
                  全选当前
                </Button>
              </div>

              {whitelistLoading ? (
                <Spin size="small" />
              ) : (
                <div
                  style={{
                    border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: 6,
                    padding: 12,
                    maxHeight: 200,
                    overflowY: 'auto',
                    background: 'rgba(0,0,0,0.2)',
                  }}
                >
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {availableTools.filter(matchesFilters).map((tool) => {
                      const isSelected = whitelist.includes(tool.key);
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
                            gap: 4,
                          }}
                          onClick={() => {
                            setWhitelist(
                              isSelected
                                ? whitelist.filter((k) => k !== tool.key)
                                : [...whitelist, tool.key],
                            );
                          }}
                        >
                          <span style={{ fontSize: 12, color: isSelected ? '#F0F0F0' : '#999' }}>
                            {tool.title}
                          </span>
                          <span
                            style={{
                              fontSize: 9,
                              color: '#666',
                              background: 'rgba(255,255,255,0.05)',
                              padding: '0 3px',
                              borderRadius: 2,
                            }}
                          >
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
            <Button onClick={onClose}>Cancel</Button>
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
              value={content.content}
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
  );
}
