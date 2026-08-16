// observability/tracer.ts
// V3 Phase 3 - Step 3 §五：Distributed Trace —— 任务链路追踪。

import crypto from 'node:crypto';

export interface TraceSpan {
  id: string;
  name: string;
  start: number;
  end?: number;
  duration?: number;
  status: 'open' | 'ok' | 'error';
  error?: string;
  children: TraceSpan[];
  meta?: Record<string, any>;
}

export class AgentTracer {
  private roots: TraceSpan[] = [];
  private stack: TraceSpan[] = [];
  private spanMap = new Map<string, TraceSpan>(); // B24 修复：O(1) 查找
  private limit: number;

  constructor(opts: { limit?: number } = {}) {
    this.limit = opts.limit ?? 500;
  }

  start(name: string, meta?: Record<string, any>): TraceSpan {
    const span: TraceSpan = {
      id: crypto.randomUUID(),
      name,
      start: Date.now(),
      status: 'open',
      children: [],
      meta,
    };
    this.spanMap.set(span.id, span);
    const parent = this.stack[this.stack.length - 1];
    if (parent) parent.children.push(span);
    else {
      this.roots.push(span);
      if (this.roots.length > this.limit) this.roots.shift();
    }
    this.stack.push(span);
    return span;
  }

  end(spanOrName?: TraceSpan | string, meta?: Record<string, any>): TraceSpan | null {
    let span: TraceSpan | undefined;
    if (typeof spanOrName === 'string') {
      // 按名称从栈顶向下找最近的同名 span
      for (let i = this.stack.length - 1; i >= 0; i--) {
        if (this.stack[i].name === spanOrName) {
          span = this.stack[i];
          break;
        }
      }
    } else {
      span = spanOrName ?? this.stack[this.stack.length - 1];
    }
    if (!span || span.status !== 'open') return null;
    // 弹出直到该 span 之上的所有子 span（自动收尾）
    while (this.stack.length && this.stack[this.stack.length - 1] !== span) {
      this._close(this.stack[this.stack.length - 1], 'ok');
      this.stack.pop();
    }
    if (this.stack[this.stack.length - 1] === span) this.stack.pop();
    this._close(span, 'ok', meta);
    return span;
  }

  fail(error: string | Error, spanOrName?: TraceSpan | string): TraceSpan | null {
    let span: TraceSpan | undefined;
    if (typeof spanOrName === 'string') {
      for (let i = this.stack.length - 1; i >= 0; i--) {
        if (this.stack[i].name === spanOrName) {
          span = this.stack[i];
          break;
        }
      }
    } else {
      span = spanOrName ?? this.stack[this.stack.length - 1];
    }
    if (!span || span.status !== 'open') return null;
    while (this.stack.length && this.stack[this.stack.length - 1] !== span) {
      this._close(this.stack[this.stack.length - 1], 'error');
      this.stack.pop();
    }
    if (this.stack[this.stack.length - 1] === span) this.stack.pop();
    this._close(span, 'error', undefined, error);
    return span;
  }

  active(): TraceSpan | null {
    return this.stack[this.stack.length - 1] ?? null;
  }

  getRoots(limit = 100): TraceSpan[] {
    return this.roots.slice(-limit);
  }

  currentTraceId(): string | null {
    return this.active()?.id ?? null;
  }

  /** 清理所有 trace（B24 修复：同时清 spanMap） */
  clear(): void {
    this.roots = [];
    this.stack = [];
    this.spanMap.clear();
  }

  private _close(span: TraceSpan, status: 'ok' | 'error', meta?: Record<string, any>, error?: string | Error): void {
    span.end = Date.now();
    span.duration = span.end - span.start;
    span.status = status;
    if (meta) span.meta = { ...span.meta, ...meta };
    if (error) span.error = typeof error === 'string' ? error : error.message;
  }
}

export const tracer = new AgentTracer();
