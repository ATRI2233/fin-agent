/**
 * AgentsPage — orchestrator for the Agents registry view.
 *
 * Split from the previous 941-line monolith into focused modules.
 * The orchestrator now owns the page shell (hero header, error alert,
 * table card) and stitches together the extracted pieces:
 *
 * - `useAgentsPage` (local) — registry list + per-agent whitelist counts.
 * - `buildAgentColumns` — table column factory.
 *
 * Note: CRUD modals (Create / View / Edit / BatchModel) and the
 * associated endpoints (updateAgent / deleteAgent / getAgentContent /
 * updateAgentToolsWhitelist / batch-model) have been removed in P2-T2.
 * The page is now read-only.
 */

import {
  Table,
  Button,
  Space,
  Spin,
  Alert,
  Card,
} from 'antd';
import { ReloadOutlined } from '@ant-design/icons';

import { useAgentsPage } from './hooks/useAgentsPage';
import { buildAgentColumns } from './columns';

export default function AgentsPage() {
  // List data: agents + per-agent whitelist counts.
  const {
    agents,
    loading,
    error,
    refetch: refetchAgents,
    agentWhitelistCounts,
  } = useAgentsPage();

  const columns = buildAgentColumns({ agentModels: {}, agentWhitelistCounts });

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh' }}>
        <div style={{ textAlign: 'center' }}>
          <Spin size="large" />
          <div style={{ marginTop: 16, color: '#787878', fontSize: 14 }}>Loading...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="page-container fade-in">
      {/* Hero Header */}
      <div style={{ marginBottom: 40, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div className="page-hero" style={{ marginBottom: 0 }}>
          <h1 className="page-hero-title">Agents</h1>
          <p className="page-hero-subtitle">配置和管理 AI Agent</p>
        </div>
        <Space size={12}>
          <Button
            icon={<ReloadOutlined />}
            onClick={refetchAgents}
            size="large"
          />
        </Space>
      </div>

      {error && (
        <Alert
          type="error"
          message="加载 Agent 失败"
          description={error}
          showIcon
          closable
          onClose={() => refetchAgents()}
          style={{ marginBottom: 24 }}
        />
      )}

      {/* Agents Table */}
      <Card className="card-spacious fade-in fade-in-2">
        <Table
          columns={columns}
          dataSource={agents}
          rowKey="name"
          loading={loading}
          pagination={{ pageSize: 15 }}
          size="middle"
        />
      </Card>
    </div>
  );
}
