import { useEffect, useState } from 'react';
import { Typography, Form, Input, Select, Button, Space, message, Tabs, Card, Row, Col, Descriptions, Tag } from 'antd';
import { SaveOutlined, ReloadOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';

const { Title, Text } = Typography;

type WorkflowTriggerType = 'manual' | 'schedule' | 'command';

interface ScheduledJob {
  workflow_id: string;
  cron_expression: string;
  next_run?: string;
  enabled: boolean;
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
      const wfData = await wfRes.json();
      const workflows: WorkflowSettings[] = wfData.workflows ?? [];

      // Merge scheduled job info (next_run, cron) into workflows
      if (scheduledRes.ok) {
        const scheduledData = await scheduledRes.json();
        const scheduledJobs: ScheduledJob[] = scheduledData.jobs ?? scheduledData ?? [];
        const scheduleMap = new Map<string, ScheduledJob>();
        for (const job of scheduledJobs) {
          scheduleMap.set(job.workflow_id, job);
        }
        for (const wf of workflows) {
          const job = scheduleMap.get(wf.id);
          if (job) {
            wf.triggerType = 'schedule';
            wf.cronExpression = job.cron_expression;
            wf.nextRun = job.next_run;
          }
        }
      }

      setSettings(workflows);
    } catch {
      message.error('Failed to load workflow settings');
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
            Workflow Settings
          </Title>
          <Text type="secondary">Configure triggers and metadata for workflows</Text>
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

  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      const { triggerType, cronExpression, commandString, ...rest } = values;

      if (triggerType === 'schedule') {
        // Create/update scheduled job via scheduler API
        const res = await fetch(`/api/v1/workflows/${w.id}/schedule`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cron_expression: cronExpression }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      } else {
        // Remove any existing schedule
        await fetch(`/api/v1/workflows/${w.id}/schedule`, { method: 'DELETE' });
        // Update workflow trigger_type
        const res = await fetch(`/api/v1/workflows/${w.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ trigger_type: triggerType, ...rest }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      }

      message.success('Settings saved');
      onSaved();
    } catch {
      message.error('Failed to save settings');
    }
  };

  return (
    <Card
      title={w.name}
      extra={
        <Space>
          <Button
            type="primary"
            size="small"
            icon={<SaveOutlined />}
            onClick={handleSave}
          >
            Save
          </Button>
        </Space>
      }
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={{
          name: w.name,
          triggerType: w.triggerType,
          cronExpression: w.cronExpression,
          commandString: w.commandString,
        }}
      >
        <Form.Item
          name="name"
          label="Workflow Name"
        >
          <Input placeholder="Workflow name" />
        </Form.Item>

        <Form.Item
          name="triggerType"
          label="Trigger Type"
        >
          <Select
            options={[
              { label: 'Manual', value: 'manual' },
              { label: 'Schedule (Cron)', value: 'schedule' },
              { label: 'Command', value: 'command' },
            ]}
          />
        </Form.Item>

        <Form.Item noStyle shouldUpdate>
          {({ getFieldValue }) => {
            const triggerType = getFieldValue('triggerType');
            if (triggerType === 'schedule') {
              return (
                <Form.Item
                  name="cronExpression"
                  label="Cron Expression"
                  rules={[{ required: true, message: 'Please enter a cron expression' }]}
                >
                  <Input placeholder="0 * * * * *" />
                </Form.Item>
              );
            }
            if (triggerType === 'command') {
              return (
                <Form.Item
                  name="commandString"
                  label="Command String"
                  rules={[{ required: true, message: 'Please enter a command' }]}
                >
                  <Input placeholder="e.g. /workflow/my-workflow" />
                </Form.Item>
              );
            }
            return null;
          }}
        </Form.Item>

        <Descriptions column={1} size="small" style={{ marginTop: 8 }}>
          {w.triggerType === 'schedule' && w.nextRun && (
            <Descriptions.Item label="Next Run">
              <Tag color="blue">{w.nextRun}</Tag>
            </Descriptions.Item>
          )}
          <Descriptions.Item label="Created">{w.createdAt}</Descriptions.Item>
          <Descriptions.Item label="Updated">{w.updatedAt}</Descriptions.Item>
        </Descriptions>
      </Form>
    </Card>
  );
}