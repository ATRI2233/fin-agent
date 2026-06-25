/**
 * StatCards — top-row metric strip showing Agents / Skills / Tools / System.
 *
 * Four fixed slots matching the pre-refactor Dashboard layout.
 * The `fadeDelay` parameter staggers the fade-in animation per spec.
 */
import { Row, Col } from 'antd';
import {
  RobotOutlined,
  ToolOutlined,
  CloudServerOutlined,
} from '@ant-design/icons';
import { StatCard } from './StatCard';
import type { Agent, ToolItem } from '../../domain/agent';

interface StatCardsProps {
  agents: Agent[];
  tools: ToolItem[];
  systemOnline: boolean;
}

export function StatCards({
  agents,
  tools,
  systemOnline,
}: StatCardsProps) {
  return (
    <Row gutter={[20, 20]} style={{ marginBottom: 28 }}>
      <Col xs={8} sm={8}>
        <StatCard
          icon={<RobotOutlined />}
          color="#6B8EC4"
          value={agents.length}
          label="Agents"
          fadeDelay="fade-in-1"
        />
      </Col>
      <Col xs={8} sm={8}>
        <StatCard
          icon={<ToolOutlined />}
          color="#D4A85A"
          value={tools.length}
          label="Tools"
          fadeDelay="fade-in-3"
        />
      </Col>
      <Col xs={8} sm={8}>
        <StatCard
          icon={
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <CloudServerOutlined />
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: systemOnline ? '#5A9E7B' : '#D47070',
                  display: 'inline-block',
                }}
              />
            </span>
          }
          color={systemOnline ? '#5A9E7B' : '#D47070'}
          value={systemOnline ? 1 : 0}
          label={systemOnline ? 'System Online' : 'System Offline'}
          fadeDelay="fade-in-4"
        />
      </Col>
    </Row>
  );
}
