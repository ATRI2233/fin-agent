import { useEffect, useState, useCallback } from 'react';
import {
  Card,
  Table,
  Tag,
  Space,
  Typography,
  Spin,
  Button,
  message,
  Empty,
  Modal,
  Row,
  Col,
} from 'antd';
import {
  ReloadOutlined,
  DatabaseOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  SyncOutlined,
  ClockCircleOutlined,
  ExpandAltOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';

import { getStatus, getTaskData, runTask } from '../api/maintenance';
import { getRenderer, DATA_TYPE_OPTIONS } from '../components/dataRenderers';
import { formatFull, timeAgo } from '../utils/time';

const { Text } = Typography;

/* ─── Types ────────────────────────────────────────────────────────── */

interface TaskStatus {
  id: string;
  name: string;
  description: string;
  agent: string;
  enabled: boolean;
  data_type: string;
  last_status: string | null;
  last_run_at: string | null;
  last_error: string | null;
}

interface DataRecord {
  id: number;
  data_key: string;
  content: unknown;
  fetched_at: string | null;
}

interface StatusOverview {
  total_tasks: number;
  enabled_tasks: number;
  healthy_tasks: number;
  failed_tasks: number;
  tasks: TaskStatus[];
}

interface TaskDataEntry {
  records: DataRecord[];
  loading: boolean;
}

/* ─── Helpers ──────────────────────────────────────────────────────── */

function formatRelativeTime(iso: string | null): string {
  return timeAgo(iso);
}

function _removed_formatRelativeTime(iso: string | null): string {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 0) return '刚刚';
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}秒前`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}小时前`;
  const days = Math.floor(hours / 24);
  return `${days}天前`;
}

function statusIcon(status: string | null) {
  if (!status) return <ClockCircleOutlined style={{ color: '#787878' }} />;
  if (status === 'success') return <CheckCircleOutlined style={{ color: '#5A9E7B' }} />;
  if (status === 'running') return <SyncOutlined spin style={{ color: '#6B8EC4' }} />;
  return <CloseCircleOutlined style={{ color: '#D47070' }} />;
}

function statusColor(status: string | null): string {
  if (!status) return '#787878';
  if (status === 'success') return '#5A9E7B';
  if (status === 'running') return '#6B8EC4';
  return '#D47070';
}

function statusLabel(status: string | null): string {
  if (!status) return '未执行';
  if (status === 'success') return '成功';
  if (status === 'running') return '运行中';
  if (status === 'failed') return '失败';
  return status;
}

function dataTypeLabel(dataType: string): string {
  return DATA_TYPE_OPTIONS.find(o => o.value === dataType)?.label || dataType;
}

/* ─── Data Preview Modal ───────────────────────────────────────────── */

function DataModalContent({ task, records }: { task: TaskStatus; records: DataRecord[] }) {
  const Renderer = getRenderer(task.data_type);
  const latestContent = records.length > 0 ? records[0].content : null;

  // For multi-record types (e.g. macro with multiple indicators), pass all records
  if (records.length > 1 && task.data_type !== 'generic') {
    return <Renderer content={latestContent} records={records} />;
  }

  // Single-record modal: show renderer + full data table
  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <Renderer content={latestContent} records={records} />
      </div>
      {records.length > 1 && (
        <>
          <Text style={{ color: '#787878', fontSize: 13, display: 'block', marginBottom: 8 }}>历史记录</Text>
          <Table
            dataSource={records}
            rowKey="id"
            size="small"
            pagination={{ pageSize: 10 }}
            columns={[
              { title: '数据标识', dataIndex: 'data_key', key: 'data_key', width: 120 },
              {
                title: '数据内容', dataIndex: 'content', key: 'content',
                render: (c: unknown) => (
                  <pre style={{ margin: 0, fontSize: 11, color: '#B0B0B0', maxHeight: 80, overflow: 'auto', whiteSpace: 'pre-wrap', fontFamily: "'JetBrains Mono', monospace" }}>
                    {typeof c === 'string' ? c : JSON.stringify(c, null, 2)}
                  </pre>
                ),
              },
              {
                title: '获取时间', dataIndex: 'fetched_at', key: 'fetched_at', width: 160,
                render: (t: string | null) => <Text style={{ color: '#787878', fontSize: 12 }}>{t ? formatFull(t) : '—'}</Text>,
              },
            ]}
          />
        </>
      )}
    </div>
  );
}

/* ─── Main Page ────────────────────────────────────────────────────── */

export default function InfoPage() {
  const navigate = useNavigate();
  const [overview, setOverview] = useState<StatusOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [taskDataMap, setTaskDataMap] = useState<Record<string, TaskDataEntry>>({});
  const [expandedTask, setExpandedTask] = useState<TaskStatus | null>(null);
  const [expandedRecords, setExpandedRecords] = useState<DataRecord[]>([]);
  const [expandedLoading, setExpandedLoading] = useState(false);

  /* ── Fetch overview ─────────────────────────────────────────────── */

  const fetchStatus = useCallback(async () => {
    try {
      const data = await getStatus();
      setOverview(data);
    } catch (e) {
      console.error('Failed to fetch maintenance status', e);
    } finally {
      setLoading(false);
    }
  }, []);

  /* ── Fetch latest data for every task (parallel) ────────────────── */

  const fetchAllTaskData = useCallback(async (tasks: TaskStatus[]) => {
    const entries = await Promise.allSettled(
      tasks.map((t) => getTaskData(t.id, 5)),
    );
    const next: Record<string, TaskDataEntry> = {};
    tasks.forEach((task, i) => {
      const result = entries[i];
      next[task.id] = {
        records: result.status === 'fulfilled' ? (result.value.data || []) : [],
        loading: false,
      };
    });
    setTaskDataMap(next);
  }, []);

  /* ── Mount + polling ────────────────────────────────────────────── */

  useEffect(() => {
    fetchStatus();
    const timer = setInterval(fetchStatus, 30000);
    return () => clearInterval(timer);
  }, [fetchStatus]);

  useEffect(() => {
    if (overview && overview.tasks.length > 0) {
      const loadingMap: Record<string, TaskDataEntry> = {};
      overview.tasks.forEach((t) => {
        loadingMap[t.id] = { records: [], loading: true };
      });
      setTaskDataMap(loadingMap);
      fetchAllTaskData(overview.tasks);
    }
  }, [overview, fetchAllTaskData]);

  /* ── Handlers ───────────────────────────────────────────────────── */

  const handleRunTask = async (taskId: string) => {
    try {
      const result = await runTask(taskId);
      if (result.success) {
        message.success(`更新完成: ${result.records_updated} 条数据`);
        fetchStatus();
      } else {
        message.error(`执行失败: ${result.error}`);
      }
    } catch {
      message.error('请求失败');
    }
  };

  const handleExpand = async (task: TaskStatus) => {
    setExpandedTask(task);
    setExpandedLoading(true);
    try {
      const data = await getTaskData(task.id, 100);
      setExpandedRecords(data.data || []);
    } catch {
      message.error('加载数据失败');
      setExpandedRecords([]);
    } finally {
      setExpandedLoading(false);
    }
  };

  /* ── Loading state ──────────────────────────────────────────────── */

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 100 }}>
        <Spin size="large" />
      </div>
    );
  }

  const tasks = overview?.tasks || [];
  const latestRun = tasks
    .filter((t) => t.last_run_at)
    .sort((a, b) => new Date(b.last_run_at!).getTime() - new Date(a.last_run_at!).getTime())[0];

  return (
    <div className="page-container fade-in">
      {/* ── Hero Header ──────────────────────────────────────────── */}
      <div
        style={{
          marginBottom: 32,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-end',
        }}
      >
        <div className="page-hero" style={{ marginBottom: 0 }}>
          <h1 className="page-hero-title">
            <DatabaseOutlined style={{ marginRight: 12 }} />
            信息中心
          </h1>
          <p className="page-hero-subtitle">后台维护的实时数据</p>
        </div>
        <Space size={12}>
          <Button icon={<SettingOutlined />} onClick={() => navigate('/info/settings')} size="large">
            维护设置
          </Button>
          <Button icon={<ReloadOutlined />} onClick={fetchStatus} size="large" />
        </Space>
      </div>

      {/* ── Stat Overview ────────────────────────────────────────── */}
      {overview && (
        <Row gutter={[16, 16]} style={{ marginBottom: 28 }}>
          <Col xs={12} sm={6}>
            <div className="stat-card fade-in fade-in-1">
              <div className="stat-card-icon">
                <DatabaseOutlined style={{ color: '#6B8EC4' }} />
              </div>
              <div className="stat-card-number">{overview.total_tasks}</div>
              <div className="stat-card-label">数据源</div>
            </div>
          </Col>
          <Col xs={12} sm={6}>
            <div className="stat-card fade-in fade-in-2">
              <div className="stat-card-icon">
                <SyncOutlined style={{ color: '#5A9E7B' }} />
              </div>
              <div className="stat-card-number" style={{ fontSize: 28 }}>
                {formatRelativeTime(latestRun?.last_run_at ?? null)}
              </div>
              <div className="stat-card-label">最近更新</div>
            </div>
          </Col>
          <Col xs={12} sm={6}>
            <div className="stat-card fade-in fade-in-3">
              <div className="stat-card-icon">
                <CheckCircleOutlined style={{ color: '#5A9E7B' }} />
              </div>
              <div className="stat-card-number">{overview.healthy_tasks}</div>
              <div className="stat-card-label">健康</div>
            </div>
          </Col>
          <Col xs={12} sm={6}>
            <div className="stat-card fade-in fade-in-4">
              <div className="stat-card-icon">
                <CloseCircleOutlined style={{ color: '#D47070' }} />
              </div>
              <div className="stat-card-number">{overview.failed_tasks}</div>
              <div className="stat-card-label">异常</div>
            </div>
          </Col>
        </Row>
      )}

      {/* ── Data Cards Grid ──────────────────────────────────────── */}
      {tasks.length === 0 ? (
        <Card className="card-spacious fade-in fade-in-2">
          <Empty
            description={
              <span style={{ color: '#787878' }}>
                暂无数据采集任务，前往
                <Button type="link" style={{ padding: '0 4px' }} onClick={() => navigate('/info/settings')}>
                  维护设置
                </Button>
                创建
              </span>
            }
          />
        </Card>
      ) : (
        <Row gutter={[20, 20]}>
          {tasks.map((task, idx) => {
            const entry = taskDataMap[task.id];
            const records = entry?.records || [];
            const dataLoading = entry?.loading ?? true;
            const latestRecord = records[0];
            const Renderer = getRenderer(task.data_type);

            return (
              <Col xs={24} lg={12} key={task.id}>
                <Card
                  className={`card-spacious fade-in fade-in-${Math.min(idx + 1, 5)}`}
                  style={{ height: '100%' }}
                >
                  {/* Card Header */}
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'flex-start',
                      marginBottom: 14,
                    }}
                  >
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <Text style={{ color: '#F0F0F0', fontWeight: 600, fontSize: 16, display: 'block' }}>
                        {task.name}
                      </Text>
                      {task.description && (
                        <Text style={{ color: '#787878', fontSize: 13 }}>{task.description}</Text>
                      )}
                    </div>
                    <Space size={6}>
                      <Tag color="blue">{task.agent}</Tag>
                      {task.data_type && task.data_type !== 'generic' && (
                        <Tag>{dataTypeLabel(task.data_type)}</Tag>
                      )}
                    </Space>
                  </div>

                  {/* Status Row */}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      marginBottom: 14,
                      paddingBottom: 10,
                      borderBottom: '1px solid rgba(255,255,255,0.06)',
                    }}
                  >
                    {statusIcon(task.last_status)}
                    <Text style={{ color: statusColor(task.last_status), fontSize: 13 }}>
                      {statusLabel(task.last_status)}
                    </Text>
                    <Text style={{ color: '#555', fontSize: 13 }}>·</Text>
                    <Text style={{ color: '#787878', fontSize: 13 }}>
                      {formatRelativeTime(task.last_run_at)}
                    </Text>
                    {records.length > 0 && (
                      <>
                        <Text style={{ color: '#555', fontSize: 13 }}>·</Text>
                        <Text style={{ color: '#787878', fontSize: 13 }}>{records.length} 条记录</Text>
                      </>
                    )}
                  </div>

                  {/* Structured Data Content */}
                  <div
                    style={{
                      background: 'rgba(255,255,255,0.02)',
                      borderRadius: 10,
                      padding: '14px 16px',
                      marginBottom: 14,
                      maxHeight: 260,
                      overflow: 'auto',
                      scrollbarWidth: 'thin',
                      scrollbarColor: 'rgba(255,255,255,0.1) transparent',
                    }}
                  >
                    {dataLoading ? (
                      <div style={{ textAlign: 'center', padding: 24 }}>
                        <Spin size="small" />
                      </div>
                    ) : records.length === 0 ? (
                      <Text style={{ color: '#555', fontSize: 13 }}>暂无数据</Text>
                    ) : (
                      <Renderer content={latestRecord?.content} records={records} />
                    )}
                  </div>

                  {/* Card Footer Actions */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Text style={{ color: '#555', fontSize: 12 }}>
                      {latestRecord?.data_key && latestRecord.data_key !== 'result'
                        ? latestRecord.data_key
                        : latestRecord?.fetched_at
                          ? new Date(latestRecord.fetched_at).toLocaleString('zh-CN')
                          : ''}
                    </Text>
                    <Space size={8}>
                      <Button
                        size="small"
                        icon={<ExpandAltOutlined />}
                        onClick={() => handleExpand(task)}
                        disabled={records.length === 0}
                      >
                        展开全部
                      </Button>
                      <Button size="small" type="primary" onClick={() => handleRunTask(task.id)}>
                        立即更新
                      </Button>
                    </Space>
                  </div>
                </Card>
              </Col>
            );
          })}
        </Row>
      )}

      {/* ── Expanded Data Modal ──────────────────────────────────── */}
      <Modal
        title={
          <Text style={{ color: '#F0F0F0', fontWeight: 600 }}>
            {expandedTask?.name} — 数据详情
          </Text>
        }
        open={expandedTask !== null}
        onCancel={() => {
          setExpandedTask(null);
          setExpandedRecords([]);
        }}
        footer={
          <Button onClick={() => { setExpandedTask(null); setExpandedRecords([]); }}>
            关闭
          </Button>
        }
        width={900}
        destroyOnClose
      >
        {expandedLoading ? (
          <div style={{ textAlign: 'center', padding: 40 }}>
            <Spin />
          </div>
        ) : expandedTask ? (
          <DataModalContent task={expandedTask} records={expandedRecords} />
        ) : null}
      </Modal>
    </div>
  );
}
