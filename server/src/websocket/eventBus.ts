// websocket/eventBus.ts
// V3 Phase 3 - Step 2 §六：Agent Event Bus —— 让前端实时看到 Agent 的思考过程。
//
// 棕地说明：kernel/eventBus.ts 是「进程内」神经系统（模块间同步通信）；
//   本文件是「进程外」广播层（Agent → 浏览器）。两者职责不同，并排存在：
//   bridgeKernelEvents() 把内核事件订阅一份，转成 WS 帧推给所有前端客户端。
//   既有 gateway/web.ts 的 WS 通道（V2 生产）完全不受影响。

import type { WebSocket } from 'ws';
import { eventBus as kernelBus } from '../kernel/eventBus';

export interface AgentEvent {
  type: string;
  data?: any;
  timestamp: number;
}

export class AgentEventBus {
  private clients: Set<WebSocket> = new Set();
  // 回放缓冲：新连上的前端立刻能看到最近发生了什么，而不是一片空白
  private buffer: AgentEvent[] = [];
  private bufferLimit = 200;
  private bridged = false;

  connect(ws: WebSocket): void {
    this.clients.add(ws);
    // 补发历史，让 LogViewer 一进来就有内容
    for (const ev of this.buffer) this.send(ws, ev);
    ws.on('close', () => this.clients.delete(ws));
    ws.on('error', () => this.clients.delete(ws));
  }

  disconnect(ws: WebSocket): void {
    this.clients.delete(ws);
  }

  emit(type: string, data?: any): AgentEvent {
    const event: AgentEvent = { type, data, timestamp: Date.now() };
    this.buffer.push(event);
    if (this.buffer.length > this.bufferLimit) this.buffer.shift();
    for (const ws of this.clients) this.send(ws, event);
    return event;
  }

  history(limit = 100): AgentEvent[] {
    return this.buffer.slice(-limit);
  }

  clientCount(): number {
    return this.clients.size;
  }

  clear(): void {
    this.buffer = [];
  }

  // §七：Agent Core 发事件 —— 这里统一从内核总线桥接，
  // 免去在每个执行点重复埋点（thinking / tool / completed 都已在 runtime 里 emit 过）。
  bridgeKernelEvents(topics?: string[]): void {
    if (this.bridged) return;
    this.bridged = true;
    const list = topics ?? [
      'kernel.ready',
      'agent.initialized',
      'agent.thinking',
      'agent.planning',
      'agent.executing',
      'agent.completed',
      'agent.failed',
      'agent.tool',
      'agent.control',
      'agent.paused',
      'agent.resumed',
      'agent.killed',
      'agent.reset',
    ];
    for (const topic of list) {
      kernelBus.on(topic, (data: any) => this.emit(topic, data));
    }
  }

  private send(ws: WebSocket, event: AgentEvent): void {
    // readyState 1 === OPEN；用数字避免为了一个常量去 import ws 运行时对象
    if ((ws as any).readyState !== 1) return;
    try {
      ws.send(JSON.stringify(event));
    } catch {
      this.clients.delete(ws);
    }
  }
}

// 全局单例：控制面服务器与 Controller 共用
export const agentEventBus = new AgentEventBus();
