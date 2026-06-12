import { useEffect, useState, useCallback } from 'react';
import {
  Card, Table, Tag, Space, Typography, Spin, Button, Switch, Modal,
  Form, Input, Select, message, Popconfirm, Empty, Tooltip,
} from 'antd';
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
  HistoryOutlined,
  SettingOutlined,
} from '@ant-design/icons';

const { Text } = Typography;
const { TextArea } = Input;

import {
  listTasks,
  getTaskLogs,
  runTask,
  createTask,
  updateTask,
  deleteTask,
  type Task,
} from '../api/maintenance';
import { formatFull } from '../utils/time';
import { opencodeGet } from '../api/opencode';
import { DATA_TYPE_OPTIONS } from '../components/dataRenderers';

export default function InfoSettingsPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [agents, setAgents] = useState<string[]>([]);

  // Edit modal
  const [editVisible, setEditVisible] = useState(false);
  const [editTask, setEditTask] = useState<Task | null>(null);
  const [form] = Form.useForm();

  // Logs modal
  const [logsVisible, setLogsVisible] = useState(false);
  const [logs, setLogs] = useState<any[]>([]);
  const [logsTaskName, setLogsTaskName] = useState('');

  const fetchTasks = useCallback(async () => {
    try {
      const data = await listTasks();
      setTasks(data.tasks || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchAgents = useCallback(async () => {
    try {
      const data = await opencodeGet<{ agents?: { name: string }[] }>('/agents');
      setAgents((data.agents || []).map((a) => a.name));
    } catch {}
  }, []);

  useEffect(() => {
    fetchTasks();
    fetchAgents();
  }, [fetchTasks, fetchAgents]);

  const handleToggle = async (task: Task) => {
    try {
      await updateTask(task.id, { enabled: !task.enabled });
      fetchTasks();
    } catch {
      message.error('操作失败');
    }
  };

  const handleDelete = async (taskId: string) => {
    try {
      await deleteTask(taskId);
      message.success('已删除');
      fetchTasks();
    } catch {
      message.error('删除失败');
    }
  };

  const handleRun = async (taskId: string) => {
    try {
      const result = await runTask(taskId);
      if (result.success) {
        message.success(`执行成功: ${result.records_updated} 条数据`);
      } else {
        message.error(`执行失败: ${result.error}`);
      }
      fetchTasks();
    } catch {
      message.error('请求失败');
    }
  };

  const openCreate = () => {
    setEditTask(null);
    form.resetFields();
    form.setFieldsValue({ trigger_type: 'cron', enabled: true, data_type: 'generic' });
    setEditVisible(true);
  };

  const openEdit = (task: Task) => {
    setEditTask(task);
    form.setFieldsValue(task);
    setEditVisible(true);
  };

  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      values.enabled = Boolean(values.enabled);

      if (editTask) {
        await updateTask(editTask.id, values);
        message.success('已更新');
      } else {
        await createTask(values);
        message.success('已创建');
      }
      setEditVisible(false);
      fetchTasks();
    } catch (e: any) {
      if (e.errorFields) return; // form validation
      message.error('保存失败');
    }
  };

  const openLogs = async (task: Task) => {
    setLogsTaskName(task.name);
    setLogsVisible(true);
    try {
      const data = await getTaskLogs(task.id, 20);
      setLogs(data.logs || []);
    } catch {
      message.error('加载日志失败');
    }
  };

  const columns = [
    {
      title: '任务名称',
      dataIndex: 'name',
      key: 'name',
      render: (text: string, record: Task) => (
        <div>
          <Text style={{ color: '#F0F0F0', fontWeight: 500 }}>{text}</Text>
          {record.description && (
            <div><Text style={{ color: '#787878', fontSize: 12 }}>{record.description}</Text></div>
          )}
        </div>
      ),
    },
    {
      title: 'Agent',
      dataIndex: 'agent',
      key: 'agent',
      width: 140,
      render: (text: string) => <Tag color="blue">{text}</Tag>,
    },
    {
      title: '数据类型',
      dataIndex: 'data_type',
      key: 'data_type',
      width: 120,
      render: (dt: string) => {
        const label = DATA_TYPE_OPTIONS.find(o => o.value === dt)?.label || dt || '—';
        return <Text style={{ color: '#B0B0B0', fontSize: 13 }}>{label}</Text>;
      },
    },
    {
      title: '触发方式',
      key: 'trigger',
      width: 150,
      render: (_: any, record: Task) => (
        <Text style={{ color: '#B0B0B0', fontSize: 13 }}>
          {record.trigger_type === 'cron'
            ? record.schedule || '—'
            : record.trigger_type === 'interval'
            ? `每 ${record.interval_seconds}s`
            : '手动'}
        </Text>
      ),
    },
    {
      title: '启用',
      dataIndex: 'enabled',
      key: 'enabled',
      width: 80,
      render: (enabled: boolean, record: Task) => (
        <Switch checked={enabled} size="small" onChange={() => handleToggle(record)} />
      ),
    },
    {
      title: '状态',
      dataIndex: 'last_status',
      key: 'status',
      width: 100,
      render: (status: string | null) => {
        const color = status === 'success' ? '#5A9E7B' : status === 'failed' ? '#D47070' : '#787878';
        return <Text style={{ color, fontSize: 13 }}>{status || '未执行'}</Text>;
      },
    },
    {
      title: '操作',
      key: 'actions',
      width: 200,
      render: (_: any, record: Task) => (
        <Space size={4}>
          <Tooltip title="立即执行">
            <Button type="text" icon={<PlayCircleOutlined />} onClick={() => handleRun(record.id)} style={{ color: '#5A9E7B' }} />
          </Tooltip>
          <Tooltip title="执行日志">
            <Button type="text" icon={<HistoryOutlined />} onClick={() => openLogs(record)} style={{ color: '#6B8EC4' }} />
          </Tooltip>
          <Tooltip title="编辑">
            <Button type="text" icon={<EditOutlined />} onClick={() => openEdit(record)} style={{ color: '#B0B0B0' }} />
          </Tooltip>
          <Popconfirm title="确认删除？" onConfirm={() => handleDelete(record.id)}>
            <Button type="text" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const logColumns = [
    { title: '状态', dataIndex: 'status', key: 'status', width: 80,
      render: (s: string) => <Tag color={s === 'success' ? 'green' : 'red'}>{s}</Tag> },
    { title: '耗时', dataIndex: 'duration_seconds', key: 'duration', width: 80,
      render: (v: number) => v ? `${v}s` : '—' },
    { title: '更新记录', dataIndex: 'records_updated', key: 'records', width: 100 },
    { title: '错误', dataIndex: 'error', key: 'error', ellipsis: true,
      render: (e: string) => e ? <Text style={{ color: '#D47070', fontSize: 12 }}>{e}</Text> : '—' },
    { title: '执行时间', dataIndex: 'completed_at', key: 'time', width: 180,
      render: (t: string) => t ? formatFull(t) : '—' },
  ];

  if (loading) {
    return <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 100 }}><Spin size="large" /></div>;
  }

  return (
    <div className="page-container fade-in">
      <div style={{ marginBottom: 32, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div className="page-hero" style={{ marginBottom: 0 }}>
          <h1 className="page-hero-title"><SettingOutlined style={{ marginRight: 12 }} />维护设置</h1>
          <p className="page-hero-subtitle">配置数据维护任务的触发方式和负责 Agent</p>
        </div>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={fetchTasks} size="large" />
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate} size="large">
            新建任务
          </Button>
        </Space>
      </div>

      <Card className="card-spacious">
        <Table
          columns={columns}
          dataSource={tasks}
          rowKey="id"
          pagination={false}
          size="middle"
          locale={{ emptyText: <Empty description="暂无维护任务，点击上方按钮创建" /> }}
        />
      </Card>

      {/* Create/Edit Modal */}
      <Modal
        title={editTask ? '编辑维护任务' : '新建维护任务'}
        open={editVisible}
        onCancel={() => setEditVisible(false)}
        onOk={handleSave}
        width={600}
        destroyOnClose
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item name="name" label="任务名称" rules={[{ required: true }]}>
            <Input placeholder="例：A股大盘数据" />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input placeholder="简要说明该任务采集什么数据" />
          </Form.Item>
          <Form.Item name="agent" label="负责 Agent" rules={[{ required: true }]}>
            <Select placeholder="选择执行该任务的 Agent">
              {agents.map(a => <Select.Option key={a} value={a}>{a}</Select.Option>)}
            </Select>
          </Form.Item>
          <Form.Item name="prompt" label="Prompt 模板" rules={[{ required: true }]}>
            <TextArea rows={4} placeholder="发送给 Agent 的提示词，描述需要采集的数据和返回格式" />
          </Form.Item>
          <Form.Item name="data_type" label="数据类型">
            <Select>
              {DATA_TYPE_OPTIONS.map(opt => (
                <Select.Option key={opt.value} value={opt.value}>{opt.label}</Select.Option>
              ))}
            </Select>
          </Form.Item>
          <Form.Item name="trigger_type" label="触发方式">
            <Select>
              <Select.Option value="cron">定时 (Cron)</Select.Option>
              <Select.Option value="manual">手动</Select.Option>
            </Select>
          </Form.Item>
          <Form.Item
            noStyle
            shouldUpdate={(prev, cur) => prev.trigger_type !== cur.trigger_type}
          >
            {({ getFieldValue }) =>
              getFieldValue('trigger_type') === 'cron' && (
                <Form.Item name="schedule" label="Cron 表达式" rules={[{ required: true }]}>
                  <Input placeholder="*/5 9-15 * * 1-5  (工作日 9-15 点每 5 分钟)" />
                </Form.Item>
              )
            }
          </Form.Item>
          <Form.Item name="enabled" label="启用" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>

      {/* Logs Modal */}
      <Modal
        title={`执行日志: ${logsTaskName}`}
        open={logsVisible}
        onCancel={() => setLogsVisible(false)}
        footer={null}
        width={700}
      >
        <Table
          columns={logColumns}
          dataSource={logs}
          rowKey="id"
          pagination={false}
          size="small"
        />
      </Modal>
    </div>
  );
}
