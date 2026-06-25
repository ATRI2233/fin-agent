/**
 * Dashboard — read-only overview page.
 *
 * Container component: delegates data fetching to `useDashboardData`,
 * derives view-models via local helpers, and renders the page-level
 * layout. All presentational concerns live in `./components/dashboard`.
 */
import { useMemo } from 'react';
import { Row, Col } from 'antd';
import { useDashboardData } from '../hooks/useDashboardData';
import { groupToolsByServer } from '../utils/dashboard';
import { DashboardHero } from '../components/dashboard/DashboardHero';
import { StatCards } from '../components/dashboard/StatCards';
import { AgentPerformancePanel } from '../components/dashboard/AgentPerformancePanel';
import { McpServersPanel } from '../components/dashboard/McpServersPanel';
import { DashboardSkeleton } from '../components/dashboard/DashboardSkeleton';
import { DashboardError } from '../components/dashboard/DashboardError';

export default function Dashboard() {
  const { agents, tools, systemOnline, isLoading, isError, refetch } = useDashboardData();
  const serverGroups = useMemo(() => groupToolsByServer(tools), [tools]);

  if (isLoading) return <DashboardSkeleton />;
  if (isError) return <DashboardError onRetry={refetch} />;

  return (
    <div className="page-container fade-in">
      <DashboardHero />
      <StatCards agents={agents} tools={tools} systemOnline={systemOnline} />
      <Row gutter={[20, 20]}>
        <Col xs={24} lg={12}>
          <AgentPerformancePanel agents={agents} />
        </Col>
        <Col xs={24} lg={12}>
          <McpServersPanel serverGroups={serverGroups} />
        </Col>
      </Row>
    </div>
  );
}