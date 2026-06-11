import { useEffect, useState, useCallback } from 'react';
import { Typography, Button, Space, Spin, Alert, message } from 'antd';
import { SaveOutlined, ReloadOutlined } from '@ant-design/icons';
import Editor from '@monaco-editor/react';
import { opencodeGet, opencodePut } from '../api/opencode';

const { Title, Text } = Typography;

export default function RulesEditor() {
  const [content, setContent] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchRules = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await opencodeGet<{ content?: string }>('/rules');
      setContent(data.content ?? '');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '加载规则失败');
      setContent('');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchRules(); }, [fetchRules]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await opencodePut('/rules', { content });
      message.success('规则已保存');
    } catch (err: unknown) {
      message.error(err instanceof Error ? err.message : '保存失败');
    } finally { setSaving(false); }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }} className="fade-in">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexShrink: 0 }}>
        <div>
          <Title level={4} style={{ margin: 0 }}>规则编辑器</Title>
          <Text type="secondary">编辑 AGENTS.md 规则文件</Text>
        </div>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={fetchRules} loading={loading}>刷新</Button>
          <Button type="primary" icon={<SaveOutlined />} onClick={handleSave} loading={saving}>保存</Button>
        </Space>
      </div>
      {error && <Alert type="error" message="加载规则失败" description={error} showIcon closable onClose={() => setError(null)} style={{ marginBottom: 16, flexShrink: 0 }} />}
      <div style={{ flex: 1, minHeight: 0, border: '1px solid rgba(255,255,255,0.06)', borderRadius: 10, overflow: 'hidden' }}>
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}><Spin size="large" /></div>
        ) : (
          <Editor height="100%" language="markdown" value={content} onChange={(v) => setContent(v ?? '')} options={{ minimap: { enabled: false }, fontSize: 14, lineNumbers: 'on', scrollBeyondLastLine: false, wordWrap: 'on', tabSize: 2 }} theme="vs-dark" />
        )}
      </div>
    </div>
  );
}
