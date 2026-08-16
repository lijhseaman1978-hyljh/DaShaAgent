// Memory — 显示 V3 认知记忆状态：经历 / 知识 / 技能 / 图谱
import { useCallback, useEffect, useState } from 'react';
import { http } from '../api/client';

export default function Memory() {
  const [cognitive, setCognitive] = useState<any>(null);

  const refresh = useCallback(async () => {
    try {
      const c = await http.get('/api/cognitive/stats').then(r => r.data).catch(() => null);
      setCognitive(c);
    } catch {}
  }, []);

  useEffect(() => { refresh(); const id = setInterval(refresh, 5000); return () => clearInterval(id); }, [refresh]);

  if (!cognitive) return <div className="empty" style={{ padding: 40 }}>Loading cognitive memory...</div>;
  if (!cognitive.available) return <div className="empty" style={{ padding: 40 }}>Cognitive memory not available. AgentLoop hooks may not be connected.</div>;

  const ep = cognitive.episodic || {};
  const sm = cognitive.semantic || {};
  const lr = cognitive.learning || {};
  const gr = cognitive.graph || {};
  const wk = cognitive.working || {};

  return (
    <div className="page" style={{ gap: 14 }}>
      <h2>Cognitive Memory</h2>

      <div className="grid metric-grid">
        <div className="metric-card">
          <div className="metric-label">Episodes</div>
          <div className="metric-value">{ep.total || 0}</div>
          <div className="metric-sub">Success: {ep.successes || 0} / Fail: {ep.failures || 0}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Knowledge</div>
          <div className="metric-value">{sm.total || 0}</div>
          <div className="metric-sub">Concepts: {sm.concepts || 0}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Skills</div>
          <div className="metric-value">{lr.skills || 0}</div>
          <div className="metric-sub">AntiPatterns: {lr.antiPatterns || 0}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Graph</div>
          <div className="metric-value">{gr.nodes || 0}</div>
          <div className="metric-sub">Nodes / {gr.edges || 0} Edges</div>
        </div>
      </div>

      {/* 最近经历 */}
      {ep.recent?.length > 0 && (
        <div className="card" style={{ padding: 16 }}>
          <h3 style={{ margin: '0 0 8px', fontSize: 14 }}>Recent Episodes</h3>
          {ep.recent.map((e: any, i: number) => (
            <div key={i} className="wf-task" style={{ padding: '4px 0' }}>
              <div className="wf-task-goal" style={{ fontSize: 13 }}>{e.task?.slice(0, 100)}</div>
              <span style={{ fontSize: 11, color: e.success ? 'var(--ok)' : 'var(--err)' }}>
                {e.success ? 'OK' : 'FAILED'} · {new Date(e.timestamp || Date.now()).toLocaleTimeString()}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* 工作记忆 */}
      <div className="card" style={{ padding: 16 }}>
        <h3 style={{ margin: '0 0 8px', fontSize: 14 }}>Working Memory</h3>
        <div style={{ fontSize: 13, color: 'var(--text-faint)' }}>
          Size: {wk.size || 0} / {wk.capacity || 50}
          {wk.goal && <div style={{ marginTop: 4 }}>Goal: {wk.goal}</div>}
        </div>
      </div>

      {ep.total === 0 && <div className="empty" style={{ padding: 20, fontSize: 13 }}>
        No episodes yet. Episodes accumulate when you chat via the main UI — AgentLoop saves each task to cognitive memory.
      </div>}
    </div>
  );
}
