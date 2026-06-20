/**
 * DashboardHero — top-of-page title and subtitle block.
 *
 * Pure presentational: no props, no data dependency. The fade-in classes
 * match the original page-hero pattern.
 */
import { DashboardOutlined } from '@ant-design/icons';

export function DashboardHero() {
  return (
    <div className="page-hero fade-in fade-in-1">
      <h1 className="page-hero-title">
        <DashboardOutlined style={{ marginRight: 12, opacity: 0.4, fontSize: '0.85em' }} /> Dashboard
      </h1>
      <p className="page-hero-subtitle">金融分析系统控制中心</p>
    </div>
  );
}