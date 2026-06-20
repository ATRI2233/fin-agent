import { useEffect, useRef, useState } from 'react';
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
import {
  useOpencodeConfigScope,
  useOpencodeSkills,
  useOpencodeSkillContent,
  useUpdateOpencodeSkillContent,
  useDeleteOpencodeSkill,
  useMoveOpencodeSkill,
  useToggleOpencodeSkill,
  useSetOpencodeConfigScope,
} from '../hooks/useOpencode';

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
  const [scope, setScope] = useState<Scope>('global');

  const [viewVisible, setViewVisible] = useState(false);
  const [viewContent, setViewContent] = useState<SkillContent | null>(null);
  const [viewName, setViewName] = useState<string | undefined>(undefined);

  const [editVisible, setEditVisible] = useState(false);
  const [editContent, setEditContent] = useState<SkillContent | null>(null);
  const [editName, setEditName] = useState<string | undefined>(undefined);
  const [saving, setSaving] = useState(false);

  // Fetch config scope on mount to seed `scope` state
  const { data: scopeData } = useOpencodeConfigScope();
  const scopeInitialized = useRef(false);
  useEffect(() => {
    if (!scopeInitialized.current && scopeData?.skills && (scopeData.skills === 'global' || scopeData.skills === 'project')) {
      setScope(scopeData.skills);
      scopeInitialized.current = true;
    }
  }, [scopeData]);

  // Fetch skills list for the current scope
  const {
    data: skillsData,
    isLoading: skillsLoading,
    error: skillsError,
    refetch: refetchSkills,
  } = useOpencodeSkills<SkillMeta>(scope);
  const skills = skillsData?.skills ?? [];

  // View modal content fetch
  const {
    data: viewData,
    isLoading: viewLoading,
    refetch: refetchView,
  } = useOpencodeSkillContent<SkillContent>(viewName, scope);
  const viewVersion = useRef(0);
  useEffect(() => {
    if (viewData && viewVisible) {
      setViewContent(viewData);
    }
    // viewVersion check not strictly needed here since react-query
    // cancels in-flight requests for the same key; the version ref
    // is an extra safety net.
  }, [viewData, viewVisible]);

  // Edit modal content fetch
  const {
    data: editData,
    isLoading: editLoading,
    refetch: refetchEdit,
  } = useOpencodeSkillContent<SkillContent>(editName, scope);
  useEffect(() => {
    if (editData && editVisible) {
      setEditContent(editData);
    }
  }, [editData, editVisible]);

  // Mutations
  const setScopeMutation = useSetOpencodeConfigScope();
  const updateContentMutation = useUpdateOpencodeSkillContent();
  const deleteSkillMutation = useDeleteOpencodeSkill();
  const moveSkillMutation = useMoveOpencodeSkill();
  const toggleSkillMutation = useToggleOpencodeSkill();

  const handleScopeChange = (newScope: Scope) => {
    setScope(newScope);
    setScopeMutation.mutate({ skills: newScope });
  };

  const handleView = (name: string) => {
    setViewVisible(true);
    setViewContent(null);
    setViewName(name);
    viewVersion.current += 1;
    refetchView();
  };

  const handleEdit = (name: string) => {
    setEditVisible(true);
    setEditContent(null);
    setEditName(name);
    refetchEdit();
  };

  const handleSave = () => {
    if (!editContent) return;
    setSaving(true);
    updateContentMutation.mutate(
      { name: editContent.name, scope, content: editContent.content },
      {
        onSuccess: () => {
          message.success('技能已保存');
          setEditVisible(false);
        },
        onError: (err: unknown) => {
          message.error(err instanceof Error ? err.message : '保存失败');
        },
        onSettled: () => setSaving(false),
      },
    );
  };

  const handleDelete = (name: string) => {
    deleteSkillMutation.mutate(
      { name, scope },
      {
        onSuccess: () => {
          message.success(`技能 ${name} 已删除`);
          refetchSkills();
        },
        onError: (err: unknown) => {
          message.error(err instanceof Error ? err.message : '操作失败');
        },
      },
    );
  };

  const handleMove = (name: string) => {
    moveSkillMutation.mutate(
      { name, from: scope },
      {
        onSuccess: (data) => {
          message.success(`已移至 ${data.to}`);
          refetchSkills();
        },
        onError: (err: unknown) => {
          message.error(err instanceof Error ? err.message : '操作失败');
        },
      },
    );
  };

  const handleToggle = (name: string) => {
    toggleSkillMutation.mutate(
      { name, scope },
      {
        onSuccess: (data) => {
          message.success(`${name} ${data.enabled ? '已启用' : '已禁用'}`);
          refetchSkills();
        },
        onError: (err: unknown) => {
          message.error(err instanceof Error ? err.message : '操作失败');
        },
      },
    );
  };

  const errorMessage = skillsError
    ? skillsError instanceof Error
      ? skillsError.message
      : '加载技能失败'
    : null;

  if (skillsLoading) return <div style={{ display: 'flex', justifyContent: 'center', padding: 80 }}><Spin size="large" /></div>;
  if (errorMessage) return <Alert type="error" message="加载技能失败" description={errorMessage} showIcon closable />;

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
          <Button icon={<ReloadOutlined />} onClick={() => refetchSkills()} loading={skillsLoading} size="large">刷新</Button>
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

      <Modal title={viewContent ? `查看: ${viewContent.name}` : '查看技能'} open={viewVisible} onCancel={() => { setViewVisible(false); setViewName(undefined); }} footer={null} width={800} destroyOnClose>
        {viewLoading ? <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}><Spin size="large" /></div> : viewContent ? (
          <div>
            <div style={{ marginBottom: 20 }}><Text strong style={{ fontSize: 15 }}>描述: </Text><Text style={{ fontSize: 15 }}>{viewContent.description || '暂无描述'}</Text></div>
            <div style={{ height: 400, border: '1px solid rgba(255,255,255,0.06)', borderRadius: 10, overflow: 'hidden' }}>
              <Editor height="100%" language="markdown" value={viewContent.content} options={{ readOnly: true, minimap: { enabled: false }, fontSize: 14, lineNumbers: 'on', scrollBeyondLastLine: false, wordWrap: 'on' }} theme="vs-dark" />
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal title={editContent ? `编辑: ${editContent.name}` : '编辑技能'} open={editVisible} onCancel={() => { setEditVisible(false); setEditName(undefined); }} footer={<Space><Button onClick={() => { setEditVisible(false); setEditName(undefined); }}>取消</Button><Button type="primary" icon={<SaveOutlined />} onClick={handleSave} loading={saving}>保存</Button></Space>} width={800} destroyOnClose>
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