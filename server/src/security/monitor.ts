// security/monitor.ts
// 计划书 Phase 3 - Step 1 §四：Execution Monitor —— 所有 Agent 行为留痕。

export interface ExecutionEvent {
  time?: number;
  action: string;
  target?: string;
  allowed?: boolean;
  reason?: string;
  [k: string]: any;
}

export class ExecutionMonitor {
  logs: any[] = [];
  /** 环形上限，防止长跑 Agent 把内存吃满 */
  constructor(private limit = 1000) {}

  record(event: ExecutionEvent) {
    this.logs.push({ time: Date.now(), ...event });
    if (this.logs.length > this.limit) this.logs.splice(0, this.logs.length - this.limit);
  }

  history() {
    return this.logs;
  }

  /** 只看被拒绝/拦截的事件——排障与审计时最常用的一段。 */
  denied() {
    return this.logs.filter((l) => l.allowed === false);
  }

  clear() {
    this.logs = [];
  }
}
