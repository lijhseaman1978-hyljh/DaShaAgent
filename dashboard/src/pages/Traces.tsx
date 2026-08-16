// Traces — 显示 Agent 任务追踪时间线
import { useCallback, useEffect, useState } from 'react';
import { http } from '../api/client';

export default function Traces() {
  const [traces, setTraces] = useState<any[]>([]);

  const refresh = useCallback(async () => {
    try {
      const r = await http.get('/api/observability/traces?limit=50').then(r => r.data).catch(() => []);
      setTraces(Array.isArray(r) ? r : r?.traces || []);
    } catch {}
  }, []);

  useEffect(() => { refresh(); const id = setInterval(refresh, 4000); return () => clearInterval(id); }, [refresh]);

  return (
    <div className="page" style={{ gap: 14 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2>Traces</h2>
        <button className="btn sm" onClick={refresh}>Refresh</button>
      </div>
      {traces.length === 0 && (
        <div className="empty" style={{ padding: 40 }}>
          No traces yet. Traces are generated when you chat via the main UI — each Agent task creates a trace.
        </div>
      )}
      {traces.map((t: any, i: number) => (
        <div key={i} className="card" style={{ padding: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontWeight: 600, fontSize: 13 }}>{t.name || t.id}</span>
            <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>
              {t.timestamp ? new Date(t.timestamp).toTimeString().slice(0, 8) : ''}
              {t.durationMs ? ` · ${t.durationMs}ms` : ''}
            </span>
          </div>
          {t.spans?.map((s: any, j: number) => (
            <div key={j} style={{ fontSize: 12, color: 'var(--text-faint)', marginLeft: 16, marginTop: 2 }}>
              {s.name} {s.durationMs ? `(${s.durationMs}ms)` : ''}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
