import { useEffect, useState, useCallback } from 'react';
import {
  Typography,
  Button,
  Space,
  Modal,
  Spin,
  Alert,
  message,
  Row,
  Col,
  Card,
} from 'antd';
import {
  EyeOutlined,
  EditOutlined,
  ReloadOutlined,
  SaveOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import Editor from '@monaco-editor/react';

const { Title, Text, Paragraph } = Typography;

interface SkillMeta {
  name: string;
  description: string;
  filePath: string;
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

  // View modal state
  const [viewVisible, setViewVisible] = useState(false);
  const [viewContent, setViewContent] = useState<SkillContent | null>(null);
  const [viewLoading, setViewLoading] = useState(false);

  // Edit modal state
  const [editVisible, setEditVisible] = useState(false);
  const [editContent, setEditContent] = useState<SkillContent | null>(null);
  const [editLoading, setEditLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const fetchSkills = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/skills');
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = await res.json();
      setSkills(data.skills ?? []);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load skills';
      setError(msg);
      setSkills([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSkills();
  }, [fetchSkills]);

  const handleView = async (name: string) => {
    setViewVisible(true);
    setViewLoading(true);
    setViewContent(null);
    try {
      const res = await fetch(`/api/skills/${name}/content`);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data: SkillContent = await res.json();
      setViewContent(data);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load skill content';
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
      const res = await fetch(`/api/skills/${name}/content`);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data: SkillContent = await res.json();
      setEditContent(data);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load skill content';
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
      const res = await fetch(`/api/skills/${editContent.name}/content`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: editContent.content }),
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      message.success('Skill content saved successfully');
      setEditVisible(false);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to save skill content';
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

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 80 }}>
        <Spin size="large" />
      </div>
    );
  }

  if (error) {
    return (
      <Alert
        type="error"
        message="Failed to load skills"
        description={error}
        showIcon
        closable
        onClose={() => setError(null)}
      />
    );
  }

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
            Skills
          </Title>
          <Text type="secondary">Manage skill configurations and prompts</Text>
        </div>
        <Button icon={<ReloadOutlined />} onClick={fetchSkills} loading={loading}>
          Reload
        </Button>
      </div>

      {skills.length === 0 ? (
        <Card>
          <Text type="secondary">No skills configured</Text>
        </Card>
      ) : (
        <Row gutter={[16, 16]}>
          {skills.map((skill) => (
            <Col xs={24} sm={12} lg={8} xl={6} key={skill.name}>
              <Card
                hoverable
                style={{ height: '100%' }}
                styles={{
                  body: {
                    display: 'flex',
                    flexDirection: 'column',
                    height: '100%',
                  },
                }}
              >
                <div style={{ flex: 1, marginBottom: 16 }}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      marginBottom: 8,
                    }}
                  >
                    <ThunderboltOutlined style={{ color: '#52c41a' }} />
                    <Text strong style={{ fontSize: 16 }}>
                      {skill.name}
                    </Text>
                  </div>
                  <Paragraph
                    type="secondary"
                    ellipsis={{ rows: 3 }}
                    style={{ marginBottom: 0 }}
                  >
                    {skill.description || 'No description'}
                  </Paragraph>
                </div>
                <Space>
                  <Button
                    type="link"
                    icon={<EyeOutlined />}
                    onClick={() => handleView(skill.name)}
                    style={{ padding: 0 }}
                  >
                    View
                  </Button>
                  <Button
                    type="link"
                    icon={<EditOutlined />}
                    onClick={() => handleEdit(skill.name)}
                    style={{ padding: 0 }}
                  >
                    Edit
                  </Button>
                </Space>
              </Card>
            </Col>
          ))}
        </Row>
      )}

      {/* View Modal */}
      <Modal
        title={viewContent ? `View: ${viewContent.name}` : 'View Skill'}
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
        title={editContent ? `Edit: ${editContent.name}` : 'Edit Skill'}
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
            <div style={{ marginBottom: 16 }}>
              <Text strong>Description: </Text>
              <Text>{editContent.description || 'No description'}</Text>
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
    </div>
  );
}
