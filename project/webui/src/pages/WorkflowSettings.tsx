import { useEffect, useState } from 'react';
import {
  Typography,
  Form,
  Input,
  Select,
  Button,
  Space,
  message,
  Card,
  Row,
  Col,
  Descriptions,
  Tag,
  Radio,
} from 'antd';
import { SaveOutlined, ReloadOutlined, ClockCircleOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { CronEditor } from '../components/CronEditor';

const { Title, Text } = Typography;

type WorkflowTriggerType = 'manual' | 'schedule' | 'command';

interface ScheduledJob {
  workflow_id: string;
  cron_expression: string;
  job_id: string;
  next_run_times: string[];
}

interface WorkflowSettings {
  id: string;
  name: string;
  description?: string;
  triggerType: WorkflowTriggerType;
  cronExpression?: string;
  commandString?: string;
  nextRun?: string;
  createdAt: string;
  updatedAt: string;
}

export default function WorkflowSettings() {
  const [settings, setSettings] = useState<WorkflowSettings[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  const fetchSettings = async () => {
    setLoading(true);
    try {
      const [wfRes, scheduledRes] = await Promise.all([
        fetch('/api/v1/workflows'),
        fetch('/api/v1/workflows/scheduled'),
      ]);
      if (!wfRes.ok) throw new Error(`HTTP ${wfRes.status}`);
      // FIX: list_workflows returns an array, not {workflows: [...]}
      const wfData = await wfRes.json();
      const workflows: WorkflowSettings[] = Array.isArray(wfData) ? wfData : [];

      if (scheduledRes.ok) {
        const scheduledData = await scheduledRes.json();
        const scheduledJobs: ScheduledJob[] = Array.isArray(scheduledData) ? scheduledData : [];
        const scheduleMap = new Map<string, ScheduledJob>();
        for (const job of scheduledJobs) {
          scheduleMap.set(job.workflow_id, job);
        }
        for (const wf of workflows) {
          const job = scheduleMap.get(wf.id);
          if (job) {
            wf.triggerType = 'schedule';
            wf.cronExpression = job.cron_expression;
            // FIX: backend returns next_run_times (array), not next_run
            wf.nextRun = job.next_run_times?.[0];
          }
        }
      }

      setSettings(workflows);
    } catch (err) {
      message.error('Failed to load: ' + (err instanceof Error ? err.message : 'Unknown'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSettings();
  }, []);

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
            <ClockCircleOutlined style={{ marginRight: 8 }} />
            Workflow Settings
          </Title>
          <Text type="secondary">Configure triggers and schedules for workflows</Text>
        </div>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={fetchSettings} loading={loading}>
            Reload
          </Button>
        </Space>
      </div>

      {settings.length === 0 && !loading ? (
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
          {settings.map((w) => (
            <Col span={12} key={w.id} style={{ marginBottom: 16 }}>
              <WorkflowFormCard workflow={w} onSaved={fetchSettings} />
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
  const [cronExpression, setCronExpression] = useState<string>(w.cronExpression || '');

  useEffect(() => {
    form.setFieldsValue({
      name: w.name,
      triggerType: w.triggerType,
      commandString: w.commandString,
    });
    setTriggerType(w.triggerType || 'manual');
    setCronExpression(w.cronExpression || '');
  }, [w.id]);

  const handleSave = async () => {
    setSaving(true);
    try {
      if (triggerType === 'schedule') {
        const cronParts = cronExpression.trim().split(/\s+/);
        if (cronParts.length !== 5) {
          message.error('Cron 表达式无效');
          setSaving(false);
          return;
        }
        const res = await fetch(`/api/v1/workflows/${w.id}/schedule`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cron_expression: cronExpression }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.detail || `HTTP ${res.status}`);
        }
        message.success('已设置定时任务');
      } else {
        await fetch(`/api/v1/workflows/${w.id}/schedule`, { method: 'DELETE' });
        if (triggerType === 'command') {
          await fetch(`/api/v1/workflows/${w.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ trigger_type: 'command' }),
          });
        }
        message.success(triggerType === 'manual' ? '已切换为手动触发' : '已切换为命令触发');
      }
      onSaved();
    } catch (err) {
      message.error('保存失败: ' + (err instanceof Error ? err.message : '未知错误'));
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveSchedule = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/v1/workflows/${w.id}/schedule`, { method: 'DELETE' });
      if (!res.ok && res.status !== 404) throw new Error(`HTTP ${res.status}`);
      message.success('已移除定时任务');
      setTriggerType('manual');
      setCronExpression('');
      onSaved();
    } catch (err) {
      message.error('移除失败: ' + (err instanceof Error ? err.message : '未知错误'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card
      title={
        <Space>
          <span>{w.name}</span>
          {w.triggerType === 'schedule' && (
            <Tag color="processing" icon={<ThunderboltOutlined />}>
              已定时
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
            <Radio.Button value="schedule">定时</Radio.Button>
            <Radio.Button value="command">命令</Radio.Button>
          </Radio.Group>
        </Form.Item>

        {triggerType === 'schedule' && (
          <div style={{ marginBottom: 16 }}>
            <CronEditor
              initialCron={cronExpression}
              onChange={setCronExpression}
              nextRunTime={w.nextRun}
            />
            {w.triggerType === 'schedule' && (
              <Button
                danger
                size="small"
                style={{ marginTop: 12 }}
                onClick={handleRemoveSchedule}
                loading={saving}
              >
                移除定时
              </Button>
            )}
          </div>
        )}

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
