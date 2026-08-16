import { ReactNode } from 'react';

export default function MetricCard({ label, value, children }: { label: string; value: ReactNode; children?: ReactNode }) {
  return (
    <div className="metric-card">
      <div className="metric-label">{label}</div>
      <div className="metric-value">{value}</div>
      {children && <div className="metric-extra">{children}</div>}
    </div>
  );
}
