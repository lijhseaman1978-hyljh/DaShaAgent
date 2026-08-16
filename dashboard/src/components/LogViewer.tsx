// V3 Phase 3 - Step 2 §十一：LogViewer —— WebSocket 实时日志（自动滚动到底）。
import { useEffect, useRef } from 'react';
import type { AgentEvent } from '../api/client';

const tone = (type: string) =>
  type.includes('failed') || type.includes('killed')
    ? 't-err'
    : type.includes('completed') || type === 'kernel.ready'
      ? 't-ok'
      : type.includes('paused')
        ? 't-warn'
        : type.includes('thinking') || type.includes('planning')
          ? 't-acc'
          : 't-info';

export default function LogViewer({ events }: { events: AgentEvent[] }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [events.length]);

  return (
    <div className="log" ref={box}>
      {events.length === 0 && <div className="empty">等待事件…</div>}
      {events.map((ev, i) => {
        const d = ev.data === undefined ? '' : typeof ev.data === 'string' ? ev.data : JSON.stringify(ev.data);
        return (
          <div className="line" key={`${ev.timestamp}-${i}`}>
            <time>{new Date(ev.timestamp).toTimeString().slice(0, 8)}</time>
            <b className={tone(ev.type)}>{ev.type}</b>
            <span>{d.slice(0, 300)}</span>
          </div>
        );
      })}
    </div>
  );
}
