// dashboard/src/hooks/useAgentSocket.ts
// V3 Phase 3 - Step 2 §十一：WebSocket 实时事件流（带自动重连 + 环形缓冲）。

import { useEffect, useRef, useState } from 'react';
import type { AgentEvent } from '../api/client';

const LIMIT = 300;

export function useAgentSocket(onEvent?: (ev: AgentEvent) => void) {
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const cb = useRef(onEvent);
  cb.current = onEvent;

  useEffect(() => {
    let ws: WebSocket | null = null;
    let timer: ReturnType<typeof setTimeout>;
    let closed = false;

    const connect = () => {
      const url = location.origin.replace(/^http/, 'ws') + '/ws';
      ws = new WebSocket(url);
      ws.onopen = () => setConnected(true);
      ws.onclose = () => {
        setConnected(false);
        if (!closed) timer = setTimeout(connect, 1800);
      };
      ws.onmessage = (e) => {
        let ev: AgentEvent;
        try {
          ev = JSON.parse(e.data as string);
        } catch {
          return;
        }
        cb.current?.(ev);
        setEvents((prev) => (prev.length >= LIMIT ? [...prev.slice(1), ev] : [...prev, ev]));
      };
    };
    connect();

    return () => {
      closed = true;
      clearTimeout(timer);
      ws?.close();
    };
  }, []);

  return { events, connected };
}
