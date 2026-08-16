// Costs — 显示 LLM 调用成本
import { useCallback, useEffect, useState } from 'react';
import { http } from '../api/client';

export default function Costs() {
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

  // 从 metrics 里提取 token 和 cost 相关数据
  const tokenMetrics = metrics ? Object.entries(metrics).filter(([k]) => k.includes('tokens') || k.includes('token') || k.includes('cost')) as [string, any][] : [];
  const llmMetrics = metrics ? Object.entries(metrics).filter(([k]) => k.includes('llm')) as [string, any][] : [];

  return (
    <div className="page" style={{ gap: 14 }}>
      <h2>Costs & Tokens</h2>

      <div className="grid metric-grid">
        <div className="metric-card">
          <div className="metric-label">Total Tokens</div>
          <div className="metric-value">{summary?.cost?.totalTokens || 0}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Est. Cost</div>
          <div className="metric-value">${(summary?.cost?.totalCostUsd || 0).toFixed(6)}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Avg Latency</div>
          <div className="metric-value">{summary?.cost?.avgLatencyMs ? summary.cost.avgLatencyMs.toFixed(0) + 'ms' : '—'}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">LLM Calls</div>
          <div className="metric-value">{llmMetrics.reduce((s, [, v]) => s + (v.value || 0), 0)}</div>
        </div>
      </div>

      {tokenMetrics.length > 0 && (
        <div className="card" style={{ padding: 16 }}>
          <h3 style={{ margin: '0 0 8px', fontSize: 14 }}>Token Breakdown</h3>
          {tokenMetrics.map(([k, v]) => (
            <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', fontSize: 12, borderBottom: '1px solid var(--border-strong)' }}>
              <span style={{ color: 'var(--text-faint)' }}>{k}</span>
              <span>{v.value}</span>
            </div>
          ))}
        </div>
      )}

      {(summary?.cost?.byProvider || []).length > 0 && (
        <div className="card" style={{ padding: 16 }}>
          <h3 style={{ margin: '0 0 8px', fontSize: 14 }}>Cost by Provider</h3>
          {summary.cost.byProvider.map((p: any, i: number) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', fontSize: 12 }}>
              <span>{p.provider}</span>
              <span>${p.cost.toFixed(6)} ({p.tokens} tokens)</span>
            </div>
          ))}
        </div>
      )}

      {(!summary?.cost && !Object.keys(metrics || {}).length) && (
        <div className="empty" style={{ padding: 40 }}>No cost data yet. Data accumulates as you use the main chat.</div>
      )}
    </div>
  );
}
