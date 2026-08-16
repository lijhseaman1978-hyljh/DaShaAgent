// Workflow — 显示定时任务和调度状态
import { useCallback, useEffect, useState } from 'react';
import { http } from '../api/client';

export default function Workflow() {
  const [jobs, setJobs] = useState<any[]>([]);

  const refresh = useCallback(async () => {
    try {
      const r = await http.get('/api/jobs').then(r => r.data).catch(() => []);
      setJobs(Array.isArray(r) ? r : r?.jobs || []);
    } catch {}
  }, []);

  useEffect(() => { refresh(); const id = setInterval(refresh, 5000); return () => clearInterval(id); }, [refresh]);

  return (
    <div className="page" style={{ gap: 14 }}>
      <h2>Workflow & Scheduler</h2>
      {jobs.length === 0 && <div className="empty">No scheduled jobs. Jobs populate from V2 Scheduler.</div>}
      {jobs.map((j: any, i: number) => (
        <div key={i} className="card" style={{ padding: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ margin: 0, fontSize: 15 }}>{j.name}</h3>
            <span className={`pill ${j.status === 'active' ? 'p-ok' : 'p-warn'}`}>{j.status || 'active'}</span>
          </div>
          {j.cron && <div style={{ fontSize: 12, color: 'var(--text-faint)', marginTop: 6 }}>Cron: {j.cron}</div>}
          {j.nextRun && <div style={{ fontSize: 12, color: 'var(--text-faint)' }}>Next: {new Date(j.nextRun).toLocaleString()}</div>}
        </div>
      ))}
    </div>
  );
}
