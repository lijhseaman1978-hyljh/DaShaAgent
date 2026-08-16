// Dashboard Overview — 连接实际可用的 API，显示实时状态
import { useCallback, useEffect, useState } from 'react';
import { http } from '../api/client';
import { useAgentSocket } from '../hooks/useAgentSocket';

export default function Dashboard() {
  const [status, setStatus] = useState<any>(null);
  const [health, setHealth] = useState<any>(null);
  const [events, setEvents] = useState<any[]>([]);
  const [wsConnected, setWsConnected] = useState(false);
  const [skillsCount, setSkillsCount] = useState(0);
  const [toolsCount, setToolsCount] = useState(0);
  const [jobs, setJobs] = useState<any[]>([]);
  const [sessionCount, setSessionCount] = useState(0);
  const [cognitive, setCognitive] = useState<any>(null);

  const refresh = useCallback(async () => {
    try {
      const [s, h, sk, t, j] = await Promise.all([
        http.get('/api/status').then(r => r.data).catch(() => null),
        http.get('/api/health').then(r => r.data).catch(() => null),
        http.get('/api/skills').then(r => r.data).catch(() => []),
        http.get('/api/tools').then(r => r.data).catch(() => ({ tools: [] })),
        http.get('/api/jobs').then(r => r.data).catch(() => []),
      ]);
      setStatus(s); setHealth(h);
      setSkillsCount(Array.isArray(sk) ? sk.length : 0);
      setToolsCount(t?.tools?.length || t?.count || 0);
      setJobs(Array.isArray(j) ? j : j?.jobs || []);
    } catch {}
    try {
      const c = await http.get('/api/cognitive/stats').then(r => r.data).catch(() => null);
      setCognitive(c);
    } catch {}
    try {
      const sessions = await http.get('/api/sessions').then(r => r.data).catch(() => []);
      setSessionCount(Array.isArray(sessions) ? sessions.length : 0);
    } catch {}
  }, []);

  const { connected } = useAgentSocket((ev) => {
    setEvents(p => [...p.slice(-20), ev]);
    setWsConnected(true);
    if (ev.type?.includes('task') || ev.type?.includes('agent')) refresh();
  });
  useEffect(() => { if (connected) setWsConnected(true); }, [connected]);

  useEffect(() => { refresh(); const id = setInterval(refresh, 5000); return () => clearInterval(id); }, [refresh]);

  const provider = health?.provider || status?.state || '…';
  const ctrlState = status?.control || '…';

  return (
    <div className="page" style={{ gap: 14 }}>
      {/* 头部 */}
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <h2>Overview</h2>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: wsConnected ? 'var(--ok)' : 'var(--warn)' }}>
            {wsConnected ? '● Connected' : '◇ Connecting...'}
          </span>
          <span className={`pill ${ctrlState === 'paused' ? 'p-warn' : 'p-ok'}`}>{ctrlState}</span>
        </div>
      </div>

      {/* 指标卡片 */}
      <div className="grid metric-grid">
        <div className="metric-card">
          <div className="metric-label">Provider</div>
          <div className="metric-value" style={{ fontSize: 18 }}>{provider}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Tools</div>
          <div className="metric-value" style={{ fontSize: 18 }}>{toolsCount}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Skills</div>
          <div className="metric-value" style={{ fontSize: 18 }}>{skillsCount}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Jobs</div>
          <div className="metric-value" style={{ fontSize: 18 }}>{jobs.length}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Sessions</div>
          <div className="metric-value" style={{ fontSize: 18 }}>{sessionCount}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Episodes</div>
          <div className="metric-value" style={{ fontSize: 18 }}>{cognitive?.episodic?.total || 0}</div>
        </div>
      </div>

      {/* Agent 详情 */}
      {status && (
        <div className="card" style={{ padding: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 13 }}>
            <div><b>Name:</b> {status.name}</div>
            <div><b>Version:</b> {status.version}</div>
            <div><b>State:</b> {status.state}</div>
            <div><b>Control:</b> {status.control}</div>
          </div>
        </div>
      )}

      {/* 实时事件 */}
      <div className="card" style={{ padding: 12 }}>
        <h3 style={{ margin: '0 0 8px', fontSize: 14 }}>Live Events ({events.length})</h3>
        <div className="log" style={{ height: 200, fontSize: 11 }}>
          {events.length === 0 && <div className="empty">Waiting for events... (send a message in main chat)</div>}
          {events.map((ev, i) => (
            <div className="line" key={i}>
              <time>{new Date(ev.timestamp || Date.now()).toTimeString().slice(0, 8)}</time>
              <b className={ev.type?.includes('error') ? 't-err' : ev.type?.includes('completed') ? 't-ok' : 't-info'}>{ev.type}</b>
              <span>{(typeof ev.data === 'string' ? ev.data : JSON.stringify(ev.data ?? '')).slice(0, 200)}</span>
            </div>
          ))}
        </div>
      </div>

      {/* 认知记忆速览 */}
      {cognitive && (
        <div className="card" style={{ padding: 16 }}>
          <h3 style={{ margin: '0 0 8px', fontSize: 14 }}>Cognitive Memory</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, fontSize: 13 }}>
            <div>Episodes: {cognitive.episodic?.total || 0}</div>
            <div>Knowledge: {cognitive.semantic?.total || 0}</div>
            <div>Concepts: {cognitive.semantic?.concepts || 0}</div>
          </div>
        </div>
      )}

      {/* 定时任务 */}
      {jobs.length > 0 && (
        <div className="card" style={{ padding: 16 }}>
          <h3 style={{ margin: '0 0 8px', fontSize: 14 }}>Scheduled Jobs</h3>
          {jobs.map((j: any, i: number) => (
            <div key={i} className="wf-task" style={{ padding: '4px 0' }}>
              <span className="wf-task-goal">{j.name}</span>
              <span style={{ fontSize: 11, color: 'var(--text-faint)', marginLeft: 10 }}>{j.status || 'active'}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
