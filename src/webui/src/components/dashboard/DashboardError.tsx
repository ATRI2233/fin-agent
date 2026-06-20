/**
 * DashboardError — failure state with retry affordance.
 *
 * Wraps Ant Design's `Result` so the retry callback lives in the parent's
 * closure. Matches the original `Alert` messaging.
 */
import { Result, Button } from 'antd';

interface DashboardErrorProps {
  onRetry: () => void;
}

export function DashboardError({ onRetry }: DashboardErrorProps) {
  return (
    <div style={{ padding: 40 }}>
      <Result
        status="error"
        title="加载失败"
        subTitle="无法获取 Dashboard 数据"
        extra={
          <Button type="primary" onClick={onRetry}>
            重试
          </Button>
        }
      />
    </div>
  );
}