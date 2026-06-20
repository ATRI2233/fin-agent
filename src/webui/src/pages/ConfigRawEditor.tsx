import { useEffect, useState, useRef } from 'react';
import { Typography, Select, Button, Space, Spin, Alert, message } from 'antd';
import { SaveOutlined, ReloadOutlined } from '@ant-design/icons';
import Editor from '@monaco-editor/react';
import { useOpencodeConfigRaw, useUpdateOpencodeConfigRaw } from '../hooks/useOpencode';

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

export default function ConfigRawEditor() {
  const [file, setFile] = useState<ConfigFile>('opencode');
  const [scope, setScope] = useState<ConfigScope>('global');
  const [content, setContent] = useState<string>('');

  const { data, isLoading, error: queryError, refetch } = useOpencodeConfigRaw(file, scope);
  const updateRaw = useUpdateOpencodeConfigRaw();

  const currentOption = CONFIG_OPTIONS.find((opt) => opt.value === file);
  const availableScopes = currentOption?.scope ?? ['global'];

  const lastSyncKeyRef = useRef<string>('');
  useEffect(() => {
    const key = `${file}:${scope}`;
    if (data !== undefined && lastSyncKeyRef.current !== key) {
      setContent(JSON.stringify(data, null, 2));
      lastSyncKeyRef.current = key;
    }
  }, [data, file, scope]);

  useEffect(() => { if (!availableScopes.includes(scope)) setScope('global'); }, [availableScopes, scope]);

  const handleSave = () => {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(content);
    } catch (err) {
      if (err instanceof SyntaxError) message.error('无效的 JSON');
      else message.error(err instanceof Error ? err.message : '无效的 JSON');
      return;
    }
    updateRaw.mutate(
      { file, scope, data: parsed },
      {
        onSuccess: () => message.success('配置已保存'),
        onError: (err) => message.error(err instanceof Error ? err.message : '保存失败'),
      },
    );
  };

  const error = queryError instanceof Error ? queryError.message : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }} className="fade-in">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexShrink: 0 }}>
        <Title level={4} style={{ margin: 0 }}>配置编辑器</Title>
        <Space>
          <Select<ConfigFile> value={file} onChange={setFile} options={CONFIG_OPTIONS.map((o) => ({ label: o.label, value: o.value }))} style={{ width: 200 }} />
          {availableScopes.length > 1 && (
            <Select<ConfigScope> value={scope} onChange={setScope} options={availableScopes.map((s) => ({ label: s === 'global' ? '全局' : '项目', value: s }))} style={{ width: 120 }} />
          )}
          <Button icon={<ReloadOutlined />} onClick={() => refetch()} loading={isLoading}>刷新</Button>
          <Button type="primary" icon={<SaveOutlined />} onClick={handleSave} loading={updateRaw.isPending}>保存</Button>
        </Space>
      </div>
      {error && <Alert type="error" message="加载配置失败" description={error} showIcon closable onClose={() => {}} style={{ marginBottom: 16, flexShrink: 0 }} />}
      <div style={{ flex: 1, minHeight: 0, border: '1px solid rgba(255,255,255,0.06)', borderRadius: 10, overflow: 'hidden' }}>
        {isLoading ? (
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}><Spin size="large" /></div>
        ) : (
          <Editor height="100%" language="json" value={content} onChange={(v) => setContent(v ?? '')} options={{ minimap: { enabled: false }, fontSize: 14, lineNumbers: 'on', scrollBeyondLastLine: false, wordWrap: 'on', formatOnPaste: true, tabSize: 2 }} theme="vs-dark" />
        )}
      </div>
    </div>
  );
}