import { useEffect, useState } from 'react';
import {
  Typography,
  Form,
  Input,
  Button,
  Space,
  message,
  Card,
  Row,
  Col,
  Descriptions,
  Tag,
  Radio,
  Spin,
  Alert,
} from 'antd';
import { SaveOutlined, ReloadOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import {
  useWorkflows,
  useUpdateWorkflow,
} from '../hooks/useWorkflows';
import type { WorkflowTriggerType } from '../types/workflow';

const { Title, Text } = Typography;

interface WorkflowSettings {
  id: string;
  name: string;
  description?: string;
  triggerType: WorkflowTriggerType;
  commandString?: string;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * `WorkflowSettings` — per-workflow configuration page.
 *
 * The legacy scheduler feature (APScheduler integration with cron
 * expressions) was removed in P2-T2. The page now only edits the
 * trigger type (`manual` vs `command`) and the command string. The
 * `schedule` radio option is dropped from the UI because the backend
 * no longer accepts it.
 */
export default function WorkflowSettings() {
  const navigate = useNavigate();
  const { data, loading, refetch } = useWorkflows();
  // Backend returns a richer payload than the slim `WorkflowMeta` view-model;
  // cast so the form's description / createdAt / updatedAt fields keep
  // populating.
  const workflowList = (data ?? []) as unknown as WorkflowSettings[];

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}>
        <Spin size="large" tip="Loading workflows..." />
      </div>
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
            Workflow Settings
          </Title>
          <Text type="secondary">Configure trigger mode for each workflow</Text>
        </div>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={() => refetch()} loading={loading}>
            Reload
          </Button>
        </Space>
      </div>

      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 24 }}
        message="Scheduler removed"
        description="The cron-based scheduler was retired in P2-T2. Only manual and command triggers are supported now."
      />

      {workflowList.length === 0 ? (
        <Card>
          <Text type="secondary">No workflows found. Create a workflow first.</Text>
          <div style={{ marginTop: 16 }}>
            <Button type="primary" onClick={() => navigate('/workflows/new/edit')}>
              New Workflow
            </Button>
          </div>
        </Card>
      ) : (
        <Row gutter={16}>
          {workflowList.map((w) => (
            <Col span={12} key={w.id} style={{ marginBottom: 16 }}>
              <WorkflowFormCard workflow={w} onSaved={() => refetch()} />
            </Col>
          ))}
        </Row>
      )}
    </div>
  );
}

function WorkflowFormCard({ workflow: w, onSaved }: { workflow: WorkflowSettings; onSaved: () => void }) {
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const [triggerType, setTriggerType] = useState<WorkflowTriggerType>(w.triggerType || 'manual');
  const updateMutation = useUpdateWorkflow();

  useEffect(() => {
    form.setFieldsValue({
      name: w.name,
      triggerType: w.triggerType,
      commandString: w.commandString,
    });
    setTriggerType(w.triggerType || 'manual');
  }, [w.id, w.name, w.triggerType, w.commandString, form]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateMutation.mutate({
        id: w.id,
        data: { trigger_type: triggerType },
      });
      message.success(
        triggerType === 'manual' ? '已切换为手动触发' : '已切换为命令触发',
      );
      onSaved();
    } catch (err) {
      message.error('保存失败: ' + (err instanceof Error ? err.message : '未知错误'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card
      title={
        <Space>
          <span>{w.name}</span>
          {w.triggerType === 'command' && (
            <Tag color="processing" icon={<ThunderboltOutlined />}>
              命令触发
            </Tag>
          )}
        </Space>
      }
      extra={
        <Space>
          <Button
            type="primary"
            size="small"
            icon={<SaveOutlined />}
            onClick={handleSave}
            loading={saving}
          >
            Save
          </Button>
        </Space>
      }
    >
      <Form layout="vertical" form={form}>
        <Form.Item label="触发方式">
          <Radio.Group
            value={triggerType}
            onChange={(e) => setTriggerType(e.target.value)}
            optionType="button"
            buttonStyle="solid"
          >
            <Radio.Button value="manual">手动</Radio.Button>
            <Radio.Button value="command">命令</Radio.Button>
          </Radio.Group>
        </Form.Item>

        {triggerType === 'command' && (
          <Form.Item
            name="commandString"
            label="命令字符串"
            initialValue={w.commandString}
          >
            <Input placeholder="e.g. /workflow/my-workflow" />
          </Form.Item>
        )}

        <Descriptions column={1} size="small" style={{ marginTop: 8 }}>
          {w.createdAt && (
            <Descriptions.Item label="创建时间">{w.createdAt}</Descriptions.Item>
          )}
          {w.updatedAt && (
            <Descriptions.Item label="更新时间">{w.updatedAt}</Descriptions.Item>
          )}
        </Descriptions>
      </Form>
    </Card>
  );
}
