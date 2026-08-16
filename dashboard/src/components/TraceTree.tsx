import type { TraceSpan } from '../api/client';

const statusDot = (s: string) => (s === 'error' ? '● t-err' : s === 'ok' ? '● t-ok' : '● t-info');

export default function TraceTree({ spans }: { spans: TraceSpan[] }) {
  if (!spans.length) return <div className="empty">暂无追踪</div>;
  const render = (s: TraceSpan, depth = 0) => (
    <div key={s.id} className="trace-row" style={{ paddingLeft: depth * 18 }}>
      <span className={statusDot(s.status)} />
      <span className="trace-name">{s.name}</span>
      <span className="trace-dur">{s.duration ?? '-'}ms</span>
      {s.children?.map((c: TraceSpan) => render(c, depth + 1))}
    </div>
  );
  return <div className="trace-box">{spans.map((s) => render(s))}</div>;
}
