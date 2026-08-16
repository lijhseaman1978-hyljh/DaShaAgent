// observability/logger.ts
// V3 Phase 3 - Step 3 §三：Structured Logging —— 所有 Agent 行为统一记录。
//
// 棕地说明：既有 gateway/web.ts 有 V2 生产日志端点 `/api/logs`（读 runtime.logs）。
//   本模块是 Step 3 教程层结构化日志，字段更完整（level/component/message/data/timestamp），
//   与 V2 日志并存；Control Center 通过新端点 `/api/observability/logs` 暴露。

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface AgentLog {
  level: LogLevel;
  component: string;
  message: string;
  data?: any;
  timestamp: number;
  traceId?: string;
}

export class AgentLogger {
  private logs: AgentLog[] = [];
  private limit: number;
  private consoleEnabled: boolean;

  constructor(opts: { limit?: number; console?: boolean } = {}) {
    this.limit = opts.limit ?? 2000;
    this.consoleEnabled = opts.console ?? true;
  }

  write(log: AgentLog): void {
    this.logs.push(log);
    if (this.logs.length > this.limit) this.logs.shift();
    if (this.consoleEnabled) {
      const ts = new Date(log.timestamp).toISOString().slice(11, 23);
      const data = log.data == null ? '' : ' ' + JSON.stringify(log.data).slice(0, 120);
      const fn = log.level === 'error' ? console.error : log.level === 'warn' ? console.warn : console.log;
      fn(`[${ts}] [${log.level.toUpperCase()}] ${log.component}: ${log.message}${data}`);
    }
  }

  debug(component: string, message: string, data?: any, traceId?: string): void {
    this.write({ level: 'debug', component, message, data, timestamp: Date.now(), traceId });
  }

  info(component: string, message: string, data?: any, traceId?: string): void {
    this.write({ level: 'info', component, message, data, timestamp: Date.now(), traceId });
  }

  warn(component: string, message: string, data?: any, traceId?: string): void {
    this.write({ level: 'warn', component, message, data, timestamp: Date.now(), traceId });
  }

  error(component: string, message: string, data?: any, traceId?: string): void {
    this.write({ level: 'error', component, message, data, timestamp: Date.now(), traceId });
  }

  all(): AgentLog[] {
    return [...this.logs];
  }

  query(filter: { level?: LogLevel; component?: string; since?: number; limit?: number } = {}): AgentLog[] {
    let out = this.logs.slice();
    if (filter.level) out = out.filter((l) => l.level === filter.level);
    if (filter.component) {
      const c = filter.component;
      out = out.filter((l) => l.component.includes(c));
    }
    const since = filter.since ?? 0;
    if (since > 0) out = out.filter((l) => l.timestamp >= since);
    const limit = filter.limit ?? 200;
    return out.slice(-limit);
  }

  clear(): void {
    this.logs = [];
  }
}

// 全局单例：Agent Core 各模块共用
export const logger = new AgentLogger();
