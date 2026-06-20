/**
 * StatCards — top-row metric strip showing Agents / Tools / Servers counts.
 *
 * Three fixed slots so the layout never reflows when one array is empty.
 * The `fadeDelay` parameter staggers the fade-in animation per spec.
 */
import { Row, Col } from 'antd';
import { RobotOutlined, ToolOutlined, CloudServerOutlined } from '@ant-design/icons';
import { StatCard } from './StatCard';
import type { Agent, ToolItem } from '../../domain/agent';

interface StatCardsProps {
  agents: Agent[];
  tools: ToolItem[];
  servers: unknown[];
}

export function StatCards({ agents, tools, servers }: StatCardsProps) {
  return (
    <Row gutter={[20, 20]} style={{ marginBottom: 28 }}>
      <Col xs={8}>
        <StatCard
          icon={<RobotOutlined />}
          color="#6B8EC4"
          value={agents.length}
          label="Agents"
          fadeDelay="fade-in-1"
        />
      </Col>
      <Col xs={8}>
        <StatCard
          icon={<ToolOutlined />}
          color="#D4A85A"
          value={tools.length}
          label="Tools"
          fadeDelay="fade-in-2"
        />
      </Col>
      <Col xs={8}>
        <StatCard
          icon={<CloudServerOutlined />}
          color="#5A9E7B"
          value={servers.length}
          label="Servers"
          fadeDelay="fade-in-3"
        />
      </Col>
    </Row>
  );
}