// Settings — 从 V2 API 读取模型/技能/工具/配置
import { useCallback, useEffect, useState } from 'react';
import { http } from '../api/client';

type Tab = 'models' | 'skills' | 'tools' | 'config';

export default function Settings() {
  const [tab, setTab] = useState<Tab>('models');
  const [config, setConfig] = useState<any>(null);
  const [models, setModels] = useState<any>(null);
  const [skills, setSkills] = useState<any[]>([]);
  const [tools, setTools] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [c, m, s, t] = await Promise.all([
        http.get('/api/config').then(r => r.data).catch(() => null),
        http.get('/api/models').then(r => r.data).catch(() => null),
        http.get('/api/skills').then(r => r.data).catch(() => []),
        http.get('/api/tools').then(r => r.data).catch(() => ({ tools: [] })),
      ]);
      setConfig(c); setModels(m);
      setSkills(Array.isArray(s) ? s : []);
      setTools(t?.tools || []);
    } catch {} finally { setLoading(false); }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const tabs: Array<{ id: Tab; label: string }> = [
    { id: 'models', label: 'Models' },
    { id: 'skills', label: 'Skills' },
    { id: 'tools', label: 'Tools' },
    { id: 'config', label: 'Config' },
  ];

  const modelGroups = models?.groups || [];
  const activeId = models?.activeModelId || config?.activeModelId || '';

  return (
    <div className="page" style={{ gap: 14 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2>Settings</h2>
        <button className="btn sm" onClick={refresh} disabled={loading}>{loading ? '...' : 'Refresh'}</button>
      </div>

      <div style={{ display: 'flex', gap: 2, borderBottom: '2px solid var(--border-strong)' }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            style={{ padding: '6px 18px', fontSize: 13, fontWeight: tab === t.id ? 600 : 400, background: 'none', border: 'none', borderBottom: tab === t.id ? '2px solid var(--accent)' : '2px solid transparent', color: tab === t.id ? 'var(--accent)' : 'var(--text-faint)', cursor: 'pointer', marginBottom: -2 }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Models */}
      {tab === 'models' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {config && (
            <div className="card" style={{ padding: 16 }}>
              <div style={{ fontSize: 13 }}>
                <div><b>Provider:</b> {config.provider || 'ollama'}</div>
                <div><b>Active Model:</b> {activeId || '(default)'}</div>
                <div><b>Ollama Base:</b> {config.ollama?.base || 'http://127.0.0.1:11434'}</div>
                <div><b>Ollama Model:</b> {config.ollama?.model || ''}</div>
                <div><b>Cloud Base:</b> {config.cloud?.base || ''}</div>
                <div><b>Cloud Key:</b> {config.cloud?.key ? '***configured***' : '(not set)'}</div>
                <div><b>Cloud Model:</b> {config.cloud?.model || ''}</div>
              </div>
            </div>
          )}
          {modelGroups.map((g: any) => (
            <div className="card" key={g.id} style={{ padding: 16 }}>
              <h4 style={{ margin: '0 0 8px', fontSize: 14 }}>{g.label}</h4>
              {g.models?.map((m: any) => (
                <div key={m.id} className="wf-task" style={{ padding: '3px 0', display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 13 }}>{m.label || m.id}</span>
                  {activeId === m.id && <span style={{ fontSize: 11, color: 'var(--ok)' }}>ACTIVE</span>}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* Skills */}
      {tab === 'skills' && (
        <div className="card" style={{ padding: 16 }}>
          <h3 style={{ margin: '0 0 8px', fontSize: 14 }}>Skills ({skills.length})</h3>
          {skills.length === 0 && <div className="empty">Loading...</div>}
          {skills.map((s: any, i: number) => (
            <div key={i} className="wf-task" style={{ padding: '3px 0' }}>
              <span style={{ fontSize: 13 }}>{typeof s === 'string' ? s : s.name}</span>
            </div>
          ))}
        </div>
      )}

      {/* Tools */}
      {tab === 'tools' && (
        <div className="card" style={{ padding: 16 }}>
          <h3 style={{ margin: '0 0 8px', fontSize: 14 }}>Tools ({tools.length})</h3>
          {tools.map((t: any, i: number) => (
            <div key={i} className="wf-task" style={{ padding: '3px 0' }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{t.name}</div>
              <div style={{ fontSize: 12, color: 'var(--text-faint)' }}>{t.description}</div>
            </div>
          ))}
        </div>
      )}

      {/* Config */}
      {tab === 'config' && config && (
        <div className="card" style={{ padding: 16 }}>
          <h3 style={{ margin: '0 0 8px', fontSize: 14 }}>Raw Config</h3>
          <pre style={{ fontSize: 11, color: 'var(--text-dim)', background: 'var(--bg-dim)', padding: 12, borderRadius: 8, overflow: 'auto', maxHeight: 500 }}>
            {JSON.stringify(config, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
