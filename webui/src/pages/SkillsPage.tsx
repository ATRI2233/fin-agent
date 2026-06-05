import { useEffect, useState, useCallback } from 'react';
import {
  Typography,
  Button,
  Space,
  Modal,
  Spin,
  Alert,
  Segmented,
  Switch,
  Popconfirm,
  message,
  Row,
  Col,
  Card,
} from 'antd';
import {
  EyeOutlined,
  EditOutlined,
  DeleteOutlined,
  SwapOutlined,
  ReloadOutlined,
  SaveOutlined,
  ThunderboltOutlined,
  GlobalOutlined,
  FolderOutlined,
} from '@ant-design/icons';
import Editor from '@monaco-editor/react';

const { Text, Paragraph } = Typography;

type Scope = 'global' | 'project';

interface SkillMeta {
  name: string;
  description: string;
  filePath: string;
  enabled: boolean;
}

interface SkillContent {
  name: string;
  content: string;
  description: string;
}

export default function SkillsPage() {
  const [skills, setSkills] = useState<SkillMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scope, setScope] = useState<Scope>('global');

  const [viewVisible, setViewVisible] = useState(false);
  const [viewContent, setViewContent] = useState<SkillContent | null>(null);
  const [viewLoading, setViewLoading] = useState(false);

  const [editVisible, setEditVisible] = useState(false);
  const [editContent, setEditContent] = useState<SkillContent | null>(null);
  const [editLoading, setEditLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch('/api/config/scope')
      .then((res) => res.json())
      .then((data) => {
        if (data.skills) setScope(data.skills);
      })
      .catch(() => {});
  }, []);

  const fetchSkills = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/skills?scope=${scope}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setSkills(data.skills ?? []);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '加载技能失败';
      setError(msg);
      setSkills([]);
    } finally {
      setLoading(false);
    }
  }, [scope]);

  useEffect(() => { fetchSkills(); }, [fetchSkills]);

  const handleScopeChange = async (newScope: Scope) => {
    setScope(newScope);
    try {
      await fetch('/api/config/scope', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skills: newScope }),
      });
    } catch {}
  };

  const handleView = async (name: string) => {
    setViewVisible(true);
    setViewLoading(true);
    setViewContent(null);
    try {
      const res = await fetch(`/api/skills/${name}/content?scope=${scope}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setViewContent(await res.json());
    } catch (err: unknown) {
      message.error(err instanceof Error ? err.message : '加载失败');
      setViewVisible(false);
    } finally { setViewLoading(false); }
  };

  const handleEdit = async (name: string) => {
    setEditVisible(true);
    setEditLoading(true);
    setEditContent(null);
    try {
      const res = await fetch(`/api/skills/${name}/content?scope=${scope}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setEditContent(await res.json());
    } catch (err: unknown) {
      message.error(err instanceof Error ? err.message : '加载失败');
      setEditVisible(false);
    } finally { setEditLoading(false); }
  };

  const handleSave = async () => {
    if (!editContent) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/skills/${editContent.name}/content?scope=${scope}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: editContent.content }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      message.success('技能已保存');
      setEditVisible(false);
    } catch (err: unknown) {
      message.error(err instanceof Error ? err.message : '保存失败');
    } finally { setSaving(false); }
  };

  const handleDelete = async (name: string) => {
    try {
      const res = await fetch(`/api/skills/${name}?scope=${scope}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      message.success(`技能 ${name} 已删除`);
      fetchSkills();
    } catch (err: unknown) { message.error(err instanceof Error ? err.message : '操作失败'); }
  };

  const handleMove = async (name: string) => {
    try {
      const res = await fetch(`/api/skills/${name}/move`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: scope }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      message.success(`已移至 ${data.to}`);
      fetchSkills();
    } catch (err: unknown) { message.error(err instanceof Error ? err.message : '操作失败'); }
  };

  const handleToggle = async (name: string) => {
    try {
      const res = await fetch(`/api/skills/${name}/toggle?scope=${scope}`, { method: 'POST' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setSkills((prev) => prev.map((s) => (s.name === name ? { ...s, enabled: data.enabled } : s)));
      message.success(`${name} ${data.enabled ? '已启用' : '已禁用'}`);
    } catch (err: unknown) { message.error(err instanceof Error ? err.message : '操作失败'); }
  };

  if (loading) return <div style={{ display: 'flex', justifyContent: 'center', padding: 80 }}><Spin size="large" /></div>;
  if (error) return <Alert type="error" message="加载技能失败" description={error} showIcon closable onClose={() => setError(null)} />;

  return (
    <div className="page-container fade-in">
      {/* Hero Header */}
      <div style={{ marginBottom: 40, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div className="page-hero" style={{ marginBottom: 0 }}>
          <h1 className="page-hero-title">技能</h1>
          <p className="page-hero-subtitle">管理技能配置和提示词</p>
        </div>
        <Space size={12}>
          <Segmented value={scope} onChange={(v) => handleScopeChange(v as Scope)} options={[
            { label: <Space><GlobalOutlined />全局</Space>, value: 'global' },
            { label: <Space><FolderOutlined />项目</Space>, value: 'project' },
          ]} />
          <Button icon={<ReloadOutlined />} onClick={fetchSkills} loading={loading} size="large">刷新</Button>
        </Space>
      </div>

      {skills.length === 0 ? (
        <Card className="card-spacious"><Text type="secondary" style={{ fontSize: 15 }}>暂无技能配置</Text></Card>
      ) : (
        <Row gutter={[24, 24]}>
          {skills.map((skill) => (
            <Col xs={24} sm={12} lg={8} xl={6} key={skill.name}>
              <Card hoverable style={{ height: '100%' }} className="card-spacious" styles={{ body: { display: 'flex', flexDirection: 'column', height: '100%', padding: 28 } }}>
                <div style={{ flex: 1, marginBottom: 20 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 10 }}>
                    <Space size={10}>
                      <ThunderboltOutlined style={{ color: '#5A9E7B', fontSize: 16 }} />
                      <Text strong style={{ fontSize: 16 }}>{skill.name}</Text>
                    </Space>
                    <Switch checked={skill.enabled} onChange={() => handleToggle(skill.name)} size="small" />
                  </div>
                  <Paragraph type="secondary" ellipsis={{ rows: 3 }} style={{ marginBottom: 0, fontSize: 14 }}>
                    {skill.description || '暂无描述'}
                  </Paragraph>
                </div>
                <Space wrap size={12}>
                  <Button type="link" icon={<EyeOutlined />} onClick={() => handleView(skill.name)} style={{ padding: 0, fontSize: 14 }}>查看</Button>
                  <Button type="link" icon={<EditOutlined />} onClick={() => handleEdit(skill.name)} style={{ padding: 0, fontSize: 14 }}>编辑</Button>
                  <Popconfirm title={`移至${scope === 'global' ? '项目' : '全局'}？`} onConfirm={() => handleMove(skill.name)} okText="移动" cancelText="取消">
                    <Button type="link" icon={<SwapOutlined />} style={{ padding: 0, fontSize: 14 }}>{scope === 'global' ? '移至项目' : '移至全局'}</Button>
                  </Popconfirm>
                  <Popconfirm title={`删除 ${skill.name}？`} onConfirm={() => handleDelete(skill.name)} okText="删除" cancelText="取消">
                    <Button type="link" danger icon={<DeleteOutlined />} style={{ padding: 0, fontSize: 14 }}>删除</Button>
                  </Popconfirm>
                </Space>
              </Card>
            </Col>
          ))}
        </Row>
      )}

      <Modal title={viewContent ? `查看: ${viewContent.name}` : '查看技能'} open={viewVisible} onCancel={() => setViewVisible(false)} footer={null} width={800} destroyOnClose>
        {viewLoading ? <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}><Spin size="large" /></div> : viewContent ? (
          <div>
            <div style={{ marginBottom: 20 }}><Text strong style={{ fontSize: 15 }}>描述: </Text><Text style={{ fontSize: 15 }}>{viewContent.description || '暂无描述'}</Text></div>
            <div style={{ height: 400, border: '1px solid rgba(255,255,255,0.06)', borderRadius: 10, overflow: 'hidden' }}>
              <Editor height="100%" language="markdown" value={viewContent.content} options={{ readOnly: true, minimap: { enabled: false }, fontSize: 14, lineNumbers: 'on', scrollBeyondLastLine: false, wordWrap: 'on' }} theme="vs-dark" />
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal title={editContent ? `编辑: ${editContent.name}` : '编辑技能'} open={editVisible} onCancel={() => setEditVisible(false)} footer={<Space><Button onClick={() => setEditVisible(false)}>取消</Button><Button type="primary" icon={<SaveOutlined />} onClick={handleSave} loading={saving}>保存</Button></Space>} width={800} destroyOnClose>
        {editLoading ? <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}><Spin size="large" /></div> : editContent ? (
          <div>
            <div style={{ marginBottom: 20 }}><Text strong style={{ fontSize: 15 }}>描述: </Text><Text style={{ fontSize: 15 }}>{editContent.description || '暂无描述'}</Text></div>
            <div style={{ height: 400, border: '1px solid rgba(255,255,255,0.06)', borderRadius: 10, overflow: 'hidden' }}>
              <Editor height="100%" language="markdown" value={editContent.content} onChange={(v) => setEditContent({ ...editContent, content: v ?? '' })} options={{ minimap: { enabled: false }, fontSize: 14, lineNumbers: 'on', scrollBeyondLastLine: false, wordWrap: 'on', tabSize: 2 }} theme="vs-dark" />
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
