import { useEffect, useState } from 'react';
import { Typography, Button, Space, Spin, Alert, message } from 'antd';
import { SaveOutlined, ReloadOutlined } from '@ant-design/icons';
import Editor from '@monaco-editor/react';
import { useOpencodeRules, useUpdateOpencodeRules } from '../hooks/useOpencode';

const { Title, Text } = Typography;

export default function RulesEditor() {
  const [content, setContent] = useState<string>('');
  const { data, isLoading, error: queryError, refetch } = useOpencodeRules();
  const { mutateAsync: saveRules, isPending: saving } = useUpdateOpencodeRules();

  useEffect(() => {
    if (data?.content !== undefined) setContent(data.content);
  }, [data?.content]);

  const error = queryError instanceof Error ? queryError.message : queryError ? '加载规则失败' : null;

  const handleSave = async () => {
    try {
      await saveRules(content);
      message.success('规则已保存');
    } catch (err: unknown) {
      message.error(err instanceof Error ? err.message : '保存失败');
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }} className="fade-in">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexShrink: 0 }}>
        <div>
          <Title level={4} style={{ margin: 0 }}>规则编辑器</Title>
          <Text type="secondary">编辑 AGENTS.md 规则文件</Text>
        </div>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={() => refetch()} loading={isLoading}>刷新</Button>
          <Button type="primary" icon={<SaveOutlined />} onClick={handleSave} loading={saving}>保存</Button>
        </Space>
      </div>
      {error && <Alert type="error" message="加载规则失败" description={error} showIcon closable onClose={() => refetch()} style={{ marginBottom: 16, flexShrink: 0 }} />}
      <div style={{ flex: 1, minHeight: 0, border: '1px solid rgba(255,255,255,0.06)', borderRadius: 10, overflow: 'hidden' }}>
        {isLoading ? (
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}><Spin size="large" /></div>
        ) : (
          <Editor height="100%" language="markdown" value={content} onChange={(v) => setContent(v ?? '')} options={{ minimap: { enabled: false }, fontSize: 14, lineNumbers: 'on', scrollBeyondLastLine: false, wordWrap: 'on', tabSize: 2 }} theme="vs-dark" />
        )}
      </div>
    </div>
  );
}
