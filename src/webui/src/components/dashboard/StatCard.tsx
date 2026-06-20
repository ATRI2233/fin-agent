/**
 * StatCard — single-statistic display card.
 *
 * Pure presentational component: renders an icon, value, and label.
 * Used as the building block for the dashboard's top stats row.
 */
interface StatCardProps {
  icon: React.ReactNode;
  color: string;
  value: string | number;
  label: string;
  fadeDelay?: string;
}

export function StatCard({ icon, color, value, label, fadeDelay }: StatCardProps) {
  return (
    <div className={`stat-card ${fadeDelay ?? ''}`}>
      <div className="stat-card-icon" style={{ color }}>
        {icon}
      </div>
      <div className="stat-card-number">{value}</div>
      <div className="stat-card-label">{label}</div>
    </div>
  );
}