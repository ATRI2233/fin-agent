import { useEffect, useState, useCallback } from 'react';
import { Typography, Button, Space, Spin, Alert, message } from 'antd';
import { SaveOutlined, ReloadOutlined } from '@ant-design/icons';
import Editor from '@monaco-editor/react';

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
      const res = await fetch('/api/rules');
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = await res.json();
      setContent(data.content ?? '');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load rules';
      setError(msg);
      setContent('');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRules();
  }, [fetchRules]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/rules', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      message.success('Rules saved successfully');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to save rules';
      message.error(msg);
    } finally {
      setSaving(false);
    }
  };

  const handleEditorChange = (value: string | undefined) => {
    setContent(value ?? '');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 16,
          flexShrink: 0,
        }}
      >
        <div>
          <Title level={4} style={{ margin: 0 }}>
            Rules Editor
          </Title>
          <Text type="secondary">Edit AGENTS.md rules file</Text>
        </div>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={fetchRules} loading={loading}>
            Reload
          </Button>
          <Button type="primary" icon={<SaveOutlined />} onClick={handleSave} loading={saving}>
            Save
          </Button>
        </Space>
      </div>

      {error && (
        <Alert
          type="error"
          message="Failed to load rules"
          description={error}
          showIcon
          closable
          onClose={() => setError(null)}
          style={{ marginBottom: 16, flexShrink: 0 }}
        />
      )}

      <div
        style={{
          flex: 1,
          minHeight: 0,
          border: '1px solid #d9d9d9',
          borderRadius: 6,
          overflow: 'hidden',
        }}
      >
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
            <Spin size="large" />
          </div>
        ) : (
          <Editor
            height="100%"
            language="markdown"
            value={content}
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
        )}
      </div>
    </div>
  );
}
