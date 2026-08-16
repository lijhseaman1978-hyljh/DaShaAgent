// V3 Phase 3 - Step 3 §十/§十一：Logs 页面 —— 结构化日志查询。

import { useCallback, useEffect, useState } from 'react';
import { api, type AgentLog, type LogLevel } from '../api/client';

const TONE: Record<string, string> = { debug: 't-info', info: 't-ok', warn: 't-warn', error: 't-err' };

export default function Logs() {
  const [logs, setLogs] = useState<AgentLog[]>([]);
  const [level, setLevel] = useState<LogLevel | ''>('');
  const [component, setComponent] = useState<string>('');

  const load = useCallback(() => {
    void api.obsLogs({ limit: 200, level, component }).then((r) => setLogs(r.logs));
  }, [level, component]);

  useEffect(() => {
    load();
    const id = setInterval(load, 3000);
    return () => clearInterval(id);
  }, [load]);

  return (
    <div className="wrap">
      <header>
        <div className="brand">Logs</div>
        <div className="spacer" />
        <select className="btn" value={level} onChange={(e) => setLevel(e.target.value as LogLevel | '')}>
          <option value="">全部级别</option>
          <option value="debug">debug</option>
          <option value="info">info</option>
          <option value="warn">warn</option>
          <option value="error">error</option>
        </select>
        <input placeholder="component 过滤" value={component} onChange={(e) => setComponent(e.target.value)} style={{ width: 160 }} />
      </header>
      <section className="card">
        <div className="log" style={{ height: 600 }}>
          {logs.length === 0 && <div className="empty">暂无日志</div>}
          {logs.map((l, i) => {
            const data = l.data === undefined ? '' : typeof l.data === 'string' ? l.data : JSON.stringify(l.data);
            return (
              <div className="line" key={i}>
                <time>{new Date(l.timestamp).toTimeString().slice(0, 8)}</time>
                <b className={TONE[l.level] ?? 't-info'}>{l.level}</b>
                <span><b>{l.component}</b>: {l.message}{data ? ` — ${data.slice(0, 160)}` : ''}</span>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
