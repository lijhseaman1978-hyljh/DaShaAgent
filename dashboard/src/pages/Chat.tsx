// Chat — 全功能对话面板，对标 V2 网关 UI 风格
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, http, type AgentEvent } from '../api/client';
import { useAgentSocket } from '../hooks/useAgentSocket';

interface Message {
  id: string;
  role: 'user' | 'agent' | 'system';
  content: string;
  timestamp: number;
  status?: 'sending' | 'done' | 'error';
}

function fmtTime(ts: number) { return new Date(ts).toTimeString().slice(0, 8); }

export default function Chat() {
  const [msgs, setMsgs] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [models, setModels] = useState<Array<{ id: string; status: string; isDefault: boolean }>>([]);
  const [model, setModel] = useState('agnes');
  const [modelOpen, setModelOpen] = useState(false);
  const [wsConnected, setWsConnected] = useState(false);
  const [wsEvents, setWsEvents] = useState<string[]>([]);
  const bottom = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // ── 模型列表 ──
  useEffect(() => {
    http.get('/api/chat/models').then(r => {
      const list = (r.data as any[]) || [];
      setModels(list);
      const def = list.find(m => m.isDefault);
      if (def) setModel(def.id);
    }).catch(() => {});
  }, []);

  const switchModel = async (id: string) => {
    await http.post('/api/chat/model', { provider: id });
    setModel(id);
    setModelOpen(false);
  };

  // ── WebSocket ──
  useAgentSocket((ev: AgentEvent) => {
    setWsConnected(true);
    setWsEvents(p => [...p.slice(-5), ev.type]);
  });

  // ── 自动滚动 ──
  useEffect(() => { bottom.current?.scrollIntoView({ behavior: 'smooth' }); }, [msgs]);

  // ── 发送 ──
  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput('');
    setBusy(true);
    const um: Message = { id: `u-${Date.now()}`, role: 'user', content: text, timestamp: Date.now() };
    setMsgs(p => [...p, um]);
    try {
      const history = msgs.map(m => ({ role: m.role, content: m.content }));
      const res = await api.chat(text, history);
      const am: Message = { id: `a-${Date.now()}`, role: 'agent', content: res.reply, timestamp: Date.now(), status: 'done' };
      setMsgs(p => [...p, am]);
    } catch (e: any) {
      setMsgs(p => [...p, { id: `e-${Date.now()}`, role: 'system', content: `Error: ${e?.message || e}`, timestamp: Date.now(), status: 'error' }]);
    } finally { setBusy(false); }
  }, [input, busy, msgs]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  };

  const newChat = () => setMsgs([]);

  // ── 文件上传处理 ──
  const handleFiles = (files: FileList | null) => {
    if (!files?.length) return;
    const names = Array.from(files).map(f => f.name).join(', ');
    setInput(p => p + `\n[已附加文件: ${names}]`);
  };

  const activeModel = models.find(m => m.id === model);
  const modelStatus = activeModel?.status || '';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 58px)', maxWidth: 960, margin: '0 auto', padding: '0 16px' }}>
      {/* ── 顶部工具栏 ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: '1px solid var(--border-strong)', flexWrap: 'wrap' }}>
        {/* 模型选择器 */}
        <div style={{ position: 'relative' }}>
          <button
            onClick={() => setModelOpen(!modelOpen)}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 8, border: '1px solid var(--border-strong)', background: 'var(--card-bg)', color: 'var(--text)', fontSize: 13, cursor: 'pointer' }}
          >
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: modelStatus.includes('ready') ? 'var(--ok)' : modelStatus.includes('offline') ? 'var(--err)' : 'var(--warn)' }} />
            <span>{activeModel?.id || model}</span>
            <span style={{ fontSize: 10, marginLeft: 2 }}>▾</span>
          </button>
          {modelOpen && (
            <div style={{ position: 'absolute', top: '100%', left: 0, marginTop: 4, background: 'var(--card-bg)', border: '1px solid var(--border-strong)', borderRadius: 10, minWidth: 260, zIndex: 100, overflow: 'hidden', boxShadow: '0 8px 24px rgba(0,0,0,0.25)' }}>
              {models.map(m => (
                <div
                  key={m.id}
                  onClick={() => switchModel(m.id)}
                  style={{ padding: '8px 14px', cursor: 'pointer', fontSize: 13, display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: m.id === model ? 'var(--bg-dim)' : 'transparent', borderBottom: '1px solid var(--border-strong)' }}
                >
                  <span>{m.id}{m.isDefault ? ' (default)' : ''}</span>
                  <span style={{ fontSize: 11, color: m.status.includes('ready') ? 'var(--ok)' : 'var(--text-faint)' }}>{m.status}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 快捷操作 */}
        <div style={{ display: 'flex', gap: 6, flex: 1, justifyContent: 'flex-end', alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: wsConnected ? 'var(--ok)' : 'var(--text-faint)', marginRight: 4 }}>
            {wsConnected ? '● connected' : '○ connecting'}
          </span>
          <button onClick={newChat} className="btn sm ghost" style={{ fontSize: 12 }}>+ New Chat</button>
        </div>
      </div>

      {/* ── 消息区域 ── */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 0' }}>
        {msgs.length === 0 && (
          <div style={{ textAlign: 'center', paddingTop: 80 }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>◆</div>
            <h2 style={{ margin: '0 0 8px', fontSize: 20 }}>DaShaAgent</h2>
            <p style={{ color: 'var(--text-faint)', fontSize: 14, marginBottom: 20 }}>调用工具、检索记忆、多智能体协作 —— 你的个人 AI 工作台。</p>
            <div style={{ fontSize: 13, color: 'var(--text-dim)' }}>
              直接在下方输入，或拖拽任意文件到此处上传。<br />
              试试：「帮我写一份 PSC 检查清单」「分析 SOLAS 最新修正案」
            </div>
          </div>
        )}
        {msgs.map(m => (
          <div key={m.id} style={{
            marginBottom: 18,
            display: 'flex', flexDirection: 'column',
            alignItems: m.role === 'user' ? 'flex-end' : m.role === 'system' ? 'center' : 'flex-start',
          }}>
            <div style={{ fontSize: 10, color: 'var(--text-faint)', marginBottom: 4 }}>
              {m.role === 'user' ? 'You' : m.role === 'system' ? '' : 'Assistant'} · {fmtTime(m.timestamp)}
              {m.status === 'error' && <span style={{ color: 'var(--err)', marginLeft: 6 }}>failed</span>}
            </div>
            <div style={{
              maxWidth: '85%',
              padding: m.role === 'system' ? '8px 14px' : '12px 18px',
              borderRadius: m.role === 'user' ? '16px 16px 4px 16px' : m.role === 'system' ? 8 : '4px 16px 16px 16px',
              fontSize: 14, lineHeight: 1.65, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
              background: m.role === 'user' ? 'var(--accent)' : m.role === 'system' ? 'var(--bg-dim)' : 'var(--card-bg)',
              color: m.role === 'user' ? '#fff' : m.role === 'system' ? 'var(--err)' : 'var(--text)',
              border: m.role === 'agent' ? '1px solid var(--border-strong)' : 'none',
            }}>
              {m.content}
            </div>
          </div>
        ))}
        {busy && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-faint)', fontSize: 13, padding: '0 0 12px 0' }}>
            <span className="wf-dot spin" style={{ background: 'var(--accent)' }} />
            Thinking...
          </div>
        )}
        {/* WS 事件 */}
        {wsEvents.length > 0 && (
          <div style={{ marginTop: 8, padding: '6px 10px', borderRadius: 6, background: 'var(--bg-dim)', fontSize: 10, color: 'var(--text-faint)', maxHeight: 60, overflowY: 'auto', fontFamily: 'ui-monospace, monospace' }}>
            {wsEvents.map((e, i) => <div key={i}>{e}</div>)}
          </div>
        )}
        <div ref={bottom} />
      </div>

      {/* ── 输入区 ── */}
      <div style={{ padding: '10px 0 16px', borderTop: '1px solid var(--border-strong)' }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
          <button
            onClick={() => fileRef.current?.click()}
            title="Upload file"
            style={{ padding: '10px 10px', fontSize: 18, borderRadius: 12, border: '1px solid var(--border-strong)', background: 'var(--card-bg)', color: 'var(--text-faint)', cursor: 'pointer', lineHeight: 1, flex: 'none' }}
          >📎</button>
          <input ref={fileRef} type="file" multiple hidden onChange={e => handleFiles(e.target.files)} />
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={onKey}
            placeholder="Send a message... (Enter to send, Shift+Enter for new line, drag files here)"
            disabled={busy}
            rows={2}
            style={{
              flex: 1, padding: '10px 14px', fontSize: 14, borderRadius: 12,
              border: '1px solid var(--border-strong)', background: 'var(--card-bg)',
              color: 'var(--text)', outline: 'none', resize: 'none',
              fontFamily: 'inherit', lineHeight: 1.5, minHeight: 44,
            }}
          />
          <button
            onClick={send}
            disabled={busy || !input.trim()}
            style={{
              padding: '10px 16px', fontSize: 18, fontWeight: 600, borderRadius: 12,
              border: 'none', background: busy ? 'var(--border-strong)' : 'var(--accent)',
              color: '#fff', cursor: busy ? 'not-allowed' : 'pointer', flex: 'none',
              opacity: busy || !input.trim() ? 0.5 : 1, transition: 'opacity .2s',
            }}
          >↑</button>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: 11, color: 'var(--text-faint)' }}>
          <span>Model: <b>{activeModel?.id || model}</b> · {modelStatus}</span>
          <span>Drag & drop files supported</span>
        </div>
      </div>
    </div>
  );
}
