/**
 * DashboardSkeleton — placeholder layout shown while dashboard data loads.
 *
 * Three top-row skeletons plus two side-by-side card skeletons that mirror
 * the Agent Performance / MCP Servers panels. Uses Ant Design's `Skeleton`
 * for consistent styling.
 */
import { Row, Col, Card, Skeleton } from 'antd';

export function DashboardSkeleton() {
  return (
    <div className="page-container fade-in">
      <div className="page-hero fade-in fade-in-1">
        <Skeleton.Input active size="large" style={{ width: 240 }} />
        <Skeleton.Input active size="small" style={{ width: 320, marginTop: 12 }} />
      </div>

      <Row gutter={[20, 20]} style={{ marginBottom: 28 }}>
        {[0, 1, 2].map((i) => (
          <Col xs={8} key={i}>
            <div className="stat-card">
              <Skeleton.Avatar active size="large" shape="circle" />
              <Skeleton.Input active size="default" style={{ width: 60, marginTop: 12 }} />
              <Skeleton.Input active size="small" style={{ width: 80, marginTop: 6 }} />
            </div>
          </Col>
        ))}
      </Row>

      <Row gutter={[20, 20]}>
        <Col xs={24} lg={12}>
          <Card className="card-spacious">
            <Skeleton active paragraph={{ rows: 4 }} />
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card className="card-spacious">
            <Skeleton active paragraph={{ rows: 4 }} />
          </Card>
        </Col>
      </Row>
    </div>
  );
}