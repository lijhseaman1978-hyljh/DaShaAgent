// Monitor — 从 V3 observability API 取实时数据
import { useCallback, useEffect, useState } from 'react';
import { http } from '../api/client';

export default function Monitor() {
  const [summary, setSummary] = useState<any>(null);
  const [metrics, setMetrics] = useState<any>(null);

  const refresh = useCallback(async () => {
    try {
      const s = await http.get('/api/observability/summary').then(r => r.data).catch(() => null);
      setSummary(s);
      const m = await http.get('/api/observability/metrics').then(r => r.data).catch(() => null);
      setMetrics(m);
    } catch {}
  }, []);

  useEffect(() => { refresh(); const id = setInterval(refresh, 4000); return () => clearInterval(id); }, [refresh]);

  const metricKeys = metrics ? Object.keys(metrics) : [];

  return (
    <div className="page" style={{ gap: 14 }}>
      <h2>Metrics</h2>
      <div className="grid metric-grid">
        <div className="metric-card">
          <div className="metric-label">Logs</div>
          <div className="metric-value">{summary?.logs?.total || 0}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Traces</div>
          <div className="metric-value">{summary?.traces?.total || 0}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Cost</div>
          <div className="metric-value">${(summary?.cost?.totalCostUsd || 0).toFixed(6)}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Tokens</div>
          <div className="metric-value">{summary?.cost?.totalTokens || 0}</div>
        </div>
      </div>
      {metricKeys.length > 0 && (
        <div className="card" style={{ padding: 16 }}>
          <h3 style={{ margin: '0 0 8px', fontSize: 14 }}>All Metrics ({metricKeys.length})</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, fontSize: 12, maxHeight: 400, overflow: 'auto' }}>
            {metricKeys.map(k => (
              <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0', borderBottom: '1px solid var(--border-strong)' }}>
                <span style={{ color: 'var(--text-faint)' }}>{k}</span>
                <span>{metrics[k].value}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {(!summary && !metrics) && <div className="empty">No data yet. Metrics populate when you use the main chat.</div>}
    </div>
  );
}
