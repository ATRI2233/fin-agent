import { useEffect, useState, useCallback } from 'react';
import { Typography, Select, Button, Space, Spin, Alert, message } from 'antd';
import { SaveOutlined, ReloadOutlined } from '@ant-design/icons';
import Editor from '@monaco-editor/react';

const { Title } = Typography;

type ConfigFile = 'opencode' | 'oh-my-openagent';
type ConfigScope = 'global' | 'project';

interface ConfigOption {
  label: string;
  value: ConfigFile;
  scope: ConfigScope[];
}

const CONFIG_OPTIONS: ConfigOption[] = [
  { label: 'opencode.json', value: 'opencode', scope: ['global', 'project'] },
  { label: 'oh-my-openagent.jsonc', value: 'oh-my-openagent', scope: ['global'] },
];

function buildApiPath(file: ConfigFile, scope: ConfigScope): string {
  if (file === 'opencode' && scope === 'project') {
    return '/api/config/opencode/project';
  }
  return `/api/config/${file}`;
}

export default function ConfigRawEditor() {
  const [file, setFile] = useState<ConfigFile>('opencode');
  const [scope, setScope] = useState<ConfigScope>('global');
  const [content, setContent] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currentOption = CONFIG_OPTIONS.find((opt) => opt.value === file);
  const availableScopes = currentOption?.scope ?? ['global'];

  const fetchConfig = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const apiPath = buildApiPath(file, scope);
      const res = await fetch(apiPath);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = await res.json();
      setContent(JSON.stringify(data, null, 2));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load config';
      setError(msg);
      setContent('');
    } finally {
      setLoading(false);
    }
  }, [file, scope]);

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  // Reset scope to global if current scope is not available for selected file
  useEffect(() => {
    if (!availableScopes.includes(scope)) {
      setScope('global');
    }
  }, [availableScopes, scope]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const parsed = JSON.parse(content);
      const apiPath = buildApiPath(file, scope);
      const res = await fetch(apiPath, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed),
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      message.success('Configuration saved successfully');
    } catch (err: unknown) {
      if (err instanceof SyntaxError) {
        message.error('Invalid JSON: please check your syntax');
      } else {
        const msg = err instanceof Error ? err.message : 'Failed to save';
        message.error(msg);
      }
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
        <Title level={4} style={{ margin: 0 }}>
          Config Editor
        </Title>
        <Space>
          <Select<ConfigFile>
            value={file}
            onChange={setFile}
            options={CONFIG_OPTIONS.map((opt) => ({
              label: opt.label,
              value: opt.value,
            }))}
            style={{ width: 200 }}
          />
          {availableScopes.length > 1 && (
            <Select<ConfigScope>
              value={scope}
              onChange={setScope}
              options={availableScopes.map((s) => ({
                label: s === 'global' ? 'Global' : 'Project',
                value: s,
              }))}
              style={{ width: 120 }}
            />
          )}
          <Button icon={<ReloadOutlined />} onClick={fetchConfig} loading={loading}>
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
          message="Failed to load configuration"
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
            language="json"
            value={content}
            onChange={handleEditorChange}
            options={{
              minimap: { enabled: false },
              fontSize: 14,
              lineNumbers: 'on',
              scrollBeyondLastLine: false,
              wordWrap: 'on',
              formatOnPaste: true,
              tabSize: 2,
            }}
            theme="vs-dark"
          />
        )}
      </div>
    </div>
  );
}
