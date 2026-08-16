// kernel/control.ts
// V3 Phase 3 - Step 2 §十五：Human Override —— 人类随时可以踩刹车。
//
// 棕地说明：计划书把 paused 直接挂在 runtime 上（`if (runtime.paused) ...`）。
//   本项目 runtime.ts 是 V2/V3 双管线共用的内核，为避免在其中埋散落的可变状态，
//   把「暂停 / 恢复 / 终止」抽成内核级单例 AgentControl，runtime 与 AgentLoop 都读它。
//   AgentRuntime 仍暴露 `paused` / `killed` getter，保持计划书的调用形态不变。
//
// 事件：所有状态迁移都会广播到 kernel eventBus，Step 2 的 WebSocket 层直接转发给前端。

import { eventBus } from './eventBus';

export type ControlState = 'running' | 'paused' | 'killed';

export interface ControlEvent {
  action: 'pause' | 'resume' | 'kill' | 'reset';
  reason?: string;
  at: number;
}

export class AgentControl {
  private _paused = false;
  private _killed = false;
  private events: ControlEvent[] = [];

  get paused(): boolean {
    return this._paused;
  }

  get killed(): boolean {
    return this._killed;
  }

  get state(): ControlState {
    if (this._killed) return 'killed';
    if (this._paused) return 'paused';
    return 'running';
  }

  pause(reason?: string): ControlState {
    if (!this._killed) this._paused = true;
    this.record('pause', reason);
    return this.state;
  }

  resume(reason?: string): ControlState {
    this._paused = false;
    this.record('resume', reason);
    return this.state;
  }

  // kill 只置标志位，由 Agent Loop 在下一个安全点自行退出（协作式取消，
  // 不用 process.exit —— 否则 HTTP / WS 连接与记忆写入都会被硬切）。
  kill(reason?: string): ControlState {
    this._killed = true;
    this._paused = false;
    this.record('kill', reason);
    return this.state;
  }

  // 一次任务结束后复位，便于下一次 run 复用同一进程
  reset(): ControlState {
    this._paused = false;
    this._killed = false;
    this.record('reset');
    return this.state;
  }

  history(): ControlEvent[] {
    return [...this.events];
  }

  // Agent Loop 的安全点：被暂停时挂起，被终止时返回 'abort'。
  // 计划书 §十五 的写法是 `if (runtime.paused) { await sleep(1000); continue; }`，
  // 这里把 sleep 间隔做成参数，演示时可调小以免拖慢闭环。
  async gate(intervalMs = 1000): Promise<'continue' | 'abort'> {
    if (this._killed) return 'abort';
    while (this._paused && !this._killed) {
      await new Promise((r) => setTimeout(r, intervalMs));
    }
    return this._killed ? 'abort' : 'continue';
  }

  private record(action: ControlEvent['action'], reason?: string): void {
    const ev: ControlEvent = { action, reason, at: Date.now() };
    this.events.push(ev);
    if (this.events.length > 200) this.events.shift();
    const TOPIC: Record<ControlEvent['action'], string> = {
      pause: 'agent.paused',
      resume: 'agent.resumed',
      kill: 'agent.killed',
      reset: 'agent.reset',
    };
    eventBus.emit(TOPIC[action], { ...ev, state: this.state });
    eventBus.emit('agent.control', { ...ev, state: this.state });
  }
}

// 全局单例：HTTP 控制面与 Agent Loop 共享同一份状态
export const agentControl = new AgentControl();
